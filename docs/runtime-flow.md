# pi-crew Runtime Flow

This document is a compact map of the runtime paths used by `pi-crew`.

## Main sequence

```text
User / model
  │ calls team({ action: "run", ... }) or /team-run
  ▼
handleTeamTool()
  │ validates schema and routes action
  ▼
handleRun()
  ├─ discoverTeams/discoverWorkflows/discoverAgents
  ├─ validateWorkflowForTeam
  ├─ expandParallelResearchWorkflow when applicable
  ├─ createRunManifest + tasks.json + goal artifact
  ├─ if async=true ─────────────────────────────────────────────┐
  │   spawnBackgroundTeamRun()                                  │
  │     ├─ resolve jiti-register.mjs                            │
  │     ├─ fail-fast if jiti missing                            │
  │     ├─ node --import jiti-register.mjs background-runner.ts  │
  │     └─ parent schedules early-exit guard                    │
  │                                                            ▼
  │   background-runner.ts
  │     ├─ append async.started
  │     ├─ write async.pid startup marker
  │     ├─ rediscover team/workflow/agents
  │     └─ executeTeamRun()
  │
  └─ if foreground/default
      ├─ startForegroundRun schedules session-bound run, or
      └─ executeTeamRun inline for scaffold/non-scheduled paths

executeTeamRun()
  ├─ write run.running
  ├─ materialize queued/running agent records lazily
  ├─ build task graph index
  ├─ while queued tasks exist
  │   ├─ taskGraphSnapshot
  │   ├─ resolveBatchConcurrency
  │   ├─ getReadyTasks
  │   ├─ append task.progress batch event
  │   ├─ mapConcurrent ready batch
  │   │   └─ runTeamTask()
  │   │       ├─ prepare workspace/worktree
  │   │       ├─ build task packet
  │   │       ├─ render prompt + dependency context
  │   │       ├─ choose model candidates from Pi config
  │   │       ├─ spawn child Pi process
  │   │       ├─ ChildPiLineObserver parses stdout/stderr
  │   │       ├─ append per-agent events/output
  │   │       ├─ update agent progress/task state
  │   │       ├─ parse final JSONL/session usage
  │   │       └─ write result/log/transcript/metadata artifacts
  │   ├─ merge task updates monotonically
  │   ├─ optional adaptive plan injection
  │   ├─ save tasks/agents/progress
  │   └─ write batch artifact
  ├─ policy closeout
  └─ run.completed / run.failed / run.blocked / run.cancelled
```

## Action router

| Action | Handler | Purpose |
|---|---|---|
| `run` | `team-tool/run.ts` | Create and execute a run, foreground or async. |
| `status` | `team-tool.ts` | Show manifest/tasks/agents/events and mark stale async runs failed. |
| `summary` | `session-summary.ts`/summary handler | Write/read run summary artifact. |
| `events` | `team-tool.ts` | Tail durable run events. |
| `artifacts` | `team-tool.ts` | List run artifacts. |
| `resume` | `team-tool.ts` | Requeue failed/cancelled/skipped/running tasks. |
| `cancel` | `team-tool.ts` | Mark queued/running tasks cancelled and request foreground interrupt. |
| `forget` | `run-maintenance.ts` | Delete run state/artifacts with confirmation. |
| `prune` | `run-maintenance.ts` | Remove old finished runs with confirmation. |
| `export` | `run-export.ts` | Create portable run bundle. |
| `import` / `imports` | `run-import.ts` / `import-index.ts` | Store/list imported bundles. |
| `config` | `config.ts` + config action | Show/update user/project config. |
| `doctor` | `team-tool/doctor.ts` | Platform/resource/runtime diagnostics. |
| `validate` | `validate-resources.ts` | Validate agents/teams/workflows. |
| `recommend` | `team-recommendation.ts` | Suggest team/workflow/action for a goal. |
| management | `management.ts` | Create/update/delete/rename teams, agents, workflows. |
| API | `team-tool/api.ts` | File-backed observability/control/mailbox API. |

## Worker modes

| Mode | Behavior |
|---|---|
| `child-process` | Default. Launches real child `pi` processes per task. |
| `scaffold` | Explicit dry-run. No child Pi worker execution. |
| `live-session` | Experimental/gated in-process/live agent path. |
| `auto` | Resolves to child-process unless config/env requests otherwise. |

## Important files

```text
src/extension/register.ts              Pi extension entry/wiring
src/extension/team-tool/run.ts         run creation and foreground/async split
src/runtime/background-runner.ts       detached async entrypoint
src/runtime/async-runner.ts            background spawn command/options
src/runtime/team-runner.ts             workflow/task graph scheduler
src/runtime/task-runner.ts             single task execution
src/runtime/child-pi.ts                child Pi process and output observer
src/runtime/model-fallback.ts          configured model candidates/routing
src/runtime/concurrency.ts             batch concurrency decisions
src/runtime/process-status.ts          pid/liveness/stale detection
src/state/state-store.ts               manifest/tasks persistence
src/state/event-log.ts                 JSONL run events
src/runtime/crew-agent-records.ts      aggregate + per-agent status files
```

## Environment variables

| Env | Effect |
|---|---|
| `PI_CREW_EXECUTE_WORKERS=0` | Disable real workers, use scaffold behavior. |
| `PI_TEAMS_EXECUTE_WORKERS=0` | Legacy alias for worker disable. |
| `PI_CREW_ENABLE_EXPERIMENTAL_LIVE_SESSION=1` | Allow experimental live-session runtime. |
| `PI_CREW_MOCK_LIVE_SESSION=success` | Test hook for live-session mock. |
| `PI_TEAMS_MOCK_CHILD_PI` | Test hook for mocked child Pi execution. |
| `PI_CREW_DEPTH`, `PI_CREW_MAX_DEPTH` | Canonical subagent recursion guard. |
| `PI_TEAMS_DEPTH`, `PI_TEAMS_MAX_DEPTH` | Legacy recursion guard aliases. |
| `PI_TEAMS_HOME` | Override user config/state home in tests. |
| `PI_TEAMS_PI_BIN` | Override child `pi` executable. |
| `PI_CODING_AGENT_DIR` | Override Pi settings/models directory for model discovery. |
| `PI_CREW_ASYNC_EARLY_EXIT_GUARD=0` | Disable 3s background early-exit guard. |

## State transition summary

```text
queued/planning/running  ── completed
                         ├─ failed
                         ├─ blocked
                         └─ cancelled
```

Task states follow the same durable contract plus `skipped`. Terminal states are monotonic during parallel merge.

## Observability tips

- Use `/team-dashboard` for a UI overview.
- Use `team status runId=...` for canonical state and stale async detection.
- Read `background.log` for early import/spawn errors.
- Read `events.jsonl` for event chronology.
- Read `agents/{taskId}/status.json` for per-agent model/progress/tool status.
- Read `artifacts/{runId}/transcripts/{taskId}.jsonl` for raw child Pi transcript.
