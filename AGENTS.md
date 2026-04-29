# pi-crew Development Notes

This package is a Pi extension for team orchestration.

## Rules

- Keep `index.ts` minimal; register functionality from `src/extension/register.ts`.
- Prefer small modules over large orchestrator files.
- Do not copy source from SUL-licensed projects. `oh-my-openagent` is concept-only inspiration.
- MIT sources such as `pi-subagents` and `oh-my-claudecode` may be adapted with attribution in `NOTICE.md`.
- Avoid `any`; use `unknown` plus validation for tool/config inputs.
- Avoid dynamic inline imports.
- Do not hardcode global keybindings without user configurability.
- Default execution uses child Pi workers. Keep it safe through runtime limits, depth guards, and explicit disable controls (`executeWorkers=false`, `runtime.mode=scaffold`, `PI_CREW_EXECUTE_WORKERS=0`, or `PI_TEAMS_EXECUTE_WORKERS=0`).
- Worktree cleanup must preserve dirty worktrees unless `force` is explicitly set.
- Management deletes must require `confirm: true`; referenced resources should be blocked unless `force: true`.
- After code changes, run `npm test` from `pi-crew/` unless explicitly told not to.

## Important commands

```bash
npm test
```

## Important paths

- `src/extension/team-tool.ts` — main tool actions
- `src/runtime/team-runner.ts` — workflow scheduler
- `src/runtime/task-runner.ts` — task execution and artifacts
- `src/state/` — durable state/event/artifact store
- `src/worktree/` — worktree creation and cleanup
- `agents/`, `teams/`, `workflows/` — builtin resources
