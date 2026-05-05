---
name: mailbox-interactive
description: Interactive waiting-task and mailbox workflow. Use when implementing or operating respond/nudge/ack/replay/supervisor-contact behavior.
---

# mailbox-interactive

Use this skill for live coordination between leader and workers.

## Source patterns distilled

- pi-subagents intercom/contact supervisor: blocking decisions vs non-blocking progress updates
- pi-crew mailbox: `src/state/mailbox.ts`, `src/extension/team-tool/respond.ts`, `src/extension/team-tool/api.ts`, `src/ui/overlays/mailbox-detail-overlay.ts`, `src/ui/run-action-dispatcher.ts`
- Waiting state: `src/state/contracts.ts`, `src/runtime/supervisor-contact.ts`, `src/ui/status-colors.ts`

## Rules

- Use `waiting` when a task needs leader input and can safely pause.
- `respond` should write an inbox mailbox message and transition target waiting tasks back to `running`.
- Mutating mailbox actions must use run locks and re-read state inside the lock.
- Respect run ownership: foreign sessions cannot respond/resume owned waiting tasks.
- Mailbox reads should be contained under run state and tolerate missing/empty JSONL files.
- Acknowledge/read actions are UI/operator state; preserve message history rather than deleting records.
- Supervisor contact parsed from child stdout should be recorded as events and surfaced in UI without blocking render paths.

## Anti-patterns

- Resuming non-waiting tasks via `respond`.
- Injecting mailbox messages into a foreign owned run.
- Treating every progress update as a blocking supervisor decision.
- Reading large mailbox files synchronously in hot render paths.

## Verification

```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/respond-tool.test.ts test/unit/mailbox-detail-overlay.test.ts test/unit/mailbox-compose-overlay.test.ts test/unit/supervisor-contact.test.ts
npm test
```
