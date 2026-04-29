# Research: `source/pi-crew` as New Reference Source

Date: 2026-04-29
Reference source: `D:/my/my_project/source/pi-crew` (`@melihmucuk/pi-crew@1.0.14`, commit `c0631a3`)
Current target: `D:/my/my_project/pi-crew` (`pi-crew@0.1.34`)
Research run: `team_20260429091311_8047706b`

> Note: the parallel research run produced useful artifacts, but child workers were marked failed because they did not exit within 5s after their final assistant message. The source audit content was still captured in result/shared artifacts.

## Executive Summary

`source/pi-crew` is a compact, in-process subagent orchestration extension. It is not a team/workflow engine; instead, it focuses on fast non-blocking subagent sessions, owner-routed steering-message delivery, interactive subagents, and context-overflow recovery. It is valuable as a reference for **session-native subagent runtime**, **delivery semantics**, and **minimal interactive worker UX**.

Current `pi-crew` is more powerful and durable: child Pi workers, teams/workflows, task graph scheduling, worktrees, mailbox, event logs, dashboard, notifications, and recovery state. The best path is not replacement; it is selective porting of patterns into `pi-crew`'s existing `live-session-runtime` / `SubagentManager` as an optional session-native lane.

## Source File Map

| Area | Reference files |
|---|---|
| Extension entry/session hooks | `source/pi-crew/extension/index.ts` |
| Runtime singleton | `source/pi-crew/extension/runtime/crew-runtime.ts` |
| Delivery routing | `source/pi-crew/extension/runtime/delivery-coordinator.ts` |
| State model/registry | `source/pi-crew/extension/runtime/subagent-state.ts`, `source/pi-crew/extension/runtime/subagent-registry.ts` |
| Overflow recovery | `source/pi-crew/extension/runtime/overflow-recovery.ts` |
| Session bootstrap | `source/pi-crew/extension/bootstrap-session.ts` |
| Agent discovery | `source/pi-crew/extension/agent-discovery.ts` |
| Tool registration | `source/pi-crew/extension/integration/register-tools.ts`, `source/pi-crew/extension/integration/tools/*.ts` |
| Message renderers | `source/pi-crew/extension/integration/register-renderers.ts` |
| Message formatting | `source/pi-crew/extension/subagent-messages.ts` |
| Status widget | `source/pi-crew/extension/status-widget.ts` |
| Architecture doc | `source/pi-crew/docs/architecture.md` |

## Architecture Observations

### Reference `source/pi-crew`

- Process-level singleton `CrewRuntime` survives Pi runtime/session replacement and rebinds on `session_start`.
- Subagents are in-process SDK `AgentSession`s created with `createAgentSession()`.
- Parent/child linkage uses `SessionManager.newSession({ parentSession })`.
- Subagent resource loading filters out the pi-crew extension through `extensionsOverride` to prevent recursive `crew_spawn` loops.
- Results are delivered through Pi-native `sendMessage()` with explicit idle/streaming semantics.
- Interactive subagents are first-class: `interactive: true` workers enter `waiting`; parent continues with `crew_respond`; cleanup is explicit with `crew_done`.
- Overflow recovery tracks `agent_end`, `compaction_start/end`, and `auto_retry_start/end` events around `session.prompt()`.
- State is in-memory only; subagent session files remain for post-hoc `/resume` inspection.

### Current `pi-crew`

- Primary runtime is child Pi process execution with durable `.crew/state` manifests and artifacts.
- It has workflow/team abstractions, task graphs, worktree support, event log, mailbox, dashboard panes, render scheduler, notifications, and diagnostic exports.
- It already has `live-session-runtime.ts`, but the current product surface centers on durable child-process workers rather than interactive in-process subagents.

## Extension API Patterns Worth Reusing

| Pattern | Reference source | Why it matters for current `pi-crew` |
|---|---|---|
| Owner-routed delivery by `sessionManager.getSessionId()` | `delivery-coordinator.ts` | Avoids sending async worker results to the wrong active session after `/resume`, `/new`, `/fork`, or multi-session use. |
| Idle vs streaming delivery split | `subagent-messages.ts`, `delivery-coordinator.ts` | Prevents messages from getting stuck: idle sessions need `triggerTurn`; streaming sessions need `deliverAs: "steer"`. |
| Deferred pending flush via `setTimeout(0)` | `delivery-coordinator.ts` | Avoids lost JSONL/custom-message persistence during resume before listeners reconnect. |
| `extensionsOverride` filter | `bootstrap-session.ts` | Required for any in-process worker lane to prevent recursive subagent spawning. |
| Fire-and-forget interactive response | `crew-respond.ts`, `crew-runtime.ts` | Lets parent stay responsive while an interactive worker continues in background. |
| No duplicate done message | `crew-done.ts` | Avoids repeating the last subagent response during cleanup. |
| Source-specific abort reasons | `crew-abort.ts`, `index.ts` shutdown handlers | Better diagnostics than generic "aborted by user". |
| Emergency unrestricted abort command | `register-command.ts` | Useful escape hatch distinct from owner-scoped tool actions. |
| Overflow tracker around SDK prompt | `overflow-recovery.ts` | Better UX for context overflow/compaction/retry in session-native workers. |

## Key Differences / Non-Goals

| Dimension | Reference `source/pi-crew` | Current `pi-crew` |
|---|---|---|
| Runtime | In-process `AgentSession` | Child Pi processes + durable orchestration |
| State | In-memory map | Durable manifests/event logs/artifacts |
| Scope | Flat subagent spawn/respond/done | Teams, workflows, task graph, worktrees |
| Result UX | Pi steering/custom messages | Tool results, mailbox, dashboard, async status |
| Interactive workers | Native | Not yet first-class |
| Worktree isolation | None | First-class |
| Replay/restart | Limited | Strong durable recovery |

Do **not** replace the current runtime wholesale. Reference `source/pi-crew` lacks durable state, worktrees, workflow scheduling, artifact indexing, and the Phase 8 operator experience. Its best value is a narrower session-native execution lane and delivery correctness patterns.

## Recommendations

### P0 — Adopt Delivery Semantics for Async/Live Results

Implement or adapt a small owner-routed delivery coordinator in current `pi-crew`:

- Key by owner `sessionId`, not session file.
- Queue pending messages when owner inactive.
- On `session_start`, flush pending messages on next macrotask.
- Use idle/streaming split:
  - idle: `sendMessage(payload, { triggerTurn: true })`
  - streaming: `sendMessage(payload, { deliverAs: "steer", triggerTurn: true })`
- Keep current mailbox/event-log as durable source of truth; use delivery coordinator only for live UX.

Likely target files:

- `pi-crew/src/extension/register.ts`
- `pi-crew/src/runtime/subagent-manager.ts`
- `pi-crew/src/runtime/live-session-runtime.ts`
- `pi-crew/src/extension/notification-router.ts`

### P1 — Add Optional Session-Native Subagent Lane

Build an opt-in lane on top of existing `live-session-runtime.ts` rather than changing the default child-process runtime:

- `runtime.mode = "child-process" | "live-session" | "auto"` already exists conceptually; tighten semantics.
- Use `SessionManager.newSession({ parentSession })` and `createAgentSession()` for in-process workers.
- Filter `pi-crew` out of subagent resource loader extensions.
- Persist minimal metadata to existing `.crew/state` so dashboards/recovery still work.

This can reduce process startup overhead and blank console issues, while preserving child-process isolation as the safe default.

### P1 — Introduce Interactive Worker Semantics

Add first-class interactive subagents without disrupting teams:

- New status: `waiting` for interactive background workers.
- `crew_agent_respond` / `crew_agent_done` or extend existing `crew_agent_steer` semantics.
- Fire-and-forget response: parent tool returns immediately; worker response arrives as mailbox/steering message.
- `done` performs cleanup only; no duplicate response.

Likely target files:

- `pi-crew/src/runtime/crew-agent-records.ts`
- `pi-crew/src/runtime/subagent-manager.ts`
- `pi-crew/src/extension/registration/subagent-tools.ts`
- `pi-crew/src/state/mailbox.ts`
- `pi-crew/src/ui/dashboard-panes/agents-pane.ts`

### P2 — Port Overflow Recovery Tracker for Live Sessions

For session-native workers, wrap `AgentSession.prompt()` with an event tracker similar to `source/pi-crew/extension/runtime/overflow-recovery.ts`:

- Track `compaction_start/end` and `auto_retry_start/end`.
- Report recovered context overflow separately from hard failure.
- Emit durable event-log records and dashboard health hints.

This should not apply to child Pi workers directly; they already have process/transcript supervision.

### P2 — Improve Abort Reason Taxonomy

Adopt explicit abort source reasons across all worker paths:

- tool-triggered abort
- command-triggered emergency abort
- session quit cleanup
- session replacement detach/deactivate
- watchdog timeout
- stale heartbeat kill

This improves diagnostics, notification routing, and Phase 9 reliability work.

## Risks

- In-process sessions reduce OS/process isolation; failures or leaks may affect the parent Pi process.
- `extensionsOverride` is mandatory; missing it risks recursive subagent spawning.
- Pi SDK internals may shift; keep this lane optional and covered by integration tests.
- Delivery semantics must not bypass durable mailbox/event log; live messages are convenience, not source of truth.
- Interactive workers can linger in memory; require TTL/status visibility and explicit cleanup.

## Suggested Follow-Up Plan

1. Write a focused design doc: `docs/research-session-native-runtime-plan.md`.
2. Spike delivery coordinator only; no runtime swap.
3. Add tests for idle/streaming/inactive owner delivery behavior.
4. Add optional `live-session` worker lane behind config.
5. Add interactive worker status/actions after live delivery is stable.

## Research Artifacts

- `D:/my/my_project/.crew/artifacts/team_20260429091311_8047706b/results/01_discover.txt`
- `D:/my/my_project/.crew/artifacts/team_20260429091311_8047706b/results/02_explore-shard-1.txt`
- `D:/my/my_project/.crew/artifacts/team_20260429091311_8047706b/results/03_explore-shard-2.txt`
- `D:/my/my_project/.crew/artifacts/team_20260429091311_8047706b/results/04_explore-shard-3.txt`
- `D:/my/my_project/.crew/artifacts/team_20260429091311_8047706b/batches/01_discover+02_explore-shard-1+03_explore-shard-2+04_explore-shard-3.md`
