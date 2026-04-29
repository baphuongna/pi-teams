# Research: UI Optimization Plan

> Phase 7 plan derived from `parallel-research` run `team_20260429053958_6497405a`.
> Source artifacts:
> - `.crew/artifacts/team_20260429053958_6497405a/shared/research-summary.md`
> - `.crew/artifacts/team_20260429053958_6497405a/shared/04_synthesize.md`
> - `.crew/artifacts/team_20260429053958_6497405a/shared/01_discover.md`
> - `.crew/artifacts/team_20260429053958_6497405a/shared/02_explore-shard-1.md`
> - `.crew/artifacts/team_20260429053958_6497405a/shared/03_explore-shard-2.md`

## Overview

pi-crew already exposes the runtime data needed for a strong TUI: manifests, `tasks.json`, `agents.json`, per-agent `status.json`, `events.jsonl`, `output.log`, transcripts, and durable mailbox state. The gaps are in the UI layer:

1. Widget recreated on every timer tick (`crew-widget.ts:267-272`).
2. Live signatures miss `progress / toolUses / usage / recent output` so cached lines stay stale.
3. Multiple UI surfaces re-read the same files independently (no shared snapshot).
4. `/team-dashboard` is static — only reload via key `r`.
5. `transcript-viewer.ts` calls `readFileSync` inside `render()` on every paint.
6. Mailbox API/runtime exists but no first-class panel/badges.
7. Pi UI integration uses untyped private-like casts (`requestRender`, `setWorkingIndicator`).

The plan below sequences fixes for highest ROI and lowest risk first, lockdown the snapshot contract before refactoring surfaces, and defers anything depending on uncertain pi-mono compatibility.

## Implementation Status

> Track status here. Use `[x]` for done, `[ ]` for pending, `[-]` for won't-do/deferred.

- [x] Phase 0 — Pi UI compatibility shim
- [x] Phase 1.A — Persistent widget instance
- [x] Phase 1.B — `RunUiSnapshot` + `RunSnapshotCache`
- [x] Phase 1.C — Freshness signatures (progress / tool / usage / mtimes)
- [x] Phase 2 — Refactor widget / sidebar / dashboard / powerbar onto snapshot
- [x] Phase 3.A — `/team-dashboard` live component
- [x] Phase 3.B — Dashboard panes (agents, progress, mailbox, transcript)
- [x] Phase 4.A — Transcript viewer cache (mtime/size keyed)
- [x] Phase 4.B — Transcript bounded-tail mode
- [x] Phase 5.A — Adaptive/coalesced render scheduler
- [x] Phase 5.B — Powerbar fallback strategy + docs
- [x] Phase 5.C — Performance tests (large runs / large transcripts)

## Roadmap-Level Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Snapshot contract before refactor | Lock `RunUiSnapshot` interface in Phase 1.B before any consumer refactor | Avoid concurrent rename/conflict in widget/sidebar/dashboard |
| Persistent widget independent of snapshot | Phase 1.A done before 1.B | Quick win, doesn't block snapshot work, removes biggest CPU/flicker churn |
| Compatibility shim placed first (Phase 0) | Centralize `requestRender / setStatus / custom / setWidget` casts in `src/ui/pi-ui-compat.ts` | Every later phase consumes it; avoids re-casting in each module |
| Transcript fix split (4.A then 4.B) | Cache + invalidate first, tail-mode second | Cache by `mtime+size` is S effort and removes blocking `readFileSync` per-render; tail mode is M-L and can land later |
| Event-driven refresh deferred to Phase 5.A | Subscribe `crew.run.* / crew.subagent.* / crew.mailbox.*` only after snapshot is stable | Avoids listener leak risk during rapid refactor |
| RPC mode | Best-effort, not first-class | RPC drops function widgets; we emit string fallback via shim |
| Powerbar | Always-fallback to `setStatus`/widget; document event contract | No confirmed pi-mono consumer found in research |
| Memory safety | LRU cap 8 active + 16 recent runs in snapshot cache | Prevent leak when user browses many runs |

## Phase 0 — Pi UI Compatibility Shim

**Goal:** Eliminate ad-hoc `(ctx.ui as { requestRender?: ... })` casts; provide one typed entry-point per UI capability.

**Deliverables:**
- New file `src/ui/pi-ui-compat.ts` exporting:
  - `requestRender(ctx)` — feature-detected.
  - `setWorkingIndicator(ctx, opts?)` — feature-detected, no-op fallback.
  - `setExtensionWidget(ctx, key, factory, options)` — wraps `setWidget`, accepts `{ persist?: boolean }` flag.
  - `showCustom(ctx, ...)` — wraps `ctx.ui.custom` with overlay options.
  - `setStatusFallback(ctx, key, lines, segment?)` — used when powerbar consumer is absent.
- Replace existing inline casts in `crew-widget.ts`, `register.ts`, `live-run-sidebar.ts`, `powerbar-publisher.ts`.

**Files affected:**
- `src/ui/pi-ui-compat.ts` (new)
- `src/ui/crew-widget.ts`
- `src/ui/live-run-sidebar.ts`
- `src/ui/powerbar-publisher.ts`
- `src/extension/register.ts`

**Tests:**
- Unit test asserting fallback when host lacks `requestRender` / `setWorkingIndicator`.
- Snapshot of cast removal via grep test (no `as { requestRender` left in `src/`).

**Effort:** S (0.5–1 day) · **Risk:** Low

## Phase 1.A — Persistent Widget Instance

**Goal:** Stop calling `setWidget` every timer tick; only call when placement/visibility/key changes.

**Approach:**
- Extend `CrewWidgetState` with `lastPlacement: string`, `lastVisibility: "hidden" | "visible"`, `lastKey: string`.
- `updateCrewWidget` decides: if state matches and component instance exists → only invalidate via shim's `requestRender()`; do NOT call `setWidget`.
- Component reads `runs` lazily inside `render(width)` using existing `activeWidgetRuns` (later replaced by snapshot in Phase 2).

**Files affected:**
- `src/ui/crew-widget.ts`
- `src/extension/register.ts` (timer interval handler)

**Tests (unit):**
- `updateCrewWidget` called N times with unchanged placement → `setWidget` invoked exactly once (count via mock).
- Switching placement triggers exactly 1 additional `setWidget`.
- Hide/clear path still calls `setWidget(WIDGET_KEY, undefined, ...)`.

**Effort:** S–M (1 day) · **Risk:** Low

## Phase 1.B — `RunUiSnapshot` + `RunSnapshotCache`

**Status:** Done in Wave 2 via `src/ui/snapshot-types.ts` and `src/ui/run-snapshot-cache.ts`.

**Goal:** Single read pass per run; share results across widget/sidebar/dashboard/powerbar.

**Locked interface (do not change without bumping plan):**

```ts
export interface RunUiProgress {
    total: number;
    completed: number;
    running: number;
    failed: number;
    queued: number;
}

export interface RunUiUsage {
    tokensIn: number;
    tokensOut: number;
    toolUses: number;
}

export interface RunUiMailbox {
    inboxUnread: number;
    outboxPending: number;
    needsAttention: number;
}

export interface RunUiSnapshot {
    runId: string;
    cwd: string;
    fetchedAt: number;
    signature: string;        // stable hash; differs only when content changed
    manifest: TeamRunManifest;
    tasks: TeamTaskState[];
    agents: CrewAgentRecord[];
    progress: RunUiProgress;
    usage: RunUiUsage;
    mailbox: RunUiMailbox;
    recentEvents: TeamEvent[];     // last N (config N=20)
    recentOutputLines: string[];   // last N lines, capped at MAX_TAIL_BYTES
}

export interface RunSnapshotCache {
    get(runId: string): RunUiSnapshot | undefined;
    refresh(runId: string): RunUiSnapshot;            // forces re-read
    refreshIfStale(runId: string): RunUiSnapshot;     // re-read only if mtime/size changed or TTL exceeded
    invalidate(runId?: string): void;                 // invalidate one or all
    snapshotsByKey(): Map<string, RunUiSnapshot>;     // for dashboard list rendering
}
```

**Cache rules:**
- Key by `runId`.
- Stored entry includes `tasksMtime`, `tasksSize`, `agentsMtime`, `agentsSize`, `manifestMtime`, `mailboxMtime`, `outputMtime`.
- TTL = 250ms (matches existing `crew-agent-records` reader cache).
- LRU: max 8 active + 16 recent entries; evict on insert beyond limit.
- All `JSON.parse` wrapped in `try/catch`; on parse fail return previous valid entry (never crash render).

**Files affected:**
- `src/ui/run-snapshot.ts` (new)
- `src/ui/run-snapshot-cache.ts` (new)
- `src/ui/snapshot-types.ts` (new — exported types)

**Tests (unit):**
- `refreshIfStale` returns same entry when mtimes unchanged.
- File rewrite changes `signature`.
- Parse error returns last valid snapshot, no throw.
- LRU eviction at boundary.

**Effort:** M–L (2–3 days) · **Risk:** Medium

## Phase 1.C — Freshness Signatures

**Goal:** Make widget/sidebar invalidate when progress/tool/tokens/output change, not just status.

**Changes:**
- `CrewWidgetComponent.buildSignature` includes per-agent `progress.completed`, `progress.total`, `currentTool`, `usage.tokensOut`, `lastOutputMtime`.
- `LiveRunSidebar.buildSignature` similarly includes progress/tool/usage; add `mailbox.inboxUnread`.
- Signatures derived from `RunUiSnapshot.signature` once Phase 1.B is in.

**Files affected:**
- `src/ui/crew-widget.ts`
- `src/ui/live-run-sidebar.ts`

**Tests (unit):**
- Two snapshots with same status but different progress → different signatures.
- Mock progress event → render output line count/contents change.

**Effort:** S (0.5 day) · **Risk:** Low

## Phase 2 — Refactor Surfaces onto Snapshot

**Status:** Done in Wave 2 for widget/sidebar/dashboard/powerbar, with fallback direct reads preserved when no cache is supplied.

**Goal:** Replace independent FS reads in widget / sidebar / dashboard / powerbar with `RunSnapshotCache`.

**Deliverables:**
- `crew-widget.ts` reads via `cache.refreshIfStale(runId)`.
- `live-run-sidebar.ts` same.
- `run-dashboard.ts` calls `cache.snapshotsByKey()` once per render.
- `powerbar-publisher.ts` derives segment text from snapshot.
- Remove direct `agentsFor`/`readTasks`/`readManifest` reads from UI modules.

**Files affected:**
- `src/ui/crew-widget.ts`
- `src/ui/live-run-sidebar.ts`
- `src/ui/run-dashboard.ts`
- `src/ui/powerbar-publisher.ts`

**Tests (unit):**
- One render of all four surfaces with N=10 runs triggers ≤ N cache reads (use spy).
- Snapshot reuse across surfaces in same tick (counter assert).

**Effort:** M (2 days) · **Risk:** Medium

## Phase 3.A — Live `/team-dashboard`

**Goal:** Dashboard auto-refreshes while open, preserves selection, separates active vs recent runs.

**Changes:**
- Convert `RunDashboard` from one-shot render to TUI overlay component owning its own timer (250–1000ms adaptive).
- Internal state: `selectedRunId`, `activeTab`, `cachedSnapshots` (via `RunSnapshotCache`).
- Hotkey `r` no longer needed but kept as manual force-refresh.

**Files affected:**
- `src/ui/run-dashboard.ts`
- `src/extension/registration/commands.ts` (dashboard handler now overlay-based)

**Tests (unit + integration):**
- Component receives mocked snapshot updates → re-renders without losing `selectedRunId`.
- Active runs list updates when manifest status flips.

**Effort:** M (2 days) · **Risk:** Medium

## Phase 3.B — Dashboard Panes (agents · progress · mailbox · transcript)

**Goal:** First-class panel/tabs surfacing data already in snapshot.

**Tabs:**
1. **Agents** — table (agent · status · current tool · tokens · last activity).
2. **Progress / Events** — last N events with role badge and timestamps.
3. **Mailbox** — inbox unread, outbox pending, needs-attention; row actions: nudge/ack via existing `team-tool/api.ts` (`send-message`, `ack-message`).
4. **Transcript / Output** — opens existing `DurableTranscriptViewer` (post Phase 4.A).

**Files affected:**
- `src/ui/run-dashboard.ts`
- `src/ui/dashboard-panes/` (new directory: agents-pane, progress-pane, mailbox-pane, transcript-pane)
- `src/extension/team-tool/api.ts` (no API change; UI calls existing `read-mailbox`, `send-message`, `ack-message`)

**Tests (unit):**
- Mailbox pane shows badge counts from snapshot.
- Pane switching preserves selection within pane.
- Action `ack` triggers API call once and refreshes snapshot.

**Effort:** M–L (3 days) · **Risk:** Medium

## Phase 4.A — Transcript Viewer Cache

**Goal:** Stop blocking `readFileSync` inside `render()`; eliminate full-parse per paint.

**Changes:**
- New `TranscriptCacheEntry { path, mtime, size, lines, parsedAt }` keyed by `(runId, taskId)`.
- `readRunTranscript` consults cache; only re-reads if `mtime` or `size` changed.
- `DurableTranscriptViewer.render` reads `cache.lines`, never the disk directly.
- TTL 500ms safety net.

**Files affected:**
- `src/ui/transcript-viewer.ts`
- `src/ui/transcript-cache.ts` (new)

**Tests (unit):**
- Two consecutive renders with unchanged file → 1 disk read.
- File grow → new cached lines, signature changes.
- Parse failure preserves last good cache.

**Effort:** S (0.5 day) · **Risk:** Low

## Phase 4.B — Bounded-Tail Mode

**Goal:** Default to last N bytes/events to keep latency bounded for large transcripts.

**Approach:**
- Default `maxTailBytes = 256 KB`.
- Tail strategy: `fs.statSync` → `fs.openSync` → read last N bytes → discard partial first line if file exceeds N.
- Add hotkey `f` to "load full transcript on demand"; show byte counter.
- Auto-scroll toggle (`a`) preserved.

**Files affected:**
- `src/ui/transcript-viewer.ts`
- `src/ui/transcript-cache.ts` (extend)

**Config:**
- `config.ui.transcriptTailBytes` (optional, default 262144).

**Tests (unit):**
- 1MB file → only ~256KB worth of lines parsed.
- Force-full mode loads everything.
- Tail re-aligns when first newline straddles boundary.

**Effort:** M (2 days) · **Risk:** Medium

## Phase 5.A — Adaptive Render Scheduler

**Goal:** Replace fixed 1000ms timers with event-driven refresh + low-frequency fallback.

**Approach:**
- Single `RenderScheduler` listening on `pi.events` for `crew.run.*`, `crew.subagent.*`, `crew.mailbox.*`.
- On event → invalidate snapshot + `requestRender` (debounced 50–100ms via animation-frame analog).
- Fallback timer 750ms (reduced from 1000ms) only triggers if no event in window.
- All listeners disposed on extension unload + run completion.

**Files affected:**
- `src/ui/render-scheduler.ts` (new)
- `src/extension/register.ts` (replace `setInterval` block)

**Tests (unit):**
- Event burst coalesces to single `requestRender` within debounce window.
- Listeners removed after `dispose()` (counter on event emitter).
- Fallback timer fires only when no events in interval.

**Effort:** M (1.5 days) · **Risk:** Low–Medium

## Phase 5.B — Powerbar Fallback Strategy

**Goal:** Don't depend on an external `powerbar:*` consumer.

**Changes:**
- Detect listener via `pi.events.listenerCount?.("powerbar:register-segment")`.
- If 0 listeners: emit AND mirror to `ctx.ui.setStatus("pi-crew", text)`.
- Document event contract in `docs/architecture.md`.

**Files affected:**
- `src/ui/powerbar-publisher.ts`
- `docs/architecture.md`

**Tests (unit):**
- No consumer → `setStatus` called.
- Consumer registered → only event emitted, no `setStatus`.

**Effort:** S–M (0.5–1 day) · **Risk:** Medium (depends on listener-count API availability)

## Phase 5.C — Performance Tests

**Goal:** Catch regressions on large runs / transcripts.

**Suite:**
- 50 simulated runs, 200 events each → render dashboard, assert ≤ 50 disk reads / render cycle.
- 5MB transcript → tail mode reads ≤ 1MB, full mode allowed.
- 100 widget update calls without state change → ≤ 1 `setWidget` invocation.

**Files affected:**
- `test/integration/ui-performance.test.ts` (new)

**Effort:** M (1.5 days) · **Risk:** Low

## Implementation Order

> Recommended: do quick wins (Phase 0, 1.A, 1.C, 4.A) in parallel as 4 small PRs before starting Phase 1.B (snapshot foundation).

```
Wave 1 (parallel, all S effort):
  [x] Phase 0  — Pi UI compat shim
  [x] Phase 1.A — Persistent widget
  [x] Phase 1.C — Freshness signatures (use ad-hoc fields until snapshot lands)
  [x] Phase 4.A — Transcript cache

Wave 2 (sequential):
  [x] Phase 1.B — RunUiSnapshot foundation
  [x] Phase 2   — Refactor surfaces onto snapshot
  [x] Phase 5.A — Adaptive render scheduler

Wave 3 (parallel after Wave 2):
  [x] Phase 3.A — Live dashboard
  [x] Phase 3.B — Dashboard panes
  [x] Phase 4.B — Transcript tail mode

Wave 4 (cleanup):
  [x] Phase 5.B — Powerbar fallback
  [x] Phase 5.C — Perf tests
```

## Files Affected (grouped)

**New files:**
- `src/ui/pi-ui-compat.ts`
- `src/ui/run-snapshot.ts`
- `src/ui/run-snapshot-cache.ts`
- `src/ui/snapshot-types.ts`
- `src/ui/transcript-cache.ts`
- `src/ui/render-scheduler.ts`
- `src/ui/dashboard-panes/agents-pane.ts`
- `src/ui/dashboard-panes/progress-pane.ts`
- `src/ui/dashboard-panes/mailbox-pane.ts`
- `src/ui/dashboard-panes/transcript-pane.ts`
- `test/integration/ui-performance.test.ts`

**Modified files:**
- `src/ui/crew-widget.ts`
- `src/ui/live-run-sidebar.ts`
- `src/ui/run-dashboard.ts`
- `src/ui/powerbar-publisher.ts`
- `src/ui/transcript-viewer.ts`
- `src/extension/register.ts`
- `src/extension/registration/commands.ts`
- `docs/architecture.md`

**Read-only references:**
- `src/runtime/crew-agent-records.ts`
- `src/state/mailbox.ts`
- `src/extension/team-tool/api.ts`

## Risk Assessment

| Risk | Phase | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Snapshot cache memory leak with many runs | 1.B | Medium | High | LRU cap (8 active + 16 recent), eviction unit test |
| Race between `agents.json` rewrite and UI read | 1.B | Medium | Medium | `try/catch JSON.parse` + return last valid snapshot |
| Listener leak from event-driven refresh | 5.A | Medium | Medium | Centralize in `RenderScheduler.dispose()`, integration test counts listeners post-shutdown |
| Persistent widget breaks on placement change edge cases | 1.A | Low | Medium | Diff against `lastPlacement/lastKey/lastVisibility` triple |
| Transcript tail-mode misaligns at chunk boundary | 4.B | Medium | Low | Discard partial-first-line; unit test with files at `n*chunkSize ± 1` |
| Pi RPC mode silently drops widgets | 0/2 | High | Low | Shim falls back to `setStatus` string lines |
| Powerbar consumer never appears | 5.B | High | Low | Always emit + always set status fallback |
| `requestRender` removed in future pi-mono | 0 | Low | Medium | Compat shim already feature-detects |
| Snapshot signature collision (different state, same hash) | 1.B | Low | Medium | Include mtimes + sizes + counts in hash input |
| Test suite runtime grows from perf tests | 5.C | Medium | Low | Run perf separately via dedicated script when needed |
| Concurrent refactor of widget/sidebar/dashboard while contract evolves | 1.B → 2 | Medium | High | Lock interface in 1.B PR before opening Phase 2 PR |
| Mailbox pane spams renders on incoming messages | 3.B / 5.A | Medium | Low | Debounce via `RenderScheduler`, batch mailbox events |

## Testing Strategy

**Unit (Wave 1):**
- Compat shim feature-detect fallback (Phase 0).
- `setWidget` called once per state change (Phase 1.A).
- Signature includes progress/tool/usage diff (Phase 1.C).
- Transcript cache reuses entry when mtime unchanged (Phase 4.A).

**Unit (Wave 2):**
- Snapshot cache: TTL, LRU, parse-error fallback, signature stability.
- Surface refactor: 4 surfaces share ≤ 1 read per run per tick.
- Scheduler: event coalesce, dispose, fallback timer.

**Unit (Wave 3):**
- Dashboard live refresh preserves selection.
- Pane switching state, mailbox badge counts, ack action.
- Tail-mode boundary alignment, force-full toggle.

**Integration:**
- 50-run dashboard render ≤ 50 disk reads (Phase 5.C).
- 5MB transcript tail ≤ 1MB read.
- Long-lived run (10 min simulated) without listener growth.

**Manual smoke:**
- Open `/team-dashboard`, switch panes, send mailbox message, ack from UI.
- Resize terminal, switch placement above/below editor.
- Reload extension; ensure all timers/listeners cleared.

**Regression baseline:**
- Existing 286 unit + 26 integration tests must remain green at every wave.
- Run `npm run typecheck && npm run test:unit && npm run test:integration` before each PR merge.

## Open Questions

1. **Powerbar consumer status** — is any pi-mono extension/host expected to consume `powerbar:*` events? (Decides Phase 5.B aggressiveness; default plan: always-fallback.)
2. **Target scale** — how many concurrent runs / what max transcript size should we optimize for? Plan assumes 8 active runs and 256KB tail by default.
3. **RPC mode priority** — must function widgets work in RPC, or is graceful string fallback acceptable? Plan assumes best-effort string fallback.
4. **Phase 1.B contract freeze** — once the interface ships, downstream phases depend on it. Should we publish it as `RunUiSnapshotV1` and treat changes as breaking?

## Effort Summary

| Wave | Phases | Effort | Dependency |
|---|---|---|---|
| 1 (parallel) | 0, 1.A, 1.C, 4.A | ~2.5 days total | None |
| 2 (sequential) | 1.B → 2 → 5.A | ~5.5 days | Wave 1 done |
| 3 (parallel) | 3.A, 3.B, 4.B | ~7 days | Wave 2 done |
| 4 (parallel) | 5.B, 5.C | ~3 days | Wave 3 done |
| **Total** | 12 phases | **~18 dev-days** | — |

> Quick-win path (Wave 1 only) delivers ~70% of perceived UI improvement (no flicker, fresh signatures, no transcript blocking) at <15% of total effort.
