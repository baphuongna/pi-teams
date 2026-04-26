import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

export interface PiSpawnCommand {
	command: string;
	args: string[];
}

function isRunnableNodeScript(filePath: string): boolean {
	return fs.existsSync(filePath) && /\.(?:mjs|cjs|js)$/i.test(filePath);
}

function resolvePiPackageRoot(): string | undefined {
	try {
		const entry = process.argv[1];
		if (!entry) return undefined;
		let dir = path.dirname(fs.realpathSync(entry));
		while (dir !== path.dirname(dir)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as { name?: string };
				if (pkg.name === "@mariozechner/pi-coding-agent") return dir;
			} catch {
				// Continue walking upward.
			}
			dir = path.dirname(dir);
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function packageBinScript(packageJsonPath: string): string | undefined {
	try {
		const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { bin?: string | Record<string, string> };
		const binPath = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi ?? Object.values(pkg.bin ?? {})[0];
		if (!binPath) return undefined;
		const candidate = path.resolve(path.dirname(packageJsonPath), binPath);
		return isRunnableNodeScript(candidate) ? candidate : undefined;
	} catch {
		return undefined;
	}
}

function findPiPackageJsonFrom(startDir: string): string | undefined {
	let dir = startDir;
	while (dir !== path.dirname(dir)) {
		const direct = path.join(dir, "package.json");
		try {
			const pkg = JSON.parse(fs.readFileSync(direct, "utf-8")) as { name?: string };
			if (pkg.name === "@mariozechner/pi-coding-agent") return direct;
		} catch {
			// Continue searching upward and in node_modules.
		}
		const dependency = path.join(dir, "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
		if (fs.existsSync(dependency)) return dependency;
		dir = path.dirname(dir);
	}
	return undefined;
}

function resolvePiCliScript(): string | undefined {
	const explicit = process.env.PI_TEAMS_PI_BIN?.trim();
	if (explicit && isRunnableNodeScript(explicit)) return explicit;

	const argv1 = process.argv[1];
	if (argv1) {
		const argvPath = path.isAbsolute(argv1) ? argv1 : path.resolve(argv1);
		if (isRunnableNodeScript(argvPath)) return argvPath;
	}

	const roots = [
		resolvePiPackageRoot(),
		process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@mariozechner", "pi-coding-agent") : undefined,
		path.dirname(fileURLToPath(import.meta.url)),
		process.cwd(),
	].filter((entry): entry is string => Boolean(entry));

	for (const root of roots) {
		const packageJsonPath = root.endsWith("package.json") ? root : findPiPackageJsonFrom(root) ?? path.join(root, "package.json");
		const script = packageBinScript(packageJsonPath);
		if (script) return script;
	}
	return undefined;
}

export function getPiSpawnCommand(args: string[]): PiSpawnCommand {
	const explicit = process.env.PI_TEAMS_PI_BIN?.trim();
	if (explicit && fs.existsSync(explicit) && !isRunnableNodeScript(explicit)) return { command: explicit, args };
	if (process.platform === "win32") {
		const script = resolvePiCliScript();
		if (script) return { command: process.execPath, args: [script, ...args] };
	}
	return { command: "pi", args };
}
