# Live Mailbox Runtime Direction

`pi-crew` currently uses workflow child-process orchestration: a run materializes tasks, executes them through the scheduler, writes artifacts/events, and optionally launches child Pi workers.

A full live mailbox runtime is intentionally out of scope for the current stable surface. Current foundational mailbox files are intentionally simple and local:

```text
{stateRoot}/mailbox/inbox.jsonl
{stateRoot}/mailbox/outbox.jsonl
{stateRoot}/mailbox/delivery.json
{stateRoot}/mailbox/tasks/{taskId}/inbox.jsonl
{stateRoot}/mailbox/tasks/{taskId}/outbox.jsonl
```

They are exposed through safe API operations (`read-mailbox`, `send-message`, `ack-message`, `read-delivery`, `validate-mailbox`) but do not yet imply always-on long-lived workers. If a full runtime is added later, it should build on the foundations already present:

- `src/state/contracts.ts` for status/event contracts
- `src/state/task-claims.ts` for claim/lease safety
- `src/runtime/worker-heartbeat.ts` for liveness
- `src/state/locks.ts` for run-level mutation safety
- `action: "api"` for safe interop boundaries

## Proposed phases

1. **Read-only interop** — already started with `api` operations.
2. **Heartbeat writers** — allow workers to update heartbeat/progress safely.
3. **Claim-safe task lifecycle** — expose claim/release/transition operations with tokens.
4. **Mailbox** — add worker inbox/leader inbox files and delivery state.
5. **Live workers** — only after the above contracts are stable.

## Non-goals for now

- No always-on background worker pool.
- No automatic destructive cleanup of dirty worktrees.
- No recursive team spawning by workers.
- No mailbox mutation without locks and schema validation.
