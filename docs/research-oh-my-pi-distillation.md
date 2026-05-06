# oh-my-pi Distillation for pi-crew

Date: 2026-05-05
Source repo: `Source/oh-my-pi` at `1d898a7fe chore: bump version to 14.5.3`.

## Scope Read

Read-only exploration covered four source areas:

- Agent/provider runtime: `packages/agent`, `packages/ai`.
- Main CLI/session/task implementation: `packages/coding-agent`.
- TUI, extensions, hooks, skills, marketplace, rulebook docs and implementation.
- Native/Rust reliability/performance/release docs and implementation.

Representative files and docs inspected:

- `packages/agent/src/agent-loop.ts`, `packages/agent/src/agent.ts`, `packages/agent/src/types.ts`.
- `packages/ai/src/stream.ts`, `packages/ai/src/model-manager.ts`, `packages/ai/src/utils/{abort,retry,event-stream,overflow}.ts`, provider adapters.
- `packages/coding-agent/src/session/*`, `src/extensibility/{hooks,slash-commands,skills,plugins}/*`, `src/task/*`, `src/edit/*`, prompts.
- `packages/tui/src/tui.ts`, `docs/tui*.md`, `docs/extensions.md`, `docs/hooks.md`, `docs/skills.md`, `docs/marketplace.md`, `docs/rulebook-matching-pipeline.md`.
- `crates/pi-natives/src/{task,shell,pty,fs_cache,glob,fd,grep}.rs`, natives docs, install/release scripts.

This document rewrites the useful ideas as pi-crew-native patterns. It does not vendor or copy source code.

## High-Value Patterns to Adopt

### 1. Separate durable run history from provider/model context

oh-my-pi keeps rich internal session messages separate from LLM-compatible provider messages. Custom events, UI messages, hook entries, and branch/compaction entries can live in durable history, while a conversion layer decides what reaches the model.

pi-crew application:

- Keep `TeamRunManifest`, task records, mailbox messages, artifacts, worker events, and review/verification notes as durable run history.
- Add a projection/conversion step before worker prompt/model invocation:
  - `transformRunContextBeforeWorkerStart(...)` for pruning/context injection.
  - `convertRunHistoryToWorkerPrompt(...)` for provider/child-Pi compatible text.
- Avoid treating UI/runtime events as prompt text by default.

Benefit: safer compaction, mailbox summarization, and artifact hygiene without losing durable audit history.

### 2. Distinguish steering from follow-up

oh-my-pi's agent runtime distinguishes interrupting current work (`steer`) from continuing after the agent would otherwise stop (`followUp`).

pi-crew application:

- Model leader/operator messages as two queues:
  - `steeringQueue`: urgent cancellation, nudge, priority change, user answer while worker is active.
  - `followUpQueue`: review/verification/documentation after a task reaches a natural stop.
- Default to one-at-a-time delivery to reduce context shock.
- Persist queue entries and delivery status in task mailbox/state.

Benefit: clearer interactive semantics than a single generic respond/resume path.

### 3. Preserve invariants on cancellation and abort

oh-my-pi propagates `AbortSignal` through model streaming and tool execution, distinguishes caller abort from provider-local watchdog abort, and emits synthetic tool results when abort happens after tool calls were started.

pi-crew application:

- Use structured cancel reasons:
  - `caller_cancelled`
  - `leader_interrupted`
  - `provider_timeout`
  - `worker_timeout`
  - `tool_timeout`
  - `shutdown`
- If a worker/tool/action has started but is cancelled, emit a terminal synthetic event/result so task history has no dangling operation.
- Add non-abortable cleanup/finalize phases for artifact preservation and state unlock.

Benefit: fewer stuck `running` tasks and clearer recovery after cancellation.

### 4. Batch-aware execution with shared vs exclusive operations

oh-my-pi marks tools with concurrency semantics: shared tools can run concurrently, exclusive tools serialize around shared/exclusive peers, and queued tools can be skipped when steering arrives.

pi-crew application:

- Classify worker subtasks or internal operations:
  - shared: read-only exploration, status, grep, artifact reads.
  - exclusive: edits, package manifests, lockfiles, migration/schema updates, worktree merge.
- Attach `batchId`, `index`, `total`, and `conflictKey` metadata to task execution.
- On new steering, skip not-yet-started low-priority operations with explicit skip reason.

Benefit: safer parallelism and more auditable conflict handling.

### 5. Intent tracing for destructive/tool actions

oh-my-pi optionally injects an intent field into tool schemas, strips it before execution, and keeps it for auditability.

pi-crew application:

- Add optional `_intent`/`intent` metadata to worker tool/action events.
- Require intent for destructive actions: cancel, delete, prune, force cleanup, edits, package publish, worktree removal.
- Store intent in events/artifacts but never pass it to low-level execution APIs if not needed.

Benefit: reviewable why/what for high-risk actions without changing execution payloads.

### 6. Event-first UI with tiny component contract and coalesced rendering

oh-my-pi TUI uses small components (`render(width)`, `handleInput`, `invalidate`) and event-driven, coalesced rendering. Components must be width-safe and lifecycle-clean.

pi-crew application:

- Keep dashboards/widgets as projections from snapshot/event state, not direct filesystem scanners.
- Continue using render scheduler/coalescing; add width-safety tests for all dashboard panes/widgets.
- Components should expose `dispose()` for timers/theme subscriptions.
- UI event stream should be semantic (`task_started`, `worker_status`, `mailbox_updated`) rather than raw file polling.

Benefit: avoids UI freezes and makes live views predictable.

### 7. Two-phase extension lifecycle

oh-my-pi extensions have a registration phase where side-effecting runtime methods are unavailable, followed by an initialized phase with real context/actions.

pi-crew application:

- If pi-crew grows plugin/extension support, split APIs into:
  - `registerCrewExtension(api)`: declare teams, workflows, hooks, commands, renderers.
  - `initializeCrewExtension(context)`: subscribe to events, perform side effects.
- In headless mode, UI APIs should be explicit no-ops or unavailable via `hasUI`.
- Loader should collect extension errors without breaking builtin teams.

Benefit: fewer load-time side effects and safer third-party extensibility.

### 8. Unified capability inventory/control center

oh-my-pi normalizes extensions, skills, rules, tools, hooks, MCPs, prompts, and slash commands into a shared dashboard model with active/disabled/shadowed states.

pi-crew application:

- Extend `/team-settings` or add `/team-control` to show a unified inventory:
  - teams, workflows, agents, skills, hooks/policies, tools, runtime providers.
- Normalize each item to:
  - `id`, `kind`, `name`, `description`, `source`, `path`, `state`, `disabledReason`, `shadowedBy`, `raw`.
- Persist disables by stable capability ID, not file path.

Benefit: better operator experience for complex multi-resource setups.

### 9. Hooks as typed lifecycle gates, not ad-hoc shell glue

oh-my-pi hooks cover session lifecycle, before-agent-start, tool-call gates, tool-result transforms, and compaction events. Blocking hooks are scoped; non-blocking hook errors are captured but do not crash streaming.

pi-crew application:

- Define typed crew hooks:
  - `before_run_start`
  - `before_task_start`
  - `task_result`
  - `before_cancel`
  - `before_publish`
  - `session_before_switch`
  - `run_recovery`
- Mark hooks as blocking or non-blocking.
- Capture hook errors into diagnostics/status, not uncontrolled exceptions.

Benefit: safer customization for policy/security/release gates.

### 10. Prompt pipeline should be explicit

oh-my-pi applies slash/custom commands, templates, compaction, file mentions, hook injection, and model validation in a clear order before calling the agent.

pi-crew application:

Define a worker prompt pipeline:

1. Parse orchestration command/control intent.
2. Expand prompt templates/task packet.
3. Attach selected context/artifact/mailbox summaries.
4. Run `before_worker_start` hooks.
5. Persist exact task packet/artifacts.
6. Launch worker.

Benefit: reproducible worker prompts and easier debugging of context injection.

### 11. Session/run history as append-only tree

oh-my-pi persists session entries with parent relationships. Branching/forking moves the current leaf rather than rewriting past history.

pi-crew application:

- Keep `events.jsonl` append-only and add optional `parentEventId` / `attemptId` / `branchId` fields for retries/forks.
- Represent retry attempts as child branches from the original task prompt/result.
- Preserve old failed attempts instead of overwriting task state only.

Benefit: better auditability and replay/debug of retries.

### 12. Cooperative cancellation token for long loops

oh-my-pi native code uses cancel tokens with deadlines, abort signals, `heartbeat()`, and async wait. Long loops over external-size input must heartbeat at bounded cadence.

pi-crew application:

- Add a TS `CancellationToken` utility for internal long-running loops:
  - `heartbeat(stage?: string)`
  - `throwIfCancelled()`
  - `wait()`
  - `abort(reason)`
- Require it in scanners over runs, artifacts, mailboxes, worktrees, and event logs.

Benefit: bounded shutdown/cancel latency and easier stuck-loop diagnostics.

### 13. Process lifecycle: graceful cancel, forced kill, then non-reuse

oh-my-pi shell/PTY runtime cancels gracefully, waits a grace window, forces abort/kill, drains output for bounded windows, and discards persistent sessions after cancellation/errors.

pi-crew application:

- For child Pi workers:
  - send graceful abort/TERM;
  - wait `graceMs`;
  - force-kill process tree;
  - drain stdout/stderr for bounded time;
  - mark session non-reusable after timeout/protocol error/cancel.
- Return typed status `{ exitCode, cancelled, timedOut, killed, cleanupErrors }`.

Benefit: more deterministic worker cleanup and fewer zombie/stale runs.

### 14. Reserve control channel before async worker start

oh-my-pi PTY reserves its control channel before async process start, rejects duplicate starts, and always clears state in completion.

pi-crew application:

- Install a `WorkerRunCore`/controller synchronously before spawn returns.
- Expose cancel/steer immediately, even while startup is still in progress.
- Clear controller in `finally` and persist terminal state.

Benefit: closes race windows where operator cannot cancel a starting worker.

### 15. Cache scan entries, not final query results

oh-my-pi native search caches directory entries and applies query-specific filters/scoring later. Empty stale caches trigger rescan; ordering is deterministic.

pi-crew application:

- For run/artifact/mailbox discovery, cache raw entries/stats rather than final UI results.
- Apply active-status/mailbox/health filters after cache retrieval.
- Invalidate cache after state mutation.
- Use deterministic sort keys for dashboards and summaries.

Benefit: faster UI/status with fewer stale semantic bugs.

### 16. Blob artifacts and bounded file access

oh-my-pi blob-artifact design uses content addressing, metadata sidecars, streaming writes, size budgets, manifest GC, and path whitelisting.

pi-crew application:

- Introduce content-addressed large artifacts for worker transcripts/screenshots/log chunks.
- Persist metadata sidecars with MIME, source, redaction, run/task IDs, size, hash.
- Keep task prompts/results small by referencing artifact IDs.
- Add GC tied to run retention.

Benefit: avoids bloating task JSON/events and improves artifact security.

### 17. Native/release verification checklist mindset

oh-my-pi release scripts emphasize multi-platform build artifacts, install smoke tests, spoofed-version checks, and runtime loader fallback diagnostics.

pi-crew application:

- For npm releases, keep a release checklist with:
  - typecheck;
  - unit/integration tests;
  - `npm pack --dry-run`;
  - install from packed tarball in temp project;
  - Pi extension load smoke;
  - version/tag/npm consistency check.

Benefit: fewer broken published packages.

## Skill/Rulebook Ideas to Port

oh-my-pi's skills/rulebook ecosystem suggests additional pi-crew resources:

1. `worker-prompt-pipeline` skill: prompt assembly, context projection, before-worker hooks, artifact references.
2. `typed-hook-design` skill: lifecycle gates, blocking vs non-blocking hooks, diagnostics.
3. `process-cancellation-contract` skill: graceful/force kill, synthetic terminal results, non-reuse.
4. `capability-inventory-ux` skill: normalized resource inventory and disable/shadow semantics.
5. `append-only-run-history` skill: event tree, branch/retry provenance.

## Implementation Status as of `v0.1.46`

This distillation has been **partially implemented**. It should remain open as a source of backlog items rather than be marked fully complete.

### Implemented / mostly implemented

- Real worker default, explicit scaffold mode, and disabled-worker blocking.
- Structured cancellation reasons and worker-level terminal evidence for cancelled child workers.
- Prompt pipeline artifacts and exact per-task prompt/capability metadata artifacts.
- Runtime safety metadata persisted on run manifests/status.
- Effectiveness evidence surfaced in status/summary/progress.
- Retry attempt IDs and deadletter linkage.
- Render coalescing/snapshot caching improvements that reduce hot-path UI work.
- Release checklist basics: typecheck, unit/integration tests, and `npm pack --dry-run` are part of `npm run ci`.

### Partial

- Steering vs follow-up: mailbox semantic fields and durable helpers exist, but separate UI/status queues and a dedicated `/team-follow-up` command are not implemented.
- Cancellation invariants: `worker.cancelled` evidence exists, but generic synthetic `tool.cancelled` / model-operation terminal records are missing.
- Durable history vs prompt projection: durable artifacts exist, but explicit projection/conversion functions are still not separated from prompt building.
- Event-first UI: UI work is coalesced, but several views still use durable file polling as primary data retrieval.
- Append-only run-history tree: event JSONL is append-only and retry IDs exist, but parent/branch/causation metadata is missing.
- Process lifecycle: child worker exit status and forced cleanup exist, but pre-spawn controller reservation and full control-channel semantics are missing.
- Release hardening: GitHub/npm release flow works, but temp tarball install/Pi load smoke/version consistency checks are not yet automated.

### Missing / backlog

- Shared/exclusive operation metadata (`batchId`, `index`, `total`, `conflictKey`) and skip-on-steering semantics.
- Two-phase pi-crew extension lifecycle for third-party crew plugins.
- Unified capability inventory/control center with stable capability-disable IDs.
- Typed hook lifecycle gates.
- Policy-enforced required intent for destructive actions.
- Cooperative `CancellationToken` for long internal loops/scans.
- Content-addressed blob artifacts with metadata sidecars and GC.
- Raw scan-entry cache shared by dashboard/status/artifact lookup.

## Prioritized Backlog for pi-crew

### P0 / High confidence

- Fix current runtime review findings first: waiting final status, respond semantics, no-registry model routing.
- Add structured cancellation reason and terminal synthetic result/event for cancelled workers.
- Centralize worker prompt pipeline and persist exact prompt packets.
- Add width-safety tests for dashboard/widget lines.

### P1 / Medium-term architecture

- Add steering vs follow-up mailbox queues.
- Add typed hook lifecycle for `before_task_start`, `task_result`, `before_cancel`, `session_before_switch`.
- Add capability inventory model for teams/workflows/agents/skills/hooks/tools.
- Add `CancellationToken` for long internal loops and scans.

### P2 / Larger subsystem work

- Append-only run-history tree with attempt/branch parentage.
- Content-addressed blob artifact store with metadata sidecars and GC.
- Worker process controller installed before spawn; process non-reuse after cancel/protocol error.
- Raw scan-entry cache shared by dashboard/status/artifact lookup.

## Anti-Patterns to Avoid

- Building prompts from scattered inline string concatenation without a traceable pipeline.
- Treating UI render as a place to perform heavy filesystem scans.
- Auto-opening modal/right-sidebar UI by default when a compact widget/status line would suffice.
- Dropping queued user-facing results just because session generation changed.
- Cancelling a task without writing a terminal event/result.
- Caching semantic query results that should be recomputed from raw state.
- Letting one bad extension/resource prevent builtin operation.

## Immediate Review Questions for Future Implementation

- Should pi-crew project-local skills be allowed to shadow builtin safety skills by default, or require explicit `project:` namespace?
- Should `respond` enqueue durable work or only deliver to live workers? Current semantics need to become explicit.
- What is the stable capability ID scheme for teams/workflows/agents/skills/hooks?
- Which hook events should be blocking by default and which should be diagnostic-only?
- What artifact size threshold should trigger blob storage instead of embedding content in task/events JSON?
