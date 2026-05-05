# pi-crew Next Upgrade Roadmap

Date: 2026-05-05
Source inputs:

- `docs/research-oh-my-pi-distillation.md`
- `docs/source-runtime-refactor-map.md`
- Recent runtime hardening commits through `f5d47aa feat: surface run effectiveness evidence`

This document tracks the next practical upgrades after the current scaffold/no-op subagent fix, runtime safety classification, cancellation provenance, intent audit trail, prompt pipeline artifacts, capability inventory artifacts, and run effectiveness reporting.

## Current Baseline

Already implemented and pushed:

- Real child worker execution is the default.
- Implicit scaffold/no-op runs are blocked when worker execution is disabled by config/env.
- Explicit `runtime.mode=scaffold` remains available for dry-run prompt/artifact generation.
- Run `summary.md`, `progress.md`, and `status` now expose effectiveness evidence.
- Structured cancellation reasons flow through retry/cancel/team-runner/run events/metrics/UI snapshot.
- `cancel`, `cleanup`, `forget`, and `prune` accept audit intent metadata.
- Live-agent control distinguishes `steer` from `follow-up` at live-control/API level.
- Retry attempts have `attemptId`; max-retry deadletters link to the final `attemptId`.
- Worker prompt pipeline and capability inventory metadata artifacts are written per task.

## Priority Legend

- **P0**: correctness/safety issue; should be addressed before next release if feasible.
- **P1**: high user-visible value or reliability gain; good patch-release candidates.
- **P2**: larger subsystem work; should be planned and sequenced.
- **P3**: polish/UX/longer-term architecture.

## P0 — Prevent Ineffective Completed Runs

### P0.1 Enforce effectiveness policy for non-scaffold workers

**Problem**

`summary/status` now surface effectiveness evidence, but non-scaffold `child-process`/`live-session` runs can still end `completed` when task evidence is weak unless the existing mutation guard fires.

**Target behavior**

- For real workers, a run with completed tasks but no observable worker activity should be `blocked` or `failed`, not silently `completed`.
- Keep explicit scaffold dry-runs allowed, but label them as dry-runs.
- Policy should be configurable:
  - `runtime.effectivenessGuard = "off" | "warn" | "block" | "fail"`
  - default candidate: `warn` for read-only roles, `block` for mutating roles.

**Suggested files**

- `src/runtime/team-runner.ts`
- `src/runtime/completion-guard.ts`
- `src/state/types.ts` if storing guard result on manifest/tasks
- `src/schema/config-schema.ts`
- `src/config/config.ts`
- `test/unit/summary.test.ts`
- `test/unit/team-runner-merge.test.ts` or new `test/unit/effectiveness-guard.test.ts`

**Implementation sketch**

1. Extract run effectiveness calculation into a reusable exported helper, e.g.:

   ```ts
   export interface RunEffectivenessSummary {
     completed: number;
     observable: number;
     noObservedWorkTaskIds: string[];
     needsAttentionTaskIds: string[];
     workerExecution: "enabled" | "disabled/scaffold";
     severity: "ok" | "warning" | "blocked" | "failed";
   }
   ```

2. Use this helper for:
   - `progress.md`
   - `summary.md`
   - `status`
   - policy enforcement before `run.completed`.

3. For non-scaffold runs, if mutating tasks have no mutation/tool/model/transcript evidence:
   - append `policy.action` with `reason: "ineffective_worker"`;
   - set run `blocked` or `failed` depending config;
   - include task IDs in `data`.

**Acceptance criteria**

- A mocked child-process run with no tool/model/transcript evidence does not report clean `completed` by default.
- Scaffold run still completes as explicit dry-run and displays `Worker execution: disabled/scaffold`.
- `status` clearly lists `noObservedWork` and `needsAttention` task IDs.
- Unit tests cover warn/block/fail modes.

**Verification**

```bash
npx tsc --noEmit
node --experimental-strip-types --test --test-concurrency=1 --test-timeout=30000 test/unit/effectiveness-guard.test.ts test/unit/summary.test.ts
npm run test:unit
```

### P0.2 Make runtime safety visible in manifest and run events

**Problem**

`runtime.safety` exists in runtime resolution, but it is not persisted as first-class run metadata. Debugging currently requires reading events or inferred artifacts.

**Target behavior**

- Manifest records resolved runtime:

  ```json
  {
    "runtimeResolution": {
      "kind": "child-process",
      "requestedMode": "auto",
      "safety": "trusted",
      "fallback": "child-process",
      "reason": "..."
    }
  }
  ```

- `run.running` or `run.blocked` event includes the same resolution.

**Suggested files**

- `src/state/types.ts`
- `src/extension/team-tool/run.ts`
- `src/runtime/background-runner.ts`
- `src/extension/team-tool/status.ts`
- `test/unit/team-run.test.ts`
- `test/unit/runtime-resolver.test.ts`

**Acceptance criteria**

- `status` shows `Runtime safety: trusted|explicit_dry_run|blocked`.
- Blocked disabled-worker runs persist enough evidence to explain why no subagents spawned.
- Existing manifest schema remains backward compatible.

## P1 — Steering/Follow-up Semantics Beyond Live Control

### P1.1 Persist separate steering and follow-up queues in mailbox state

**Current state**

`follow-up-agent` exists in live-control, but durable mailbox is still generic inbox/outbox and `respond` still has waiting-task semantics.

**Target behavior**

- Mailbox messages can carry semantic kind:

  ```ts
  kind?: "message" | "steer" | "follow-up" | "response" | "group_join";
  priority?: "urgent" | "normal" | "low";
  deliveryMode?: "interrupt" | "next_turn";
  ```

- `steer-agent` appends durable steering queue entry when no live session is present.
- `follow-up-agent` appends durable follow-up queue entry, deliverable after task stop/resume.
- UI/status separates urgent steering from follow-up backlog.

**Suggested files**

- `src/state/mailbox.ts`
- `src/runtime/live-agent-control.ts`
- `src/runtime/live-agent-manager.ts`
- `src/extension/team-tool/api.ts`
- `src/extension/team-tool/respond.ts`
- `src/ui/dashboard-panes/mailbox-pane.ts`
- `test/unit/mailbox-api.test.ts`
- `test/unit/live-agent-control.test.ts`
- `test/unit/respond-tool.test.ts`

**Acceptance criteria**

- Steering and follow-up can be inspected separately.
- Existing inbox/outbox JSONL remains readable.
- Durable queue survives process/session switch.
- Realtime live delivery dedupes against durable replay.

### P1.2 Clarify `respond` vs `follow-up` UX

**Problem**

`respond` is currently a waiting-task resume primitive. Users may expect it to send a general follow-up.

**Target behavior**

- `/team-respond` remains only for `waiting` tasks.
- `/team-follow-up` or `api operation=follow-up-agent` is documented as continuation prompt.
- Error messages recommend the correct command.

**Suggested files**

- `src/extension/registration/commands.ts`
- `src/extension/help.ts`
- `docs/usage.md`
- `test/unit/registration-commands-coverage.test.ts`
- `test/unit/respond-tool.test.ts`

## P1 — Worker Lifecycle and Process Reliability

### P1.3 Two-phase child process teardown

**Current state**

Child workers have improved post-exit stdio guards and bounded drains, but cancellation semantics can be made more deterministic.

**Target behavior**

Worker process cancellation returns structured status:

```ts
interface WorkerExitStatus {
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  killed: boolean;
  signal?: string;
  cleanupErrors: string[];
  finalDrainMs: number;
}
```

Process lifecycle:

1. graceful cancel/TERM;
2. wait grace window;
3. hard kill process tree;
4. bounded stdout/stderr drain;
5. mark session non-reusable.

**Suggested files**

- `src/runtime/child-pi.ts`
- `src/runtime/pi-spawn.ts`
- `src/runtime/post-exit-stdio-guard.ts`
- `src/runtime/task-runner.ts`
- `src/runtime/cancellation.ts`
- `test/unit/child-pi*.test.ts`
- `test/integration/mock-child-run.test.ts`

**Acceptance criteria**

- Cancelled worker always produces terminal task event.
- Output drains are bounded.
- Status includes `cancelled/timedOut/killed`.
- No zombie/stale running task after cancellation.

### P1.4 Reserve worker control channel before spawn

**Problem**

There can be a short window where a task is logically starting but cancel/steer cannot target a controller yet.

**Target behavior**

- Synchronously create a `WorkerRunCore`/controller before async spawn.
- Persist controller metadata in agent status.
- Cancel/steer requests can be queued immediately while startup is in progress.
- Controller is cleared in `finally`.

**Suggested files**

- `src/runtime/task-runner.ts`
- `src/runtime/agent-control.ts`
- `src/runtime/live-agent-control.ts`
- `src/runtime/crew-agent-records.ts`
- `src/extension/team-tool/api.ts`

**Acceptance criteria**

- Starting worker can be cancelled immediately.
- Durable control request written during startup is applied or recorded as terminal no-op with reason.
- Tests simulate control request before child process emits first output.

## P1 — Cancellation and Attempt History

### P1.5 Add event-tree provenance: `parentEventId`, `attemptId`, `branchId`

**Current state**

Retry attempts have `attemptId`, and deadletters link to final attempt. Event log has sequence and terminal fingerprints but no general event tree.

**Target behavior**

- `TeamEvent.metadata` supports:

  ```ts
  parentEventId?: string;
  attemptId?: string;
  branchId?: string;
  causationId?: string;
  correlationId?: string;
  ```

- Retry events, task started/completed/failed, deadletter, recovery events link by `attemptId`.
- UI/status can show attempt timeline.

**Suggested files**

- `src/state/event-log.ts`
- `src/state/types.ts`
- `src/runtime/team-runner.ts`
- `src/runtime/retry-executor.ts`
- `src/runtime/recovery-recipes.ts`
- `src/extension/team-tool/status.ts`
- `test/unit/event-metadata.test.ts`
- `test/unit/retry-executor.test.ts`

**Acceptance criteria**

- Retry attempt events and terminal task events share attempt provenance.
- Deadletter records can be traced back to event sequence.
- Existing JSONL readers ignore missing provenance fields.

### P1.6 Synthetic terminal results for cancelled in-flight operations

**Problem**

Run/task cancellation events are now structured, but worker/tool sub-operations can still lack synthetic terminal records if cancelled mid-operation.

**Target behavior**

- If a task started a worker/tool/model call and cancellation occurs, append a synthetic terminal record:
  - `tool.cancelled` or `worker.cancelled`
  - reason code/message
  - startedAt/finishedAt
  - attemptId if available

**Suggested files**

- `src/runtime/task-runner.ts`
- `src/runtime/task-runner/progress.ts`
- `src/runtime/child-pi.ts`
- `src/runtime/cancellation.ts`
- `src/state/contracts.ts`
- `test/unit/cancellation.test.ts`

**Acceptance criteria**

- No started tool/model operation is left without terminal evidence after cancellation.
- Status/diagnostics can distinguish user cancel vs timeout vs shutdown.

## P1 — Capability Inventory and Control Center

### P1.7 Build run/project capability inventory view

**Current state**

Per-task capability artifacts exist. There is no unified project/run inventory UI/API yet.

**Target behavior**

`/team-settings` or new `/team-control` shows normalized inventory:

```ts
interface CapabilityItem {
  id: string;
  kind: "team" | "workflow" | "agent" | "skill" | "tool" | "hook" | "runtime" | "provider";
  name: string;
  source: "builtin" | "project" | "user" | "runtime";
  path?: string;
  state: "active" | "disabled" | "shadowed" | "missing";
  disabledReason?: string;
  shadowedBy?: string;
}
```

**Suggested files**

- `src/extension/team-tool/handle-settings.ts`
- `src/extension/management.ts`
- `src/agents/discover-agents.ts`
- `src/teams/discover-teams.ts`
- `src/workflows/discover-workflows.ts`
- `src/runtime/skill-instructions.ts`
- `docs/resource-formats.md`
- `test/unit/management.test.ts`

**Acceptance criteria**

- Inventory is stable and sorted.
- Shadowed project/user/builtin resources are visible.
- Skill disabled/budget state is visible.
- No file path is used as the only stable ID.

### P1.8 Persist capability disables by stable ID

**Target behavior**

- Operator can disable a skill/agent/team by capability ID.
- Disable config survives path relocation when resource identity remains stable.
- Status explains disabled reason.

**Suggested files**

- `src/config/config.ts`
- `src/schema/config-schema.ts`
- discovery modules
- `test/unit/config-schema-validation.test.ts`

## P2 — Typed Hook Lifecycle

### P2.1 Introduce typed hook contract

**Target behavior**

Define typed lifecycle gates:

- `before_run_start`
- `before_task_start`
- `task_result`
- `before_cancel`
- `before_forget`
- `before_cleanup`
- `before_publish`
- `session_before_switch`
- `run_recovery`

Each hook declares:

```ts
type HookMode = "blocking" | "non_blocking";
type HookOutcome = "allow" | "block" | "modify" | "diagnostic";
```

Errors are recorded in diagnostics/events, not uncontrolled exceptions.

**Suggested files**

- new `src/hooks/*`
- `src/extension/register.ts`
- `src/runtime/team-runner.ts`
- `src/extension/team-tool/cancel.ts`
- `src/extension/team-tool/lifecycle-actions.ts`
- `docs/resource-formats.md`
- `test/unit/hooks*.test.ts`

**Acceptance criteria**

- Blocking hook can stop a run before worker start with clear event and status.
- Non-blocking hook failure records diagnostic and does not crash run.
- Hook context is redacted and bounded.

### P2.2 Require intent via policy/hook for destructive actions

**Current state**

Intent is optional for cancel/cleanup/forget/prune.

**Target behavior**

- Optional config:

  ```json
  {
    "policy": {
      "requireIntentForDestructiveActions": true
    }
  }
  ```

- Actions requiring intent:
  - cancel
  - forget
  - prune
  - cleanup with force
  - publish/release helpers if added
  - worktree removal

**Acceptance criteria**

- Missing intent blocks action with actionable error.
- Existing tests can opt out or provide intent.
- Audit trail includes intent after approval.

## P2 — Durable History vs Prompt Projection

### P2.3 Separate durable run history projection from worker prompt text

**Current state**

Prompt pipeline artifacts exist, but context projection logic is still coupled to prompt construction in multiple places.

**Target behavior**

Introduce explicit projection functions:

```ts
transformRunContextBeforeWorkerStart(...)
convertRunHistoryToWorkerPrompt(...)
```

Rules:

- Durable history retains events, mailbox, artifacts, UI/runtime metadata.
- Worker prompt gets a bounded projection.
- UI/runtime events are not prompt text unless explicitly selected.

**Suggested files**

- `src/runtime/task-runner/prompt-pipeline.ts`
- `src/runtime/task-runner/prompt-builder.ts`
- `src/runtime/task-output-context.ts`
- `src/runtime/task-runner.ts`
- `test/unit/task-runner-prompt-pipeline.test.ts`

**Acceptance criteria**

- Prompt pipeline artifact identifies every projection source.
- Large event/mailbox history is summarized or referenced, not blindly embedded.
- Tests verify UI/runtime events are not injected as instructions.

## P2 — Cooperative Cancellation for Internal Scans

### P2.4 Add internal `CancellationToken`

**Target behavior**

A utility for long internal loops:

```ts
interface CancellationToken {
  readonly aborted: boolean;
  readonly reason?: CancellationReason;
  heartbeat(stage?: string): void;
  throwIfCancelled(): void;
  wait(ms: number): Promise<void>;
}
```

Use it in:

- run index scans
- artifact cleanup
- mailbox validation/replay
- worktree cleanup
- diagnostic export
- large transcript/event reads

**Suggested files**

- new `src/runtime/cancellation-token.ts`
- `src/extension/run-index.ts`
- `src/extension/registration/artifact-cleanup.ts`
- `src/state/mailbox.ts`
- `src/ui/run-snapshot-cache.ts`
- `test/unit/cancellation-token.test.ts`

**Acceptance criteria**

- Long scan can abort within bounded cadence.
- Heartbeat stage appears in diagnostics/logs.
- Existing APIs can pass no token and keep current behavior.

## P2 — Artifact Store Improvements

### P2.5 Content-addressed blob artifacts

**Target behavior**

Large logs/transcripts/results are stored as blobs:

```text
artifacts/blobs/sha256/<hash>
artifacts/blob-metadata/<hash>.json
```

Metadata includes:

- runId/taskId
- MIME/type
- producer
- original path/name
- size/hash
- redaction status
- retention policy

**Suggested files**

- `src/state/artifact-store.ts`
- `src/runtime/task-runner.ts`
- `src/ui/transcript-viewer.ts`
- `src/extension/run-export.ts`
- `src/extension/run-import.ts`
- `test/unit/artifact-store*.test.ts`

**Acceptance criteria**

- Artifacts above threshold are blob-referenced.
- Run export/import preserves blobs.
- GC removes unreferenced blobs after retention.
- Path traversal protections remain intact.

## P2 — UI and Dashboard Upgrades

### P2.6 Show capability/effectiveness/cancellation panels in dashboard

**Target behavior**

Dashboard panes expose:

- run effectiveness score and no-observed-work tasks;
- cancellation reason and intent;
- capability inventory for selected task;
- attempt/deadletter timeline.

**Suggested files**

- `src/ui/run-dashboard.ts`
- `src/ui/dashboard-panes/*`
- `src/ui/snapshot-types.ts`
- `src/ui/run-snapshot-cache.ts`
- `test/unit/run-dashboard.test.ts`
- new pane tests

**Acceptance criteria**

- No heavy synchronous scans in render path.
- Pane output is width-safe.
- Snapshot cache provides precomputed compact data.

### P2.7 Event-first UI stream

**Target behavior**

Move more live UI updates from file polling to semantic events:

- `task_started`
- `task_completed`
- `worker_status`
- `mailbox_updated`
- `effectiveness_changed`

**Acceptance criteria**

- Render scheduler remains coalesced and overlap-safe.
- UI still recovers from durable files after restart.
- File polling is fallback, not the hot path.

## P2 — Raw Scan Entry Cache

### P2.8 Cache raw entries, not final semantic query results

**Target behavior**

Shared raw scan cache for:

- runs
- artifacts
- mailbox files
- transcript chunks
- worktree roots

Then apply filters/sorts after retrieval.

**Suggested files**

- `src/runtime/manifest-cache.ts`
- `src/ui/run-snapshot-cache.ts`
- `src/extension/run-index.ts`
- `src/utils/file-coalescer.ts`

**Acceptance criteria**

- Deterministic sort order.
- State mutation invalidates relevant raw entries.
- Large workspaces do not trigger full rescans on every render/status.

## P3 — Release/Install Hardening

### P3.1 Tarball install smoke before publish

**Target behavior**

Release workflow requires:

```bash
npm run ci
npm pack --dry-run
npm pack
# install tarball in temp project
# verify pi extension load smoke
# verify npm package files and version/tag consistency
```

**Suggested files**

- `docs/publishing.md`
- `package.json` scripts
- `.github/workflows/*` if CI is added
- optional `scripts/release-smoke.mjs`

**Acceptance criteria**

- Packed tarball loads extension in temp Pi home.
- Version in package, changelog, tag, npm view are consistent.
- Release instructions include rollback notes.

## Suggested Implementation Order

1. **P0.1 Effectiveness policy enforcement** — prevents misleading completed runs.
2. **P0.2 Persist runtime safety** — improves debugging for worker spawn issues.
3. **P1.3 Two-phase worker teardown** — reduces stale/zombie worker risk.
4. **P1.1 Durable steering/follow-up queues** — completes semantic split started at live-control level.
5. **P1.5 Event-tree provenance** — builds on current `attemptId` work.
6. **P1.7 Capability inventory view** — turns existing per-task artifacts into operator UX.
7. **P2.3 Durable history projection** — reduces prompt/context risks.
8. **P2.4 CancellationToken** — improves responsiveness of internal scans.
9. **P2.5 Blob artifacts** — prevents log/transcript bloat.
10. **P2.6 Dashboard panels** — surface all new evidence in UI.

## Release Guidance

Before publishing a patch with these upgrades:

```bash
npx tsc --noEmit
npm run test:unit
npm run test:integration
npm pack --dry-run
```

For runtime/process changes also run targeted child-worker integration tests:

```bash
node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 \
  test/integration/mock-child-run.test.ts \
  test/integration/mock-child-json-run.test.ts \
  test/integration/phase6-runtime-hardening.test.ts
```

Do not publish without explicit user confirmation and a green verification pass.
