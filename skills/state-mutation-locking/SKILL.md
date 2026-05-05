---
name: state-mutation-locking
description: Durable state mutation and locking workflow. Use when changing manifests, tasks, mailbox, claims, events, stale reconciliation, recovery, cancel/respond/resume, or retry logic.
---

# state-mutation-locking

Use this skill before modifying pi-crew run state.

## Source patterns distilled

- `src/state/locks.ts` — run-level sync/async locks
- `src/state/state-store.ts` — manifest/tasks persistence
- `src/state/contracts.ts` — allowed status transitions
- `src/state/mailbox.ts`, `src/state/task-claims.ts`, `src/state/atomic-write.ts`
- `src/runtime/crash-recovery.ts`, `src/runtime/stale-reconciler.ts`, `src/runtime/team-runner.ts`

## Rules

- Mutations to a run's `manifest.json`, `tasks.json`, mailbox delivery state, claims, or recovery status must be protected by a run lock when concurrent actions are possible.
- Re-read manifest/tasks inside the lock before making a decision; pre-lock reads are only for locating the run.
- Persist with atomic write helpers (`atomicWriteJson`, async variants, or state-store helpers). Do not partially write JSON files.
- Respect status contracts. Do not transition terminal tasks/runs unless the action explicitly supports force semantics.
- Separate analysis from persistence: pure reconcilers should return intended repaired state; locked callers should persist it.
- In retry/resume paths, reload fresh task status immediately before execution and skip if the task is no longer retryable/runnable.
- Include event-log entries for externally visible state changes.

## Anti-patterns

- Reading state, waiting/doing async work, then writing the old copy.
- Updating `tasks.json` from a reconciler or watcher without a lock.
- Cancelling/responding to runs owned by another session.
- Using `fs.writeFileSync` for JSON state outside atomic helpers.

## Verification

```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/cancel-ownership.test.ts test/unit/respond-tool.test.ts test/unit/stale-reconciler.test.ts test/unit/api-claim.test.ts
npm test
```
