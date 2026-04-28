# Phase 5 Refactor Plan — Footer/Selectlist/Hot-reload từ pi-mono coding-agent

> Xuất xứ: re-read `source/pi-mono/packages/coding-agent/src/modes/interactive/components/{footer,bordered-loader,dynamic-border,visual-truncate,diff,countdown-timer,extension-selector,theme-selector,custom-message,tool-execution,bash-execution}.ts` + `theme/theme.ts` (28/04/2026).
> Mục tiêu: vá lỗi subtle còn lại từ Phase 4, hot-reload theme, port footer/select-list pattern, chuẩn hóa border + tool state styling.
> Phase 4 đã hoàn tất, baseline: tsc 0 errors, 222 unit + 21 integration pass, commit `44fdd02`.

## Quy ước chung
- Không phá vỡ public API (slash commands, tool actions, config schema). Mọi thay đổi nội bộ.
- Sau mỗi task: `npx tsc --noEmit` + `npm run test:unit` (+ `test:integration` nếu liên quan render/runtime).
- Không thêm dependency runtime mới. Tất cả implement self-contained hoặc qua peer dep `@mariozechner/pi-tui` đã có.
- Mỗi task = 1 commit độc lập có thể revert. Đặt tên test bám sát hành vi.
- Ưu tiên backward compatibility: default behavior không đổi, opt-in qua config khi có hành vi mới.

## Trạng thái cập nhật
- [x] Task #50 — Fix `truncateToVisualLines` slice-after-merge bug
- [x] Task #51 — Memoize `visibleWidth` LRU cache
- [x] Task #52 — Theme hot-reload subscription
- [x] Task #53 — Theme adapter `inverse` ANSI fallback
- [x] Task #54 — `CrewFooter` component port
- [x] Task #55 — `CrewSelectList` adapter
- [x] Task #56 — `DynamicCrewBorder` reusable + CountdownTimer 1s tick
- [x] Task #57 — Tool state styling cho transcript-viewer
---

## Tier 1 — Bug fixes & correctness (low risk, immediate value)

Mục tiêu: 2 task, vá bug từ Phase 4 + tăng hiệu năng nhỏ. Ước tính: 0.5 ngày.

### Task #50 — Fix `truncateToVisualLines` slice-after-merge bug
**Source**: `pi-mono/coding-agent/components/visual-truncate.ts`
**Đích**: `pi-crew/src/utils/visual.ts`

**Lý do**: Phase 4 #47 implement `truncateToVisualLines` với logic:
```ts
const visualLines = text.split("\n").flatMap((line) =>
  wrapHard(pad(line, ...).trimEnd(), effectiveWidth).slice(0, Math.max(1, maxVisualLines))
);
```
Bug: `slice(0, maxVisualLines)` áp dụng **per source line** thay vì **toàn bộ visual lines sau merge**. Nếu 1 source line wrap thành N visual lines (N > maxVisualLines), kết quả lấy đầu line đó, không phải tail của toàn bộ output. Khi nhiều source line, tổng visual có thể vượt maxVisualLines.

pi-mono dùng pattern đúng: render rồi `slice(-maxVisualLines)`.

**Logic chuẩn**:
```ts
export function truncateToVisualLines(text, maxVisualLines, width, paddingX = 0) {
  if (!text) return { visualLines: [], skippedCount: 0 };
  const effectiveWidth = Math.max(1, width - paddingX * 2);
  const allVisual = text.split("\n").flatMap((line) =>
    wrapHard(pad(line, effectiveWidth).trimEnd(), effectiveWidth)
  );
  if (allVisual.length <= maxVisualLines) return { visualLines: allVisual, skippedCount: 0 };
  return { visualLines: allVisual.slice(-maxVisualLines), skippedCount: allVisual.length - maxVisualLines };
}
```

**Acceptance**:
- 1 source line wrap thành 5 visual lines, maxVisualLines=2 → trả về 2 visual lines cuối + skippedCount=3
- 3 source lines × 2 visual mỗi line = 6 visual, maxVisualLines=4 → trả về 4 cuối + skippedCount=2
- empty input → `{ visualLines: [], skippedCount: 0 }` (đổi từ `[""]` về `[]` để khớp pi-mono)

**Verification**: 2 unit test mới trong `test/unit/visual.test.ts`. Verify transcript-viewer integration vẫn pass test cũ.

**Risk**: thay đổi semantic empty input — kiểm tra all callers (transcript-viewer, run-dashboard) handle `[]` thay vì `[""]`.

---

### Task #51 — Memoize `visibleWidth` qua LRU cache
**Source**: pattern caching từ pi-tui `utils.ts`
**Đích**: `pi-crew/src/utils/visual.ts`

**Lý do**: `visibleWidth(value)` được gọi trong:
- `pad`, `truncateToWidth`, `wrapHard` (mỗi character iter)
- `crew-widget.ts colorWidgetLine` (mỗi line, mỗi tick 250ms)
- `RunDashboard.render` (5-10 lần per render)
- Total ước tính: 50+ calls/render × 4 render/sec = 200+ regex ops/sec.

Cache key = string identity, value = width. Reset khi cache > 256 entries (FIFO eviction).

**API**:
```ts
const widthCache = new Map<string, number>();
const CACHE_LIMIT = 256;

export function visibleWidth(value: string): number {
  const cached = widthCache.get(value);
  if (cached !== undefined) return cached;
  let length = 0;
  for (const char of value.replace(ANSI_PATTERN, "")) {
    if (char !== "\n") length += 1;
  }
  if (widthCache.size >= CACHE_LIMIT) {
    const firstKey = widthCache.keys().next().value;
    if (firstKey !== undefined) widthCache.delete(firstKey);
  }
  widthCache.set(value, length);
  return length;
}
```

**Acceptance**:
- `visibleWidth("foo")` gọi 1000 lần → chỉ tính 1 lần (kiểm qua spy với regex.exec count nếu có Diff bench).
- Cache không leak: limit 256, sau 1000 unique strings thì size = 256.
- Output identical với version không cache (regression test).

**Verification**:
- 1 unit test cache hit
- 1 unit test eviction (insert 257 strings, kiểm size === 256)
- Bench: `visibleWidth(longString) × 10000` → time giảm ≥ 5× (ms log).

**Risk**: cache miss khi string concat/template (mỗi lần object identity khác). Nhận diện qua bench thực tế.

---

## Tier 2 — Theme & style consistency

Mục tiêu: 2 task, hot-reload + inverse fallback. Ước tính: 0.5 ngày.

### Task #52 — Theme hot-reload subscription
**Source**: `pi-mono/coding-agent/theme/theme.ts` `onThemeChange()` + `startThemeWatcher()`
**Đích**: `pi-crew/src/ui/theme-adapter.ts`, `src/extension/register.ts`

**Lý do**: pi-mono có cơ chế watch custom theme JSON, debounce 100ms reload, emit callback. pi-crew adapter chỉ snapshot theme 1 lần ở `ctx.ui.custom((tui, theme, ...) => Component)`. Khi user gõ `/theme dark` từ pi-coding-agent, các pi-crew widget hold theme cũ cho tới khi recreate component.

**Approach**:
1. Add `subscribeThemeChange(theme: unknown, callback: () => void): () => void` trong theme-adapter.ts. Internally:
   - Test if `theme` object có `addEventListener?.("change", ...)` hoặc `onThemeChange?.(...)` API.
   - Fallback: poll `theme.getColorMode?.()` + key signature mỗi 1s, callback nếu thay đổi.
2. CrewWidgetComponent / LiveRunSidebar / RunDashboard / DurableTextViewer: gọi `subscribeThemeChange` trong constructor, store unsubscribe, gọi `this.invalidate()` khi callback fires.
3. dispose: unsubscribe.

**Acceptance**:
- Mock theme với `onThemeChange` API → callback fires trong 200ms.
- Mock theme polling → kiểm callback fires sau 1.1s khi sig thay đổi.
- Dispose component → no further callback.

**Verification**: 2 unit test mock theme objects. Manual test: chạy pi với `/theme light` rồi `/theme dark`, kiểm RunDashboard re-render.

**Risk**: polling 1s × N components → overhead. Mitigate: shared global subscription, fan-out tới components qua singleton subscriber list. Implement singleton trong theme-adapter.

---

### Task #53 — Theme adapter `inverse` ANSI fallback
**Source**: `pi-mono` dùng `chalk.inverse(text)` = `\x1b[7m{text}\x1b[27m`
**Đích**: `pi-crew/src/ui/theme-adapter.ts`

**Lý do**: `asCrewTheme` hiện chỉ pass-through nếu source theme có `inverse`, fallback identity (return text nguyên). render-diff dùng `theme.inverse?.(value) ?? value` → khi theme nguồn không có inverse, intra-line diff highlight bị mất hoàn toàn. Bug visual subtle, không có test catch.

**Logic chuẩn**:
```ts
function asInverse(value: unknown): (text: string) => string {
  const fn = asUnaryFn(value);
  if (fn) return fn;
  return (text) => `\u001b[7m${text}\u001b[27m`;
}
```

**Acceptance**:
- `asCrewTheme(undefined).inverse?.("x")` → `"\u001b[7mx\u001b[27m"`.
- `asCrewTheme(realTheme).inverse?.("x")` → output từ chalk (test bằng `includes("\u001b[7m")`).
- renderDiff với theme tối giản vẫn highlight inverse lookup.

**Verification**: cập nhật `loaders.test.ts`/thêm `theme-adapter.test.ts` 2 test (default fallback + provided theme passthrough).

**Risk**: thấp — additive change.

---

## Tier 3 — UX components (port pattern từ pi-mono)

Mục tiêu: 3 task, footer + selectlist + dynamic border. Ước tính: 1 ngày.

### Task #54 — `CrewFooter` component port
**Source**: `pi-mono/coding-agent/components/footer.ts`
**Đích**: `pi-crew/src/ui/crew-footer.ts` (mới), tích hợp vào `RunDashboard`.

**Lý do**: pi-mono Footer là pattern multi-line trang trí (pwd+branch, tokens, context %, model). pi-crew RunDashboard có summary 1 line trộn rời rạc. Port để đồng bộ visual với coding-agent.

**Layout (3 lines)**:
```
~/proj (main) • runId • running                                      (dim)
↑in ↓out R cache W cache $cost • 45.3%/200k                          (dim, % colored)
[badge1] [badge2] ...                                                 (extension statuses)
```

**API**:
```ts
export interface CrewFooterData {
  pwd: string;
  branch?: string;
  runId?: string;
  status?: RunStatus;
  usage?: UsageState;
  contextWindow?: number;
  contextPercent?: number;
  badges?: string[]; // raw text per extension status
}

export class CrewFooter {
  constructor(private data: CrewFooterData, private theme: CrewTheme) {}
  setData(data: CrewFooterData): void;
  render(width: number): string[];
  invalidate(): void;
}
```

**Color logic**:
- contextPercent > 90 → `theme.fg("error", ...)`
- > 70 → `theme.fg("warning", ...)`
- ≤ 70 → no color

**Acceptance**:
- Render cho run với usage tokens → output chứa `↑`, `↓`, `$cost`.
- Truncate khi width nhỏ → ellipsis `...`.
- contextPercent NaN/undefined → display `?/window`.

**Verification**:
- `test/unit/crew-footer.test.ts` 4 test (basic render, color thresholds, truncation, missing data).
- Integrate vào `RunDashboard.renderFooter` (thay phần legacy footer).

**Risk**: RunDashboard layout shift — kiểm snapshot lines count với existing tests.

---

### Task #55 — `CrewSelectList` adapter
**Source**: `@mariozechner/pi-tui` `SelectList` (peer dep) + pi-mono `extension-selector.ts`/`theme-selector.ts` patterns
**Đích**: `pi-crew/src/ui/crew-select-list.ts`

**Lý do**: RunDashboard handle keyboard navigation thủ công (j/k/enter), không có visual highlight selected, không support `onPreview`. pi-tui SelectList có sẵn nhưng pi-crew chưa wrap. Cần adapter để xài SelectList từ peer dep pi-tui (optional dep — kiểm `import { SelectList } from "@mariozechner/pi-tui"` available).

**Approach**:
1. Detect runtime: `try { require.resolve("@mariozechner/pi-tui"); }` → dùng pi-tui SelectList.
2. Fallback: simple list component port từ extension-selector.ts (j/k/↑/↓/enter/esc handlers, highlight ` → ` cho selected).
3. API:
```ts
export interface CrewSelectItem<T = string> {
  value: T;
  label: string;
  description?: string;
}

export class CrewSelectList<T = string> {
  constructor(
    items: CrewSelectItem<T>[],
    theme: CrewTheme,
    options: {
      onSelect: (item: CrewSelectItem<T>) => void;
      onCancel: () => void;
      onPreview?: (item: CrewSelectItem<T>) => void;
      maxHeight?: number;
    }
  ) {}
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  setSelectedIndex(i: number): void;
  getSelected(): CrewSelectItem<T> | undefined;
}
```

**Acceptance**:
- Render với 5 items → 5 lines, selected có ` → `.
- handleInput("j") → selected index +1, callback onPreview fired.
- handleInput("\n") → callback onSelect with current item.
- maxHeight=3 với 10 items → scroll, indicator `↑ N more`/`↓ N more`.

**Verification**: `test/unit/crew-select-list.test.ts` 5 test.

**Risk**: API mismatch nếu pi-tui SelectList API đổi version. Pin behavior qua adapter, fallback always available.

---

### Task #56 — `DynamicCrewBorder` reusable + CountdownTimer 1s tick
**Source**: `pi-mono/coding-agent/components/dynamic-border.ts` + `countdown-timer.ts`
**Đích**: `pi-crew/src/ui/dynamic-border.ts` (mới), refactor `loaders.ts`

**Lý do**:
1. **DynamicBorder**: 10 LOC, render single line `─×width`. pi-crew có 3 nơi tự vẽ border:
   - `loaders.ts CrewBorderedLoader`: `┌─┐│└─┘` static template
   - `mascot.ts`: tự build `╭─╮│╰─╯`
   - `run-dashboard.ts/transcript-viewer.ts`: tự pad border lines
   → Refactor dùng chung `DynamicCrewBorder` cho horizontal lines, giữ corner chars riêng.
2. **CountdownTimer 1s tick**: hiện tại tick 250ms (4×/s). pi-mono tick chính xác 1000ms + `tui.requestRender()`. 4× tick là wasteful, gây re-render trùng lặp.

**API**:
```ts
// dynamic-border.ts
export interface DynamicCrewBorderOptions {
  color?: (s: string) => string;
  char?: string; // default "─"
}
export class DynamicCrewBorder {
  constructor(theme: CrewTheme, options?: DynamicCrewBorderOptions) {}
  render(width: number): string[];
  invalidate(): void;
}
```

CountdownTimer change:
```ts
// trong loaders.ts CountdownTimer
- this.timer = setInterval(() => { ... }, 250);
+ this.timer = setInterval(() => {
+   const seconds = this.secondsLeft();
+   this.onTick(seconds);
+   if (seconds <= 0) this.emitExpire();
+ }, 1000);
```

**Acceptance**:
- DynamicCrewBorder.render(20) → `["─".repeat(20)]` (with color).
- DynamicCrewBorder dùng trong CrewBorderedLoader, mascot box, run-dashboard separators.
- CountdownTimer onTick called ~3 lần trong 3.5s (giây 3, 2, 1, 0 không nhiều hơn).

**Verification**:
- 2 unit test cho DynamicCrewBorder (basic render, custom char).
- Update `loaders.test.ts` CountdownTimer test: kiểm onTick count = ceil(timeoutMs/1000) + 1.

**Risk**: mascot CountdownTimer (nếu có) cần điều chỉnh cùng. Visual flicker giảm bằng tick 1s thay 250ms.

---

## Tier 4 — Power features

Mục tiêu: 1 task, tool state styling. Ước tính: 0.25 ngày.

### Task #57 — Tool state styling cho transcript-viewer
**Source**: `pi-mono/coding-agent/components/tool-execution.ts` (toolPendingBg/toolSuccessBg/toolErrorBg state)
**Đích**: `pi-crew/src/ui/transcript-viewer.ts`

**Lý do**: transcript-viewer hiện render `[Tool: name] type` plain text. Không phân biệt:
- partial vs final result
- success vs error (`result.isError`)
- queued vs running

User scan transcript khó tìm ra error tool nhanh.

**Logic update `formatTranscriptEvent`**:
```ts
const isError = obj.isError === true || asRecord(obj.result)?.isError === true;
const isPartial = obj.isPartial === true;
const status: RunStatus = isError ? "failed" : isPartial ? "running" : "completed";
const icon = iconForStatus(status, { runningGlyph: "⋯" });
const headerColor = colorForStatus(status);
const header = theme.fg(headerColor, `${icon} [Tool${toolName ? `: ${toolName}` : ""}] ${type}`);
```

**Acceptance**:
- Event với `isError: true` → header có icon `✗`, color `error`.
- Event với `isPartial: true` → header có icon `⋯`/`▶`, color `accent`.
- Event normal → icon `✓`, color `success`.
- Existing tests `formatTranscriptText formats message and tool JSONL into conversation lines` vẫn pass.

**Verification**: thêm 2 test cho transcript-viewer (error tool, partial tool).

**Risk**: thấp — schema event đã có `isError`, chỉ unwrap đúng.

---

## Thứ tự gợi ý thực hiện

1. **Day 1 — Tier 1 (bug fix + perf)**: #50 → #51
   - #50 fix bug subtle có thể impact nhiều screen.
   - #51 cache độc lập, không phụ thuộc #50.

2. **Day 1.5 — Tier 2 (theme)**: #52 → #53
   - #53 nhanh (additive). #52 cần test với mock theme objects.

3. **Day 2 — Tier 3 (UX)**: #54 → #55 → #56
   - #54 footer độc lập, không break.
   - #55 select-list pre-req cho future RunDashboard refactor.
   - #56 dynamic-border refactor 3 file (loaders, mascot, dashboard).

4. **Day 2 close — Tier 4 (#57)**: tool state styling, kết hợp với existing iconForStatus.

Toàn bộ Phase 5 ước tính 1.5–2 ngày focus work, **0 dependency mới**.

---

## Metrics mục tiêu (verification cuối Phase 5)

- **truncateToVisualLines correctness**: 0 known bug. New tests catch slice-after-merge.
- **visibleWidth perf**: cache hit rate ≥ 80% trong tick loop, regex calls giảm ≥ 5× theo bench.
- **Theme reload latency**: < 200ms từ `onThemeChange` callback tới UI re-render.
- **Footer info density**: RunDashboard footer 2-3 line giống pi-coding-agent.
- **Border consistency**: 1 DynamicCrewBorder thay 3 self-rolled patterns.
- **Test count**: 222 unit → ~234 unit (thêm ~12 test cho 8 task).
- **Type safety**: 0 unsafe theme cast (giữ nguyên Phase 4).
- **Deps mới**: 0.

---

## Tracking template (per commit message)

```
Phase 5 task #<num>: <title>

<body — what changed, why, refs to source pi-mono>

Verification: tsc --noEmit OK; test:unit OK; test:integration <OK|N/A>

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
```
