# pi-crew runtime refactor source map

This document records the source projects used as the baseline for the pi-crew subagent/runtime refactor. The goal is to avoid ad-hoc fixes in critical process orchestration paths and instead align pi-crew with proven Pi extension patterns.

## Source/pi-subagents

Primary source for child-process worker execution.

- `pi-spawn.ts`: robust Pi CLI resolution on Windows and package installs.
- `async-execution.ts`: detached async runner with `windowsHide: true` to avoid blank console windows.
- `subagent-runner.ts`: streaming child Pi process runner, output capture, result extraction.
- `post-exit-stdio-guard.ts`: guards for child processes that exit before stdio fully closes.
- `result-watcher.ts` and `async-job-tracker.ts`: durable async job/result observation patterns.
- `model-fallback.ts`: model fallback policy independent of hardcoded provider assumptions.
- `subagent-control.ts`, `run-status.ts`: status and control semantics.

pi-crew alignment:

- Background runner and child worker spawn options now explicitly set `windowsHide: true`.
- Parallel research no longer gates all shard workers behind a single discover worker.
- Further work should consolidate `child-pi.ts`, `async-runner.ts`, and `subagent-manager.ts` into a durable-first subagent runtime module.

## Source/pi-subagents2

Primary source for higher-level agent management and UI patterns.

- `src/agent-manager.ts`: agent lifecycle registry boundaries.
- `src/agent-runner.ts`: invocation/run abstraction separate from UI registration.
- `src/model-resolver.ts`: cleaner model resolution responsibility.
- `src/output-file.ts`: output file abstraction.
- `src/ui/agent-widget.ts`, `src/ui/conversation-viewer.ts`: compact live status and transcript viewing.

pi-crew alignment:

- Keep `Agent`/`crew_agent` tools as thin adapters over a durable manager.
- Avoid storing essential run mapping in memory only.
- Keep UI active-only and file-backed.

## Source/pi-mono

Primary source for Pi extension API/lifecycle constraints.

- `packages/coding-agent/src/core/extensions/types.ts`: extension context/tool contracts.
- `packages/coding-agent/src/core/extensions/runner.ts`: extension execution boundaries.
- `packages/coding-agent/src/core/model-registry.ts`: available model discovery.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`: session lifecycle/UI behavior.

pi-crew alignment:

- Treat session-bound foreground workers differently from explicit async background workers.
- Do not assume hardcoded providers/models.
- Use Pi-native UI calls without modal auto-open by default.

## Source/pi-powerbar, pi-plan, pi-diff-review, pi-extensions*

Sources for UI and small-extension patterns.

- `pi-powerbar/src/powerbar/*`: low-noise status segment publishing.
- `pi-plan/src/plan-action-ui.ts`: action-oriented UI without persistent heavy overlays.
- `pi-diff-review/src/*`: command/tool registration and review UX patterns.
- `pi-extensions2/files-widget/*`: file-backed UI composition and navigation.

pi-crew alignment:

- Keep persistent widget active-only.
- Prefer manual dashboard/transcript commands for history.
- Avoid expensive render scans and auto-opening focus-capturing overlays.

## Source/oh-my-pi

Primary source for broader agent runtime, UI, extension, hook, skill, native process, and release patterns.

Detailed distillation: `docs/research-oh-my-pi-distillation.md`.
Next implementation roadmap: `docs/next-upgrade-roadmap.md`.

Key patterns to apply:

- Separate durable run history from worker/provider prompt context.
- Distinguish steering (interrupt active work) from follow-up (continue after idle).
- Preserve cancellation invariants with structured cancel reasons and synthetic terminal events.
- Use shared/exclusive execution semantics and intent tracing for risky actions.
- Keep TUI components small, width-safe, event-driven, coalesced, and lifecycle-clean.
- Split extension/plugin lifecycle into register vs initialized side-effect phases.
- Normalize teams/workflows/agents/skills/hooks/tools into a capability inventory with disabled/shadowed states.
- Add typed lifecycle hooks for crew operations.
- Move toward append-only run history with attempt/branch provenance.
- Use cooperative cancellation tokens and two-phase process teardown for workers.
- Cache raw scan entries, not final semantic query results.
- Consider content-addressed blob artifacts for large worker outputs/log chunks.

## Current refactor checkpoints

- [x] Hide Windows console windows for background runner and child Pi workers.
- [x] Make parallel research shard workers start in parallel instead of depending on a single discover worker.
- [x] Keep direct-agent reconstruction gated by `workflow === "direct-agent"` only.
- [x] Persist subagent records and recover terminal results after restart.
- [x] Fail fast for unrecoverable persisted records without `runId` instead of hanging.
- [x] Persist direct-agent model override into task state for background/resume reconstruction.

For the current prioritized upgrade backlog, see `docs/next-upgrade-roadmap.md`.

## Remaining larger subsystem work

- Consolidate subagent runtime into `src/subagents/*` or equivalent durable-first module.
- Move model routing transparency into persisted task/subagent records: requested model, selected model, fallback chain, fallback reason.
- Add real integration smoke scripts for Windows process visibility, async restart recovery, and multi-shard fanout.
- Add adaptive planner repair/retry for invalid JSON instead of immediate block when safe.
