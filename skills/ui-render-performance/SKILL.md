---
name: ui-render-performance
description: Non-blocking Pi TUI render workflow. Use when changing widgets, powerbar/statusbar segments, dashboard panes, overlays, snapshot caches, or live UI refresh behavior.
---

# ui-render-performance

Use this skill for Pi/pi-crew TUI work.

## Source patterns distilled

- Pi TUI is synchronous immediate-mode/string rendering: `source/pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Pi extension examples use event-driven state updates, not render-time loading.
- pi-crew UI: `src/extension/register.ts`, `src/ui/run-dashboard.ts`, `src/ui/run-snapshot-cache.ts`, `src/ui/crew-widget.ts`, `src/ui/powerbar-publisher.ts`, `src/ui/render-scheduler.ts`

## Rules

- Treat every `render(width)` and widget/powerbar update as a hot synchronous path.
- Render from in-memory snapshots only. Preload config, manifests, snapshots, agents, and mailbox counts asynchronously.
- Use `RenderScheduler.schedule()` to coalesce renders; avoid direct repeated rendering.
- Prefer `snapshotCache.get(runId)` in render paths. If a sync fallback is unavoidable, classify it as first-load/rare and document why.
- Keep dashboard panes pure: accept a snapshot/model and format strings; do not call `fs.readFileSync`, `fs.readdirSync`, `fs.statSync`, or network APIs from pane render methods.
- On session switch, cancel timers and ensure in-flight async preloads cannot update stale session UI.
- Watch TTL interactions: a preload interval shorter than cache TTL prevents render-time refresh gaps.

## Anti-patterns

- Do not call `loadConfig()`, `manifestCache.list()`, or `refreshIfStale()` repeatedly inside `renderTick()` unless backed by preloaded frame data.
- Do not do large JSON parsing or directory scans inside widget render/update functions.
- Do not show stale health warnings for completed/cancelled/failed runs.

## Verification

```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/run-snapshot-cache.test.ts test/unit/crew-widget.test.ts test/unit/powerbar-publisher.test.ts test/unit/run-dashboard.test.ts
npm test
```
