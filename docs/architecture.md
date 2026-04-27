# pi-crew Architecture

Canonical architecture documentation currently lives at workspace level:

- `../docs/pi-crew-source-review-and-lessons.md`
- `../docs/pi-crew-architecture.md`
- `../docs/pi-crew-mvp-plan.md`

This project-local document exists so the package contains an obvious documentation entry point. Keep it in sync as implementation progresses.

## Current scaffold

Implemented now:

- Pi package manifest
- autonomous delegation policy injection so the agent can decide when to use the `team` tool
- dynamic autonomous resource guidance generated from discovered agents/teams/workflows
- `recommend` action for agent-side team/workflow routing, decomposition, and fanout hints before plan/run
- `autonomy` action and `/team-autonomy` command for toggling autonomous delegation and profiles
- centralized state contracts plus task-claim, worker-heartbeat, run-lock, progress-artifact, mailbox files, dashboard progress/action helpers, and safe API interop contracts for runtime hardening
- extension entrypoint
- main `team` tool
- slash commands: `/teams`, `/team-run`, `/team-status`, `/team-doctor`
- builtin agent/team/workflow markdown resources
- resource discovery for builtin/user/project paths
- TypeBox tool schema
- model fallback helper
- state type definitions
- atomic state writes
- JSONL event log
- artifact store with content hashes
- durable run manifests and task files
- workflow validation
- foreground workflow scheduler
- safe scaffold task execution
- optional real child Pi execution via `PI_TEAMS_EXECUTE_WORKERS=1`
- safety-first create/update/delete for agents, teams, and workflows
- backups for update/delete mutations
- dry-run support for management mutations
- detached async background runner
- opt-in git worktree task workspace creation
- worktree diff artifacts
- child prompt runtime for inherited project-context/skills stripping
- retryable model fallback attempts per worker task
- rich status output with recent artifacts and event tail
- recent run listing
- `/team-cleanup` worktree cleanup command
- improved `/team-run` parser for `--async`, `--worktree`, `--team=`, `--workflow=`, `--role=`, `--agent=`
- async completion polling notifications during Pi sessions
- active run summary on session start
- reference checks before deleting referenced agents/workflows
- optional reference updates when renaming agents/workflows
- expanded doctor checks for `pi`, `git`, writable state paths, and resource discovery
- durable run integration-style test coverage
- user config loader for async defaults, worker execution, notifier interval, and worktree cleanliness policy
- `pi-crew` install helper that creates default config
- worktree branch mismatch detection before reuse
- simple interactive `/team-manager` built with Pi UI dialogs
- dedicated `events` and `artifacts` actions plus slash commands
- persisted worktree metadata on task state/status
- mocked child Pi execution path for integration-style tests
- package polish: `.gitignore`, `tsconfig.json`, `npm run check`
- project-local `AGENTS.md` development rules
- run resume action/command that re-queues failed/cancelled/skipped/running tasks
- dedicated worktrees inspection action and `/team-worktrees`
- real temp-git worktree integration test
- async run metadata persisted in manifest/status
- stale async PID detection that marks active orphaned runs failed on status inspection
- child Pi JSON output parsing for final text, usage, and JSON event counts
- aggregate usage totals in status/summary
- summary artifact and `summary` action/`/team-summary` command
- custom overlay `/team-dashboard` run browser built with `ctx.ui.custom`
- dashboard details pane with status counts and selected run metadata
- prune action and `/team-prune` to remove old finished runs after confirmation
- export action and `/team-export` to write portable JSON/Markdown run bundles
- import action and `/team-import` to store exported bundles under local imports
- imports action and `/team-imports` to browse imported bundles
- help action and `/team-help` command
- validate action and `/team-validate` command for agents/teams/workflows
- doctor auto-runs resource validation and reports validation errors/warnings
- project init action and `/team-init` command for `.pi` directories, `.gitignore`, and optional builtin resource copying
- config action and `/team-config` command
- published `schema.json` for config validation
- publishing checklist docs
- `/team-cancel` command alias
- forget action and `/team-forget` to delete run state/artifacts after confirmation
- resource format documentation
- unit tests for async stale detection, autonomous config toggling, autonomous policy, autonomous recommendation/decomposition, config, project config merge, config action, dashboard rendering/navigation, discovery, doctor/model validation, events/artifacts/worktrees inspection, export/import run bundles and schema validation, help output, imported bundle listing, forget run cleanup, management, management reference checks, mocked child execution, child JSON output parsing and fixtures, model fallback, project init, prompt runtime, prune run cleanup, resource validation, resume/cancel, routing metadata, runtime hardening/progress/API interop, state contracts, state store, summary artifact/action, task claims, team run persistence, worker heartbeat, worktree mode, and workflow validation

Not implemented yet:

- richer multi-pane custom TUI manager
