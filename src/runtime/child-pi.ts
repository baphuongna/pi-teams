import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "../agents/agent-config.ts";
import { buildPiWorkerArgs, checkCrewDepth, cleanupTempDir } from "./pi-args.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";

const POST_EXIT_STDIO_GUARD_MS = 3000;
const FINAL_DRAIN_MS = 5000;
const HARD_KILL_MS = 3000;

export interface ChildPiRunInput {
	cwd: string;
	task: string;
	agent: AgentConfig;
	model?: string;
	signal?: AbortSignal;
	transcriptPath?: string;
	onStdoutLine?: (line: string) => void;
	onJsonEvent?: (event: unknown) => void;
	maxDepth?: number;
	finalDrainMs?: number;
	hardKillMs?: number;
}

export interface ChildPiRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: string;
}

function appendTranscript(input: ChildPiRunInput, line: string): void {
	if (!input.transcriptPath) return;
	fs.mkdirSync(path.dirname(input.transcriptPath), { recursive: true });
	fs.appendFileSync(input.transcriptPath, `${line}\n`, "utf-8");
}

export class ChildPiLineObserver {
	private buffer = "";
	private readonly input: ChildPiRunInput;

	constructor(input: ChildPiRunInput) {
		this.input = input;
	}

	observe(text: string): void {
		this.buffer += text;
		const lines = this.buffer.split(/\r?\n/);
		this.buffer = lines.pop() ?? "";
		for (const line of lines) this.emitLine(line);
	}

	flush(): void {
		if (!this.buffer) return;
		const line = this.buffer;
		this.buffer = "";
		this.emitLine(line);
	}

	private emitLine(line: string): void {
		if (!line.trim()) return;
		appendTranscript(this.input, line);
		this.input.onStdoutLine?.(line);
		try {
			this.input.onJsonEvent?.(JSON.parse(line));
		} catch {
			// Raw stdout is allowed.
		}
	}
}

function observeStdoutChunk(input: ChildPiRunInput, text: string): void {
	const observer = new ChildPiLineObserver(input);
	observer.observe(text);
	observer.flush();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isFinalAssistantEvent(event: unknown): boolean {
	const obj = asRecord(event);
	if (!obj || obj.type !== "message_end") return false;
	const message = asRecord(obj.message);
	const role = message?.role;
	if (role !== undefined && role !== "assistant") return false;
	const stopReason = typeof message?.stopReason === "string" ? message.stopReason : typeof obj.stopReason === "string" ? obj.stopReason : undefined;
	if (stopReason !== undefined && stopReason !== "stop") return false;
	const content = Array.isArray(message?.content) ? message.content : [];
	return !content.some((part) => asRecord(part)?.type === "toolCall");
}

export async function runChildPi(input: ChildPiRunInput): Promise<ChildPiRunResult> {
	const depth = checkCrewDepth(input.maxDepth);
	if (depth.blocked) return { exitCode: 1, stdout: "", stderr: `pi-crew depth guard blocked child worker: depth ${depth.depth} >= max ${depth.maxDepth}` };
	const mock = process.env.PI_TEAMS_MOCK_CHILD_PI;
	if (mock) {
		if (mock === "success") {
			const stdout = `Mock child Pi success for ${input.agent.name}\n`;
			observeStdoutChunk(input, stdout);
			return { exitCode: 0, stdout, stderr: "" };
		}
		if (mock === "json-success") {
			const stdout = `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: `Mock JSON success for ${input.agent.name}` }] } })}\n${JSON.stringify({ type: "message_end", usage: { input: 10, output: 5, cost: 0.001, turns: 1 } })}\n`;
			observeStdoutChunk(input, stdout);
			return { exitCode: 0, stdout, stderr: "" };
		}
		if (mock === "retryable-failure") return { exitCode: 1, stdout: "", stderr: "rate limit: mock failure" };
		return { exitCode: 1, stdout: "", stderr: `mock failure: ${mock}` };
	}
	const built = buildPiWorkerArgs({ task: input.task, agent: input.agent, model: input.model, sessionEnabled: false, maxDepth: input.maxDepth });
	const spawnSpec = getPiSpawnCommand(built.args);
	try {
		return await new Promise<ChildPiRunResult>((resolve) => {
			const child = spawn(spawnSpec.command, spawnSpec.args, {
				cwd: input.cwd,
				env: { ...process.env, ...built.env },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let settled = false;
			let childExited = false;
			let postExitGuard: NodeJS.Timeout | undefined;
			let finalDrainTimer: NodeJS.Timeout | undefined;
			let hardKillTimer: NodeJS.Timeout | undefined;
			const finalDrainMs = input.finalDrainMs ?? FINAL_DRAIN_MS;
			const hardKillMs = input.hardKillMs ?? HARD_KILL_MS;
			let forcedFinalDrain = false;
			const lineObserver = new ChildPiLineObserver({
				...input,
				onJsonEvent: (event) => {
					input.onJsonEvent?.(event);
					if (!isFinalAssistantEvent(event) || childExited || settled || finalDrainTimer) return;
					finalDrainTimer = setTimeout(() => {
						if (settled || childExited) return;
						forcedFinalDrain = true;
						try { child.kill(process.platform === "win32" ? undefined : "SIGTERM"); } catch {}
						hardKillTimer = setTimeout(() => {
							if (settled || childExited) return;
							try { child.kill(process.platform === "win32" ? undefined : "SIGKILL"); } catch {}
						}, hardKillMs);
						hardKillTimer.unref?.();
					}, finalDrainMs);
					finalDrainTimer.unref?.();
				},
			});

			const clearFinalDrainTimers = (): void => {
				if (finalDrainTimer) clearTimeout(finalDrainTimer);
				if (hardKillTimer) clearTimeout(hardKillTimer);
				finalDrainTimer = undefined;
				hardKillTimer = undefined;
			};

			const settle = (result: ChildPiRunResult): void => {
				if (settled) return;
				settled = true;
				if (postExitGuard) clearTimeout(postExitGuard);
				clearFinalDrainTimers();
				lineObserver.flush();
				input.signal?.removeEventListener("abort", abort);
				cleanupTempDir(built.tempDir);
				resolve(result);
			};

			const abort = (): void => {
				try {
					child.kill(process.platform === "win32" ? undefined : "SIGTERM");
				} catch {
					// Ignore kill races.
				}
			};

			input.signal?.addEventListener("abort", abort, { once: true });
			child.stdout?.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf-8");
				stdout += text;
				lineObserver.observe(text);
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf-8");
			});
			child.on("error", (error) => {
				settle({ exitCode: null, stdout, stderr, error: error.message });
			});
			child.on("exit", () => {
				childExited = true;
				clearFinalDrainTimers();
				postExitGuard = setTimeout(() => {
					child.stdout?.destroy();
					child.stderr?.destroy();
				}, POST_EXIT_STDIO_GUARD_MS);
				postExitGuard.unref?.();
			});
			child.on("close", (exitCode) => {
				settle({ exitCode, stdout, stderr, ...(forcedFinalDrain && !stderr.trim() ? { error: `Child Pi did not exit within ${finalDrainMs}ms after final assistant message; termination was requested.` } : {}) });
			});
		});
	} finally {
		cleanupTempDir(built.tempDir);
	}
}
