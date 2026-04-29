# Phase 8 — Operator Experience: Interactive Mailbox, Health Pane, Smart Notifications

> Tiếp nối tự nhiên của Phase 7 (UI Optimization). Mục tiêu: biến dashboard từ "viewer" thành "operator console" — actions thực hiện được trực tiếp từ UI, không phải toggle CLI. Path X chosen (Phase 8 = Theme A, Phase 9 = Theme B+C Observability+Reliability deferred).

**Open Questions Resolution (Q1-Q6 đã chốt — xem Section 7 chi tiết):**
- Q1=(b) Có preview compose pane | Q2=(c) Sink JSONL khi `telemetry.enabled` | Q3=(b) Cross-day quiet-hours wrap
- Q4=(c) Full action menu R/K/D trên health pane | Q5=(c) Confirm chỉ destructive | Q6=(a) ESC discard + confirm-if-long guard

## 0. Implementation Status

- [x] 8.0 Foundation: keybinding contract + action dispatcher + RunActionResult shape + ConfirmOverlay primitive
- [x] 8.1.A Mailbox detail overlay (passive list view, no actions yet)
- [x] 8.1.B Mailbox ack action (hotkey `A` trên message đang chọn)
- [x] 8.1.C Mailbox nudge action (hotkey `N` + agent picker)
- [x] 8.1.D Mailbox compose action (hotkey `C` + form overlay) — Q6: ESC discard + confirm-if-long (>50 chars)
- [x] 8.1.E Mailbox compose preview pane (key `P` toggle, render markdown read-only) — Q1
- [x] 8.1.F Mailbox ackAll destructive action (hotkey `Shift+X`) — Q5: requires confirm overlay
- [x] 8.2.A Heartbeat aggregator (`heartbeat-aggregator.ts`)
- [x] 8.2.B Health pane (pane index `5`) trong dashboard
- [x] 8.2.C Auto-recovery prompt (stuck worker > N minutes → toast + confirm) — throttled 5min/run
- [x] 8.2.D Health pane action menu — `R` recovery (foreground only), `K` kill stale workers, `D` diagnostic export — Q4
- [x] 8.3.A Notification router (severity classifier + dedup window)
- [x] 8.3.B Notification quiet-hours (cross-day wrap parser) + batching config — Q3
- [x] 8.3.C Toast badge counter trong widget/powerbar (đếm số notification chưa ack)
- [x] 8.3.D Notification JSONL sink rotate 7 ngày, gated bởi `telemetry.enabled` — Q2
- [x] 8.4 Wire `register.ts` + `commands.ts`
- [x] 8.5 Tests: unit + integration

## 1. Roadmap-Level Decisions

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| D1 | Mailbox actions chạy trực tiếp hay dispatch về team API? | **Dispatch** qua `handleTeamTool({action:"api", config:{operation:...}})` | Tận dụng API hiện có (`ack-message`, `send-message`, `nudge-agent`); zero state-machine duplication; locks/events được giữ nguyên |
| D2 | Overlay form vs inline edit? | **Overlay form** (modal-like, anchor center) | Dashboard sidebar quá hẹp cho text input; overlay tách biệt focus; ESC dễ cancel |
| D3 | Health pane là pane mới (`5`) hay tab trong progress? | **Pane mới `5`** | Tránh pollute progress pane; cho user toggle độc lập; consistent với existing 1-4 |
| D4 | Notification sink: optional opt-in hay default-on? | **Default-on khi `telemetry.enabled !== false`** (Q2=c) | Đồng nhất pattern Phase 6 telemetry; debug-friendly; user opt-out qua telemetry config chung. Path: `<crewRoot>/state/notifications/{YYYY-MM-DD}.jsonl`, rotate 7 ngày |
| D5 | Quiet-hours format + cross-day? | **HH:MM-HH:MM trong config local timezone, support cross-day wrap** (Q3=b) | Single range `"22:00-07:00"` parser tự nhận diện wrap-around; intuitive vs multi-range array |
| D6 | Compose-form fields scope? | **Phase 8: from/to/body/taskId + preview pane** (Q1=b) | Preview key `P` toggle render markdown read-only; thread/attachment defer Phase 9 |
| D7 | Action mới có break keybinding cũ? | **No** — phím mới: `A/N/C/P/Shift+X` (mailbox), `R/K/D` (health), `H/X` (notification); phím hiện hành (`s/u/a/i/d/m/e/o/v/r/p/1-4/k/j`) giữ nguyên (lowercase `r` vẫn = reload root, uppercase `R` = recovery in health pane only) | Backward-compat; context-scoped uppercase |
| D8 | Mailbox detail panel: inline expand hay separate overlay? | **Separate overlay** (mở khi nhấn Enter trên pane mailbox) | Pane chính giữ nguyên density; overlay scrollable |
| D9 | Health pane action mode: prompt-only vs full menu? | **Full action menu (Q4=c)**: `R` recovery (foreground-only), `K` kill stale workers, `D` diagnostic export | Operator power-user toolkit; async runs `R/K` disabled with hint; `D` cực hữu ích cho bug report |
| D10 | Foundation 8.0: tách RunActionDispatcher hay inline? | **Tách module** `src/ui/run-action-dispatcher.ts` | Reuse cho overlay con; dễ test; không bloat dashboard |
| D11 | Compose ESC behavior? | **Discard + confirm-if-long** (Q6=a) | ESC không lưu draft; nếu body > 50 ký tự → confirm overlay `Y=discard, N=continue editing`; defer draft persistence Phase 9 |
| D12 | Confirm overlay: per-action ad-hoc hay reusable primitive? | **Reusable primitive** `src/ui/overlays/confirm-overlay.ts` | Q5=c destructive (ackAll/recovery/diagnostic-export-with-secrets) cần consistent UX; reuse cho mọi confirm |
| D13 | Auto-recovery throttle window? | **5 phút/run/condition-type** | Tránh notification storm khi run dead lâu; `recovery_dead_workers` riêng biệt với `recovery_missing_heartbeat` |
| D14 | Diagnostic export `D` format & destination? | **JSON + redact secrets** vào `<crewRoot>/artifacts/{runId}/diagnostic-{timestamp}.json` | Self-contained snapshot (manifest + tasks + recent events + heartbeat summary); confirm before write nếu artifact-dir đã có file diag cũ < 1 phút |
| D15 | Preview pane render scope (Q1=b)? | **Read-only markdown render**: bold/italic/code-block/list — no images/links | Đủ cho operator đọc nội dung trước khi gửi; không cần markdown engine đầy đủ; reuse từ existing transcript-viewer markdown helper nếu có |

## 2. Phase Breakdown

### Phase 8.0 — Foundation (2 dev-day, +0.5 cho ConfirmOverlay)

**File mới:**
- `src/ui/run-action-dispatcher.ts` — wrapper gọi `handleTeamTool` với `runId` + `operation`, normalize result thành `{ ok, message, data }`.
- `src/ui/keybinding-map.ts` — central registry mapping `data` (raw stdin) → action name; export `KEY_RESERVED` để overlay con check conflict.
- `src/ui/overlays/confirm-overlay.ts` — **(Q5)** reusable confirm primitive, anchor center, auto-focus `N` (safe default), Y/Enter=confirm, N/ESC=cancel. ~80 LOC.

**Sửa:**
- `src/ui/run-dashboard.ts` — refactor `handleInput` dùng `keybinding-map`; không thay đổi behavior cũ.

**Skeleton:**

```ts
// run-action-dispatcher.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { handleTeamTool } from "../extension/team-tool.ts";

export interface RunActionResult {
	ok: boolean;
	message: string;
	data?: unknown;
}

export async function dispatchMailboxAck(ctx: ExtensionContext, runId: string, messageId: string): Promise<RunActionResult> {
	try {
		const r = await handleTeamTool({ action: "api", runId, config: { operation: "ack-message", messageId } }, ctx);
		return { ok: r.metadata?.status === "ok", message: r.text, data: r };
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

export async function dispatchMailboxNudge(ctx: ExtensionContext, runId: string, agentId: string, message: string): Promise<RunActionResult> { /* ... */ }
export async function dispatchMailboxCompose(ctx: ExtensionContext, runId: string, payload: { from: string; to: string; body: string; taskId?: string; direction: "inbox" | "outbox" }): Promise<RunActionResult> { /* ... */ }
export async function dispatchMailboxAckAll(ctx: ExtensionContext, runId: string): Promise<RunActionResult> { /* read-mailbox → loop ack-message */ }
export async function dispatchHealthRecovery(ctx: ExtensionContext, runId: string): Promise<RunActionResult> { /* foreground-interrupt API */ }
export async function dispatchKillStaleWorkers(ctx: ExtensionContext, runId: string): Promise<RunActionResult> { /* mark dead heartbeats; emit event */ }
export async function dispatchDiagnosticExport(ctx: ExtensionContext, runId: string): Promise<RunActionResult> { /* read-manifest + list-tasks + read-events limit=200 + heartbeat summary → write artifact */ }
```

```ts
// keybinding-map.ts (Q4 + Q5 expanded)
export const DASHBOARD_KEYS = {
	close: ["q", "\u001b"],
	select: ["\r", "\n", "s"],
	pane: { agents: ["1"], progress: ["2"], mailbox: ["3"], output: ["4"], health: ["5"] },
	// Mailbox detail overlay context
	mailbox: { ack: ["A"], nudge: ["N"], compose: ["C"], preview: ["P"], ackAll: ["X"], openDetail: ["\r", "\n"] },
	// Health pane context (Q4=c full menu)
	health: { recovery: ["R"], killStale: ["K"], diagnosticExport: ["D"] },
	// Notification context
	notification: { dismissAll: ["H"] },  // 'H' for Hush
} as const;
```

```ts
// confirm-overlay.ts
export interface ConfirmOptions {
	title: string;
	body?: string;
	dangerLevel?: "low" | "medium" | "high";  // colors theme accent
	defaultAction?: "confirm" | "cancel";  // default "cancel"
}
export class ConfirmOverlay {
	constructor(private opts: ConfirmOptions, private done: (confirmed: boolean) => void, private theme: unknown) {}
	render(width: number): string[] { /* anchor-center box, dim Y/N hint */ }
	handleInput(data: string): void {
		if (data === "y" || data === "Y" || data === "\r" || data === "\n") return this.done(true);
		if (data === "n" || data === "N" || data === "\u001b" || data === "q") return this.done(false);
	}
}
```

**Tests:**
- `test/unit/run-action-dispatcher.test.ts` (7 test cases — 4 mailbox dispatchers + 3 health dispatchers, mock `handleTeamTool`).
- `test/unit/confirm-overlay.test.ts` (4 cases: render, Y confirms, N cancels, default cancel safety).

---

### Phase 8.1 — Mailbox Interactivity

#### 8.1.A Mailbox detail overlay (1 dev-day)

**File mới:**
- `src/ui/overlays/mailbox-detail-overlay.ts` — class `MailboxDetailOverlay` implement Pi UI custom widget; render 2-column (inbox | outbox); ↑/↓ select; Enter expand body; ESC/q close.

**Cập nhật:**
- `src/ui/dashboard-panes/mailbox-pane.ts` — line cuối cùng đổi từ "use /team-api ..." thành `"Press Enter on mailbox pane to open detail (A=ack, N=nudge, C=compose)"`.
- `src/ui/run-dashboard.ts` — khi `activePane === "mailbox"` và user nhấn Enter, return `{action: "mailbox-detail"}` thay vì close.
- `src/extension/registration/commands.ts` — handle `selection.action === "mailbox-detail"` → mở `MailboxDetailOverlay` qua `ctx.ui.custom`.

**Skeleton:**

```ts
export class MailboxDetailOverlay {
	private inbox: MailboxMessage[] = [];
	private outbox: MailboxMessage[] = [];
	private selected = 0;
	private side: "inbox" | "outbox" = "inbox";
	constructor(private opts: { runId: string; cwd: string; ctx: ExtensionContext; done: (sel?: MailboxAction) => void; theme: unknown }) {
		this.refresh();
	}
	private refresh(): void { /* read mailbox via team api */ }
	render(width: number): string[] { /* 2-col layout, highlight selected */ }
	handleInput(data: string): void { /* arrow nav, A/N/C dispatch via this.opts.done */ }
}

export interface MailboxAction {
	type: "ack" | "nudge" | "compose" | "reply";
	messageId?: string;
	agentId?: string;
}
```

**Tests:** `test/unit/mailbox-detail-overlay.test.ts` — 4 cases (render empty, render with items, key navigation, action dispatch).

#### 8.1.B Ack action (0.75 dev-day)

**Logic:** trong `MailboxDetailOverlay.handleInput`, key `A` (uppercase, để tránh conflict với `a`=artifacts ở dashboard root) → `done({type:"ack", messageId: selectedMessage.id})`.

**Update `commands.ts`:** sau khi overlay close, nếu action.type === "ack" → call `dispatchMailboxAck(ctx, runId, action.messageId!)` → toast result.

**Acceptance:** ack thành công → mailbox pane re-render với attention count giảm trong < 250ms (snapshot cache invalidate khi `crew.mailbox.acknowledged` event).

#### 8.1.C Nudge action (0.75 dev-day)

**Logic:** key `N` → mở agent picker overlay (reuse pattern từ existing `LiveRunSidebar`); chọn xong → message input → dispatch `dispatchMailboxNudge`.

**File mới:** `src/ui/overlays/agent-picker-overlay.ts` (nhỏ, 80-120 LOC).

**Acceptance:** nudge → `crew.mailbox.message` event fire → snapshot invalidate → mailbox pane attention count tăng đúng.

#### 8.1.D Compose form (1.25 dev-day)

**File mới:** `src/ui/overlays/mailbox-compose-overlay.ts` — form 4 field (from/to/body/taskId), Tab navigation, Enter submit, ESC cancel.

**Behavior chi tiết (Q6=a):**
- Tab/Shift+Tab: cycle giữa các field.
- Body multi-line: Ctrl+Enter → newline; Enter trên field body với content non-empty → submit.
- ESC khi body ≤ 50 ký tự → discard immediately, close overlay.
- ESC khi body > 50 ký tự → mở `ConfirmOverlay` với title `"Discard draft?"` body `"Body has N chars. Y=discard, N=continue editing"`. Cancel default = continue editing (safe).
- Submit validate: body required (non-whitespace), to required, from default `"operator"` if empty.
- Direction toggle: Tab vào checkbox `[ ] Send to outbox` → Space toggle.

**Logic dispatch:** `dispatchMailboxCompose` với `direction` từ checkbox (default `"inbox"` — operator gửi vào inbox của run).

**Tests:** `test/unit/mailbox-compose-overlay.test.ts` — 8 cases (render, tab nav, ESC short discard, ESC long → confirm overlay, confirm overlay cancel = stay editing, confirm overlay confirm = discard, Enter submit, validation empty body, validation empty to).

#### 8.1.E Compose preview pane (0.75 dev-day) — Q1=b

**File mới:** `src/ui/overlays/mailbox-compose-preview.ts` — read-only render markdown của body field hiện tại; share state với `mailbox-compose-overlay.ts`.

**Layout:** compose overlay split horizontal khi preview active — 60% form / 40% preview pane (pane render markdown read-only, không cho focus).

**Render scope (D15):** bold (`**`), italic (`*`), code-block (`` ``` ``), inline code (`` ` ``), unordered list (`-`), numbered list (`1.`), heading (`#`/`##`/`###`). Skip images/links (out of scope; render link text only).

**Behavior:**
- Key `P` toggle preview on/off (state in compose overlay).
- Preview cập nhật real-time khi body thay đổi (debounce 100ms để tránh re-render mỗi keystroke).
- Khi preview active, header help line update: `"P close preview · Tab cycle · Enter submit · ESC discard"`.

**Skeleton:**

```ts
// mailbox-compose-preview.ts
export function renderComposePreview(body: string, width: number, theme: CrewTheme): string[] {
	const tokens = tokenizeMarkdown(body);  // simple tokenizer ~80 LOC
	return tokens.flatMap((t) => renderToken(t, width, theme));
}

function tokenizeMarkdown(body: string): MdToken[] { /* line-by-line scan */ }
type MdToken = { type: "heading" | "code-block" | "list-item" | "paragraph"; level?: number; text: string };
```

**Tests:** `test/unit/mailbox-compose-preview.test.ts` — 6 cases (plain text, bold/italic, code block, list, heading, mixed content).

#### 8.1.F Mailbox ackAll (0.5 dev-day) — Q5=c destructive

**Logic:** trong `MailboxDetailOverlay.handleInput`, key `Shift+X` (raw stdin `"X"` uppercase) → mở `ConfirmOverlay`:
- Title: `"Acknowledge all N unread messages?"`
- Body: `"This cannot be undone. Y=ack all, N=cancel."`
- DangerLevel: `"medium"`.

Confirm `Y` → `dispatchMailboxAckAll(ctx, runId)` (dispatcher loop ack-message từng id) → toast result `"Acknowledged N messages."`.

**Acceptance:** ackAll trong run với 10 unread → all marked acknowledged trong < 2s; mailbox pane attention → 0; emit 10x `crew.mailbox.acknowledged` event.

**Tests:** `test/unit/mailbox-detail-overlay.test.ts` thêm 3 cases (Shift+X opens confirm, confirm Y dispatches loop, confirm N stays).

---

### Phase 8.2 — Health Pane & Recovery

#### 8.2.A Heartbeat aggregator (1 dev-day)

**File mới:** `src/ui/heartbeat-aggregator.ts`

```ts
export interface HeartbeatSummary {
	runId: string;
	totalTasks: number;
	healthy: number;       // alive=true, lastSeenAt < threshold
	stale: number;         // lastSeenAt > stale threshold (default 60s)
	dead: number;          // lastSeenAt > dead threshold (default 5min) hoặc alive=false
	missing: number;       // task running nhưng no heartbeat record
	worstStaleMs: number;
}

export function summarizeHeartbeats(snapshot: RunUiSnapshot, opts?: { staleMs?: number; deadMs?: number; now?: number }): HeartbeatSummary { /* ... */ }
```

**Tests:** `test/unit/heartbeat-aggregator.test.ts` — 6 cases (all healthy, mixed, all dead, missing record, custom threshold, edge `lastSeenAt=now`).

#### 8.2.B Health pane (0.75 dev-day)

**File mới:** `src/ui/dashboard-panes/health-pane.ts`

```ts
export function renderHealthPane(snapshot: RunUiSnapshot | undefined, opts?: { staleMs?: number; deadMs?: number; isForeground?: boolean }): string[] {
	if (!snapshot) return ["Health pane: snapshot unavailable"];
	const summary = summarizeHeartbeats(snapshot, opts);
	const lines: string[] = [
		`Health: ${summary.healthy}/${summary.totalTasks} healthy · stale=${summary.stale} · dead=${summary.dead} · missing=${summary.missing}`,
	];
	if (summary.worstStaleMs > 0) lines.push(`Worst stale: ${Math.round(summary.worstStaleMs / 1000)}s ago`);
	// Q4=c: show full action menu hint
	const actionHints: string[] = [];
	if ((summary.dead > 0 || summary.missing > 0) && opts?.isForeground !== false) actionHints.push("R recovery");
	if (summary.dead > 0 || summary.stale > 0) actionHints.push("K kill stale");
	actionHints.push("D diagnostic export");
	if (actionHints.length > 0) lines.push(`Actions: ${actionHints.join(" · ")}`);
	if (summary.dead > 0 && opts?.isForeground === false) lines.push("(Async run: R/K disabled — use kill <pid> manually)");
	return lines;
}
```

**Update `run-dashboard.ts`:**
- Thêm `"health"` vào type `Pane`.
- Key `5` → `activePane = "health"`.
- Switch case render `renderHealthPane` với `isForeground` từ `selectedRun.async ? false : true`.
- Trong `handleInput`: nếu `activePane === "health"`:
  - `R` → emit `{action: "health-recovery", runId}` (handler sẽ check foreground + ConfirmOverlay).
  - `K` → emit `{action: "health-kill-stale", runId}` (handler ConfirmOverlay if dead > 5).
  - `D` → emit `{action: "health-diagnostic-export", runId}` (handler check existing diag < 1min → confirm overwrite).
- Header help line update: `"1 agents 2 progress 3 mailbox 4 output 5 health • s/u/a/i actions • R/K/D health"`.

**Tests:** `test/unit/health-pane.test.ts` — 6 cases (no snapshot, all healthy → only D hint, dead foreground → R+K+D, dead async → only D + warning, mixed states, foreground false hint visible).

#### 8.2.C Auto-recovery toast (0.5 dev-day) — Q4 simplified

**Logic:** `RenderScheduler.tick` callback (đã có) gọi `summarizeHeartbeats`; nếu `dead > 0` hoặc `missing > 0` lần đầu → fire toast qua `notification-router` (8.3.A) với severity `"warning"`:
- Title: `"Run {runId} has {N} dead workers"`.
- Body: `"Open dashboard → 5 health → R recovery / K kill stale / D diagnostic"`.

**Throttle (D13):** dedup id = `recovery_dead_workers_${runId}` — router dedup 5 phút/run/condition-type. Riêng `recovery_missing_heartbeat` có id khác để alert song song nếu cả hai cùng xảy ra.

**Tests:** `test/integration/health-recovery.test.ts` — simulate stale heartbeat, verify single toast emitted; emit lần 2 trong window → drop; emit lần 2 sau 5min → fire lại.

#### 8.2.D Health action handlers (1.5 dev-day) — Q4=c full menu

**Update `src/extension/registration/commands.ts`:** handle 3 new actions từ dashboard:

```ts
// pseudo-code
if (selection.action === "health-recovery") {
	const run = manifestCache.get(selection.runId);
	if (run?.async) { ctx.ui.notify("Recovery only available for foreground runs.", "warning"); return; }
	const confirmed = await openConfirmOverlay(ctx, { title: "Interrupt foreground run?", body: "Tasks will be marked failed. Y=interrupt, N=cancel.", dangerLevel: "high" });
	if (!confirmed) return;
	const r = await dispatchHealthRecovery(ctx, selection.runId);
	ctx.ui.notify(r.message, r.ok ? "info" : "error");
}

if (selection.action === "health-kill-stale") {
	const summary = summarizeHeartbeats(snapshotCache.get(selection.runId)!);
	if (summary.dead + summary.stale > 5) {
		const confirmed = await openConfirmOverlay(ctx, { title: `Kill ${summary.dead + summary.stale} stale workers?`, dangerLevel: "medium" });
		if (!confirmed) return;
	}
	const r = await dispatchKillStaleWorkers(ctx, selection.runId);
	ctx.ui.notify(r.message, r.ok ? "info" : "error");
}

if (selection.action === "health-diagnostic-export") {
	// D14: check existing diag in last 1min
	const diagDir = path.join(run.artifactsRoot, "diagnostic");
	const recentDiag = listRecentDiagnostic(diagDir, 60_000);
	if (recentDiag) {
		const confirmed = await openConfirmOverlay(ctx, { title: "Recent diagnostic exists", body: `File ${recentDiag} created < 1min ago. Overwrite?`, defaultAction: "cancel" });
		if (!confirmed) return;
	}
	const r = await dispatchDiagnosticExport(ctx, selection.runId);
	ctx.ui.notify(`Diagnostic exported to ${r.data}`, r.ok ? "info" : "error");
}
```

**File mới:** `src/runtime/diagnostic-export.ts` — collect manifest + tasks + recent events (limit 200) + heartbeat summary + agent status snapshot; redact secrets từ env/config (block list: `*token*`, `*key*`, `*password*`, `*secret*`); write JSON vào `<crewRoot>/artifacts/{runId}/diagnostic-{ISO-timestamp}.json`.

**Skeleton:**

```ts
// diagnostic-export.ts
export interface DiagnosticReport {
	runId: string;
	exportedAt: string;
	manifest: TeamRunManifest;
	tasks: TeamTaskState[];
	recentEvents: TeamEvent[];
	heartbeat: HeartbeatSummary;
	agents: { taskId: string; status: AgentStatus }[];
	envRedacted: Record<string, string>;  // env vars with secrets masked as "***"
}

export async function exportDiagnostic(ctx: ExtensionContext, runId: string): Promise<{ path: string; report: DiagnosticReport }> { /* ... */ }

function redactSecrets(obj: unknown): unknown { /* recursive replace values where key matches block list */ }
```

**Tests:**
- `test/unit/diagnostic-export.test.ts` — 5 cases (basic export, secret redaction, missing run errors, file path generation, JSON validity).
- Smoke: export → open file → verify đầy đủ field + 0 secrets.

---

### Phase 8.3 — Smart Notifications

#### 8.3.A Notification router (1 dev-day)

**File mới:** `src/extension/notification-router.ts`

```ts
export type Severity = "info" | "warning" | "error" | "critical";

export interface NotificationDescriptor {
	id?: string;        // dedup key; nếu cùng id trong window → drop
	severity: Severity;
	source: string;     // "run-completed" | "subagent-stuck" | "health" | ...
	runId?: string;
	title: string;
	body?: string;
	timestamp?: number;
}

export interface NotificationRouterOptions {
	dedupWindowMs?: number;   // default 30000
	batchWindowMs?: number;   // default 0 (no batching by default)
	quietHours?: string;      // "22:00-07:00" local
	severityFilter?: Severity[];  // default: ["warning", "error", "critical"]
	sink?: (n: NotificationDescriptor) => void;  // optional file/stream sink
}

export class NotificationRouter {
	constructor(private opts: NotificationRouterOptions = {}, private deliver: (n: NotificationDescriptor) => void) {}
	enqueue(n: NotificationDescriptor): void { /* dedup check, severity filter, quiet-hours skip, batch buffer, sink */ }
	flush(): void { /* deliver batched */ }
	dispose(): void { /* clear timers */ }
}
```

**Wrap `sendFollowUp`:** trong `register.ts`, thay 2 call sites `sendFollowUp(...)` thành `notificationRouter.enqueue({...})`. Router decides có deliver qua `sendFollowUp` hay không.

**Tests:** `test/unit/notification-router.test.ts` — 8 cases (dedup, severity filter, quiet hours mock clock, batch, sink invocation, dispose cleanup).

#### 8.3.B Quiet-hours + batching config (0.75 dev-day) — Q3=b cross-day wrap

**Update `src/schema/config-schema.ts`:**
```ts
notifications: Type.Optional(Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	severityFilter: Type.Optional(Type.Array(Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error"), Type.Literal("critical")]))),
	dedupWindowMs: Type.Optional(Type.Integer({ minimum: 1000 })),
	batchWindowMs: Type.Optional(Type.Integer({ minimum: 0 })),
	quietHours: Type.Optional(Type.String({ pattern: "^\\d{2}:\\d{2}-\\d{2}:\\d{2}$" })),
	sinkRetentionDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),  // Q2=c, default 7
})),
```

**Update `src/config/defaults.ts`:** sane defaults (`severityFilter: ["warning","error","critical"]`, `dedupWindowMs: 30_000`, `batchWindowMs: 0`, `sinkRetentionDays: 7`).

**Update `src/config/config.ts`:** parse + merge giống các section khác.

**Cross-day parser (Q3=b):** trong `notification-router.ts`, helper isolated cho easy testing:

```ts
// notification-router.ts (excerpt)
export function parseHHMMRange(range: string): { startMin: number; endMin: number } {
	const [s, e] = range.split("-").map((part) => {
		const [hh, mm] = part.split(":").map(Number);
		return hh * 60 + mm;
	});
	return { startMin: s, endMin: e };
}

export function isInQuietHours(range: string, now: Date = new Date()): boolean {
	const { startMin, endMin } = parseHHMMRange(range);
	const cur = now.getHours() * 60 + now.getMinutes();
	if (startMin === endMin) return false;  // empty range
	// Q3=b: cross-day wrap when start > end
	return startMin <= endMin
		? (cur >= startMin && cur < endMin)
		: (cur >= startMin || cur < endMin);
}
```

**Tests:** `test/unit/notification-router.test.ts` thêm 4 cases parser:
- `"09:00-17:00"` ở 12:00 → quiet (true).
- `"09:00-17:00"` ở 22:00 → not quiet (false).
- `"22:00-07:00"` ở 23:30 → quiet (cross-day true).
- `"22:00-07:00"` ở 03:00 → quiet (cross-day true).
- `"22:00-07:00"` ở 12:00 → not quiet (false).
- Edge: `"00:00-23:59"` ở 12:00 → quiet (always-quiet within day).
- Edge: `"00:00-00:00"` → always not quiet (empty range).

#### 8.3.C Toast badge integration (0.75 dev-day)

**Logic:** `NotificationRouter.deliver` → ngoài `sendFollowUp`, cộng `unreadCount++` trong `widgetState.notificationCount`. Reset khi user mở mailbox detail hoặc nhấn `H` (Hush — dismiss-all notifications visible badge).

**Update `crew-widget.ts`:** model render thêm `🔔${count}` nếu `count > 0`. Để tránh emoji compatibility issue → fallback `[!${count}]` khi terminal không support emoji (detect qua `process.env.TERM`).

**Update `powerbar-publisher.ts`:** segment `pi-crew-active` text append ` 🔔${count}` (hoặc fallback) khi active.

**Tests:** `test/unit/widget-notification-badge.test.ts` — 5 cases (no count, count=1, count>9, dismiss reset, terminal fallback).

#### 8.3.D Notification JSONL sink (0.5 dev-day) — Q2=c

**File mới:** `src/extension/notification-sink.ts`

**Logic:** khi config `telemetry.enabled !== false`, NotificationRouter delivery cũng gọi `sink.write(descriptor)`. Sink writes vào `<crewRoot>/state/notifications/{YYYY-MM-DD}.jsonl` (1 file/day, append-only).

**Rotation:** start-of-day check (lazy, khi write đầu tiên) → delete files cũ hơn `notifications.sinkRetentionDays` (default 7).

**Skeleton:**

```ts
// notification-sink.ts
export interface NotificationSink {
	write(n: NotificationDescriptor): void;
	dispose(): void;
}

export function createJsonlSink(crewRoot: string, retentionDays: number): NotificationSink {
	const dir = path.join(crewRoot, "state", "notifications");
	let lastRotateDate = "";
	return {
		write(n) {
			const today = new Date().toISOString().slice(0, 10);
			if (today !== lastRotateDate) {
				rotateOldFiles(dir, retentionDays);
				lastRotateDate = today;
			}
			fs.mkdirSync(dir, { recursive: true });
			fs.appendFileSync(path.join(dir, `${today}.jsonl`), JSON.stringify({ ...n, timestamp: n.timestamp ?? Date.now() }) + "\n");
		},
		dispose() { /* no-op */ },
	};
}

function rotateOldFiles(dir: string, retentionDays: number): void {
	if (!fs.existsSync(dir)) return;
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith(".jsonl")) continue;
		const stat = fs.statSync(path.join(dir, file));
		if (stat.mtimeMs < cutoff) fs.unlinkSync(path.join(dir, file));
	}
}
```

**Wire trong `register.ts`:** instantiate sink khi `telemetry.enabled !== false`, pass vào `NotificationRouter` options. Dispose trong `cleanupRuntime`.

**Tests:** `test/unit/notification-sink.test.ts` — 5 cases (write basic, daily rotation, retention prune, no rotation cùng ngày, telemetry disabled = no-op).

---

### Phase 8.4 — Wiring (0.75 dev-day)

**Update `src/extension/register.ts`:**
- Instantiate `NotificationRouter` cùng cấp với `runSnapshotCache`; check `loadConfig.telemetry?.enabled !== false` để decide có pass `JsonlSink` không.
- Pass router vào `subagentManager` callback (line 64-86) thay vì gọi trực tiếp `sendFollowUp`.
- Pass router vào `RenderScheduler` callback cho 8.2.C auto-recovery alert.
- Pass `getRunSnapshotCache` + `notificationRouter` vào `commands.ts` deps.
- Dispose router + sink trong `cleanupRuntime`.

**Update `src/extension/registration/commands.ts`:**
- Handle `selection.action === "mailbox-detail"` → mở `MailboxDetailOverlay`, dispatch action result, toast.
- Handle `selection.action === "health-recovery" | "health-kill-stale" | "health-diagnostic-export"` (Q4=c) — flow chi tiết 8.2.D.
- Pass `getRunSnapshotCache` cho overlay (cần để re-render sau action).
- Pass `confirmOverlayFactory` để các handler reuse `ConfirmOverlay`.

---

### Phase 8.5 — Tests + Validation (2 dev-day)

**Unit (mới ~52 cases):**
- `run-action-dispatcher.test.ts` (7)
- `confirm-overlay.test.ts` (4)
- `mailbox-detail-overlay.test.ts` (7 — bao gồm 3 cases ackAll Shift+X)
- `mailbox-compose-overlay.test.ts` (8)
- `mailbox-compose-preview.test.ts` (6) — Q1
- `agent-picker-overlay.test.ts` (4)
- `heartbeat-aggregator.test.ts` (6)
- `health-pane.test.ts` (6) — Q4 expanded
- `diagnostic-export.test.ts` (5) — Q4
- `notification-router.test.ts` (8 + 4 quiet-hours parser cases = 12) — Q3
- `notification-sink.test.ts` (5) — Q2
- `widget-notification-badge.test.ts` (5)

**Integration (mới ~6 cases):**
- `test/integration/mailbox-action-roundtrip.test.ts` — open dashboard → ack → snapshot invalidate → count giảm.
- `test/integration/mailbox-ackall-confirm.test.ts` — ackAll trigger ConfirmOverlay → confirm → loop ack 10 messages.
- `test/integration/notification-dedup.test.ts` — emit cùng event 5 lần trong 30s → 1 toast.
- `test/integration/notification-quiet-hours.test.ts` — set quietHours `"22:00-07:00"`, mock now=23:30 → 0 toast; mock now=12:00 → 1 toast.
- `test/integration/notification-sink-rotation.test.ts` — write 8 days → oldest file deleted on day 8.
- `test/integration/health-recovery-foreground.test.ts` — foreground run dead → R action → ConfirmOverlay → confirm → foreground-interrupt fired.
- `test/integration/health-diagnostic-export.test.ts` — D action → diagnostic file written với secrets redacted; emit lần 2 trong 1min → ConfirmOverlay overwrite.

**Acceptance trước commit:**
- `npm test` ≥ 351 unit (current 299 + 52), 35 integration (current 29 + 6); 0 fail. Verified current suite: 351 unit + 44 integration.
- `npm run typecheck` clean.
- Manual smoke coverage (8 scenarios — mục 6) captured as automated smoke in `test/integration/phase8-smoke.test.ts`.

## 3. Wave Organization (parallel-friendly) — Updated với Q1-Q6

```
Wave 1 (parallel, 2.5 days)
├─ 8.0 Foundation (dispatcher + keybinding-map + ConfirmOverlay)
├─ 8.3.A NotificationRouter primitive
└─ 8.2.A Heartbeat aggregator

Wave 2 (sequential, 5 days) — depends on Wave 1
├─ 8.1.A Mailbox detail overlay
├─ 8.1.B Ack action
├─ 8.1.C Nudge action
├─ 8.1.D Compose form (Q6 ESC discard + confirm-if-long)
├─ 8.1.E Compose preview pane (Q1)
└─ 8.1.F ackAll Shift+X destructive (Q5)

Wave 3 (parallel, 4 days) — depends on Wave 1
├─ 8.2.B Health pane
├─ 8.2.C Auto-recovery toast (throttled 5min D13)
├─ 8.2.D Health action handlers R/K/D (Q4) + diagnostic-export module
├─ 8.3.B Quiet-hours cross-day parser (Q3) + batching config
├─ 8.3.C Toast badge widget/powerbar
└─ 8.3.D JSONL sink + retention (Q2)

Wave 4 (sequential, 2.75 days)
├─ 8.4 Wire register.ts + commands.ts (router, sink, action handlers)
└─ 8.5 Tests + smoke validation (52 unit + 6 integration mới)
```

**Total estimate: 14-18 dev-days** (vs Phase 7 baseline 18 days). Effort tăng 3.35 day so với plan gốc 11-14d do Q1-Q6 chosen options enrich scope. Phase 8 vẫn smaller hơn Phase 7 vì chủ yếu UI overlay + event router, không động state machine.

## 4. Files Affected — Updated với Q1-Q6

### New (24 files)
| Path | Purpose | Est LOC |
|---|---|---|
| `src/ui/run-action-dispatcher.ts` | Wrapper team-tool calls (7 dispatchers) | ~140 |
| `src/ui/keybinding-map.ts` | Key registry (mailbox/health/notification scopes) | ~70 |
| `src/ui/overlays/confirm-overlay.ts` | **(Q5)** Reusable confirm primitive | ~80 |
| `src/ui/overlays/mailbox-detail-overlay.ts` | 2-col mailbox view + ackAll | ~250 |
| `src/ui/overlays/mailbox-compose-overlay.ts` | Compose form + ESC guard | ~210 |
| `src/ui/overlays/mailbox-compose-preview.ts` | **(Q1)** Markdown preview pane | ~120 |
| `src/ui/overlays/agent-picker-overlay.ts` | Agent selector | ~110 |
| `src/ui/heartbeat-aggregator.ts` | Heartbeat summary fn | ~70 |
| `src/ui/dashboard-panes/health-pane.ts` | Health pane renderer with action hints | ~80 |
| `src/extension/notification-router.ts` | Router + dedup + quiet-hours parser **(Q3)** | ~220 |
| `src/extension/notification-sink.ts` | **(Q2)** JSONL sink + retention rotation | ~100 |
| `src/runtime/diagnostic-export.ts` | **(Q4)** Diagnostic JSON exporter + secret redaction | ~140 |
| `test/unit/run-action-dispatcher.test.ts` | | ~140 |
| `test/unit/confirm-overlay.test.ts` | | ~80 |
| `test/unit/mailbox-detail-overlay.test.ts` | | ~180 |
| `test/unit/mailbox-compose-overlay.test.ts` | | ~180 |
| `test/unit/mailbox-compose-preview.test.ts` | **(Q1)** | ~120 |
| `test/unit/agent-picker-overlay.test.ts` | | ~80 |
| `test/unit/heartbeat-aggregator.test.ts` | | ~120 |
| `test/unit/health-pane.test.ts` | Q4 expanded scenarios | ~140 |
| `test/unit/diagnostic-export.test.ts` | **(Q4)** | ~110 |
| `test/unit/notification-router.test.ts` | + 4 cross-day parser cases | ~260 |
| `test/unit/notification-sink.test.ts` | **(Q2)** | ~100 |
| `test/unit/widget-notification-badge.test.ts` | | ~80 |
| `test/integration/mailbox-action-roundtrip.test.ts` | | ~120 |
| `test/integration/mailbox-ackall-confirm.test.ts` | **(Q5)** | ~100 |
| `test/integration/notification-dedup.test.ts` | | ~90 |
| `test/integration/notification-quiet-hours.test.ts` | **(Q3)** mock clock | ~110 |
| `test/integration/notification-sink-rotation.test.ts` | **(Q2)** | ~110 |
| `test/integration/health-recovery-foreground.test.ts` | **(Q4)** | ~120 |
| `test/integration/health-diagnostic-export.test.ts` | **(Q4)** | ~120 |

### Modified (10 files)
| Path | Change |
|---|---|
| `src/ui/run-dashboard.ts` | Refactor `handleInput` dùng keybinding-map; thêm pane "health" key `5`; help line; emit `health-recovery/health-kill-stale/health-diagnostic-export` actions (Q4) |
| `src/ui/dashboard-panes/mailbox-pane.ts` | Update help text gợi ý A/N/C/Enter/Shift+X (ackAll) |
| `src/ui/crew-widget.ts` | Render notification badge `🔔N` (fallback `[!N]` cho terminal không support emoji) |
| `src/ui/powerbar-publisher.ts` | Append badge cho `pi-crew-active` segment |
| `src/extension/register.ts` | Instantiate NotificationRouter + JsonlSink (gated bởi telemetry); wrap `sendFollowUp`; pass vào RenderScheduler + commands deps |
| `src/extension/registration/commands.ts` | Handle `mailbox-detail` + 3 health actions (Q4); mở overlay; reuse ConfirmOverlay (Q5) |
| `src/extension/team-tool/api.ts` | (no change) — dispatchers reuse existing operations |
| `src/schema/config-schema.ts` | Thêm `notifications` section + `sinkRetentionDays` (Q2) |
| `src/config/{config.ts,defaults.ts}` | Parse + default cho notifications (severityFilter, dedupWindowMs, batchWindowMs, quietHours, sinkRetentionDays) |
| `package.json` | Bump version `0.1.33` → `0.1.34` |

### Docs (chỉ update khi user yêu cầu, theo project rule)
- `docs/architecture.md` — bổ sung mục "Operator Actions", "Notification Router", "Diagnostic Export".

## 5. Risk Assessment — Updated với Q1-Q6

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Overlay hijack stdin của Pi UI | Med | High | Reuse pattern `LiveRunSidebar` (đã hoạt động); test với `pi-ui-compat.ts` shim |
| Keybinding conflict với Pi global hotkeys | Low | Med | Uppercase `A/N/C/P/H/X` (mailbox), `R/K/D` (health) — context-scoped; lowercase Pi defaults không đụng |
| Notification spam khi nhiều run concurrent | Med | Low-Med | Dedup window 30s default; severity filter excludes "info"; quiet-hours wrap (Q3) |
| Quiet-hours cross-day parser bug | Low | Med | Q3=b: 7 unit test cases bao gồm cross-midnight; mock clock pattern |
| MailboxDetailOverlay re-render slow | Low | Low | Reuse signature pattern từ `RunDashboard`; cache lines |
| Race khi ack trong khi snapshot đang refresh | Low | Med | Dispatch awaits then invalidate cache; render scheduler debounce 75ms |
| `sendFollowUp` swap break existing flow | Low | High | Wrap không thay; router default-on chỉ khi `notifications.enabled !== false`; fallback gọi `sendFollowUp` raw nếu router throws |
| Config schema breaking change | Low | High | New section `notifications` purely optional; missing → defaults |
| **(Q1)** Compose preview pane re-render bottleneck (debounce miss) | Low | Low | Debounce 100ms; cache last rendered tokens; tokenizer < 1ms cho 5KB body |
| **(Q1)** Markdown tokenizer edge case (nested code in list) | Med | Low | Reuse pattern parser nếu có; 6 unit test edge cases; preview "best-effort" |
| **(Q2)** Sink disk full / write fail | Low | Low | `appendFileSync` swallow errors qua `logInternalError`; sink failure không crash router |
| **(Q2)** Retention prune deletes file đang được tail | Low | Low | Chỉ prune `.jsonl` cũ hơn cutoff; daily rotation đảm bảo file hôm nay không bị touch |
| **(Q2)** PII trong notification body leak vào sink | Med | Med | Sink reuse secret redactor từ `diagnostic-export.ts` (Q4); router tag PII fields nếu cần |
| **(Q4)** `R` recovery accidentally interrupt healthy run | Low | High | ConfirmOverlay với `dangerLevel: "high"` + default cancel; foreground-only check; clear "tasks marked failed" warning |
| **(Q4)** `K` kill stale workers race với worker self-recovery | Low | Med | Mark dead heartbeats first → emit event → giải phóng claims; worker tự detect token mismatch sẽ exit |
| **(Q4)** Diagnostic export ghi đè artifact dir đang dùng | Low | Med | D14: check existing diag < 1min → ConfirmOverlay overwrite; timestamp suffix unique |
| **(Q4)** Diagnostic secret redaction miss key pattern mới | Med | High | Block list: `*token*`, `*key*`, `*password*`, `*secret*`, `*credential*`, `*auth*`; review qua test fixture với 20 key patterns |
| **(Q5)** ConfirmOverlay default `Y` accidentally confirms destructive | Low | High | Default action = "cancel"; first focus là `[N]`; ESC = cancel; UI hint underlined N |
| **(Q6)** ESC discard confirm fatigue (user complain phải confirm mỗi ESC) | Low | Low | Threshold 50 ký tự (configurable nếu user feedback); short body → discard ngay |
| **(Q6)** Body multi-line Ctrl+Enter not detected on Windows | Med | Low | Test với `pi-ui-compat.ts`; fallback `Alt+Enter` if Ctrl+Enter fails detection |

## 6. Testing Strategy — Updated với Q1-Q6

**Unit-level (Wave 1-3):**
- Mock `handleTeamTool` → assert dispatcher returns đúng `{ok, message}` cho 7 dispatchers.
- Render overlay với fixture snapshot → assert lines layout.
- Heartbeat aggregator: parameterized test với fixture timestamps (6 cases).
- Health pane: 6 cases bao phủ foreground/async/healthy/dead/stale variations (Q4).
- Notification router: mock clock (`globalThis.Date.now` override theo pattern Phase 7); 8 base cases + 4 cross-day parser (Q3).
- Sink: rotation, retention, telemetry-disabled no-op (Q2).
- Diagnostic export: secret redaction với 20-key fixture; JSON schema validate (Q4).
- Confirm overlay: 4 cases verify default-cancel safety (Q5).
- Compose preview: 6 cases markdown render (Q1).

**Integration (Wave 4) — 7 scenarios:**
- `mailbox-action-roundtrip.test.ts`: open dashboard → ack → snapshot invalidate → count giảm.
- `mailbox-ackall-confirm.test.ts` (Q5): Shift+X → ConfirmOverlay → confirm → loop ack 10 messages → all `acknowledged`.
- `notification-dedup.test.ts`: emit 5x cùng `crew.run.failed` trong 30s → `sendFollowUp` mock called once.
- `notification-quiet-hours.test.ts` (Q3): quiet `"22:00-07:00"` mock now=23:30 → 0 toast; mock now=12:00 → 1 toast.
- `notification-sink-rotation.test.ts` (Q2): write 8 ngày fake mtime → oldest deleted on day 8.
- `health-recovery-foreground.test.ts` (Q4): foreground run với 2 dead workers → R action → ConfirmOverlay confirm → `foreground-interrupt` API called → tasks marked failed.
- `health-diagnostic-export.test.ts` (Q4): D action → file written với 0 secrets in JSON; emit lần 2 trong 1min → ConfirmOverlay overwrite.

**Smoke manual (8 scenarios):**
1. Chạy `team run` 1 task foreground → mở `/team-dashboard` → key `3` mailbox → Enter → key `N` nudge → verify `events.jsonl` có `agent.nudged`.
2. Chạy 2 run, đợi xong → verify nhận 1-2 toast (dedup).
3. Set `notifications.quietHours = "00:00-23:59"` → verify 0 toast.
4. **(Q1)** Compose form, gõ markdown body với bold/list/code → key `P` preview → verify render đúng.
5. **(Q5)** ackAll trên run với 5 unread → ConfirmOverlay xuất hiện → N cancel → 0 message acked.
6. **(Q4)** Foreground run với worker stuck > 1min → key `5` health → key `R` → ConfirmOverlay → Y → tasks failed; key `D` → diagnostic file viết.
7. **(Q2)** Disable telemetry → run + emit notification → verify `<crewRoot>/state/notifications/` không tồn tại.
8. **(Q6)** Compose body 100 chars → ESC → ConfirmOverlay xuất hiện → N → vẫn editing.

**Performance budget:**
- Mailbox overlay first render < 50ms với 100 messages.
- Compose preview render < 30ms với 5KB markdown body (Q1).
- Notification router enqueue overhead < 1ms.
- Sink write < 5ms (single append) (Q2).
- Health pane render < 5ms cho 50 tasks.
- Diagnostic export complete < 200ms cho run với 50 tasks + 200 events (Q4).

## 7. Open Questions — RESOLVED (Path X chosen)

| Q | Câu hỏi | Lựa chọn | Implementation reference |
|---|---|---|---|
| **Q1** | Compose form có cần preview render trước khi submit? | **(b) Có preview pane** | 8.1.E `mailbox-compose-preview.ts`, key `P` toggle, render markdown read-only (bold/italic/code/list/heading), debounce 100ms. D15. +0.75d |
| **Q2** | Notification sink default ghi `<crewRoot>/state/notifications.jsonl`? | **(c) Sink khi `telemetry.enabled !== false`** | 8.3.D `notification-sink.ts`, JSONL `<crewRoot>/state/notifications/{YYYY-MM-DD}.jsonl`, rotate `sinkRetentionDays` default 7. D4. +0.5d |
| **Q3** | Quiet-hours cross-day wrap? | **(b) Wrap parser** | 8.3.B `parseHHMMRange` + `isInQuietHours` cross-day logic; 7 unit cases bao gồm `"22:00-07:00"`. D5. +0.25d |
| **Q4** | Health pane recovery action button inline? | **(c) Full action menu R/K/D** | 8.2.D `R` recovery (foreground-only), `K` kill stale workers, `D` diagnostic export với secret redaction; 3 confirm flows. D9, D14. +1.5d |
| **Q5** | Ack/nudge confirm cho destructive? | **(c) Confirm chỉ destructive (ackAll/recovery/diag-overwrite)** | 8.0 `ConfirmOverlay` reusable primitive; 8.1.F ackAll Shift+X with confirm. D12. +0.25d |
| **Q6** | Compose form persist draft khi ESC? | **(a) ESC discard + confirm-if-long** | 8.1.D ESC behavior: body ≤ 50 chars → discard; > 50 → ConfirmOverlay. Defer draft persistence Phase 9. D11. +0.1d |

**Tổng effort delta từ Q1-Q6: ~3.35 dev-day** → bump từ 11-14d → 14-18d.

**Mục tiêu Q1-Q6 đã đạt:** mọi quyết định scope-shaping đã chốt; team có thể start Wave 1 mà không bị blocked clarification giữa chừng.

## 8. Dependencies & Sequencing

```
Phase 7 (DONE) ─────► Phase 8.0 Foundation
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         8.1 Mailbox  8.2 Health  8.3 Notif
              │          │          │
              └──────────┼──────────┘
                         ▼
                    8.4 Wiring
                         │
                         ▼
                    8.5 Tests
```

**Hard prerequisites Phase 7:** ✅ `RunSnapshotCache`, `RenderScheduler`, dashboard panes — đã có.

## 9. Effort Summary — Updated với Q1-Q6

| Wave | Items | Dev-days | Parallelizable |
|---|---|---|---|
| 1 | 8.0 (Foundation + ConfirmOverlay Q5) + 8.3.A (Router) + 8.2.A (Heartbeat) | 2.5 | Yes (3 streams) |
| 2 | 8.1.A → B → C → D (Q6) → E (Q1) → F (Q5) | 5 | No (sequential UX, share overlay state) |
| 3 | 8.2.B + 8.2.C + 8.2.D (Q4 R/K/D) + 8.3.B (Q3) + 8.3.C + 8.3.D (Q2) | 4 | Yes (5 streams) |
| 4 | 8.4 (Wire) + 8.5 (Tests) | 2.75 | No |
| **Total** | **17 sub-phases** | **14-18** | — |

**So với plan gốc:** +3.35 dev-day, +5 sub-phases, +8 file mới, +27 unit case, +4 integration case.

## 10. Acceptance Checklist (Wave 4 exit criteria) — Updated

- [x] Tất cả checkbox 8.0 → 8.5 ở mục 0 (Implementation Status) tick `[x]`.
- [x] `npm test` ≥ **351 unit** (current 299 + 52 mới), ≥ **35 integration** (current 29 + 6 mới), 0 fail. Verified: 351 unit + 44 integration pass.
- [x] `npm run typecheck` clean.
- [x] Manual smoke **8 scenarios** pass (mục 6). Verified via automated smoke suite `test/integration/phase8-smoke.test.ts`.
- [x] Performance budget thỏa: mailbox overlay <50ms, compose preview <30ms, sink write <5ms, diagnostic export <200ms. Verified microbench: mailbox 6.39ms, preview 1.61ms, health 0.29ms, sink 2.12ms, diagnostic 4.83ms.
- [x] No regression: 299 unit + 29 integration cũ vẫn pass.
- [x] Config breaking? **No.** Schema additive (`notifications` section optional).
- [x] Bump `package.json` version `0.1.33` → `0.1.34`.
- [x] Q1-Q6 implementations match decisions table mục 7.
- [x] Secret redaction (Q4): test fixture with recursive key/value redaction pass; audit log avoids known token fixture.

## 11. Out of Scope (defer Phase 9+)

> Phase 9 plan đã được tạo riêng tại [`research-phase9-observability-reliability-plan.md`](./research-phase9-observability-reliability-plan.md).

- **Telemetry/Metrics backbone** (Counter/Gauge/Histogram + correlation ID + OTLP/Prometheus export) → **Phase 9 (Theme B)** per Path X plan.
- **Run reliability** — auto-retry executor + crash recovery + deadletter + heartbeat watcher → **Phase 9 (Theme C)**.
- Cross-run mailbox routing (operator-broadcast) — **Phase 10+**.
- Mailbox threading / reply chains — **Phase 10+**.
- **Compose draft persistence (Q6 b/c options)** — defer Phase 9 nếu user feedback than.
- Multi-host run aggregation — **Phase 10+**.
- Slack/Discord webhook sink (router supports it via custom sink, but no built-in adapter) — **Phase 10+**.
- Markdown preview với images/links rendered (Q1 D15 skip) — **Phase 10+**.

### Path X roadmap summary

| Phase | Theme | Effort | Plan file |
|---|---|---|---|
| 6 | `.crew/` migration + autonomous policy | ~12d | `refactor-tasks-phase6.md` (DONE) |
| 7 | UI Optimization | ~18d | `research-ui-optimization-plan.md` (DONE) |
| **8** | **Operator Experience (Theme A)** | **14-18d** | **THIS FILE — ✅ DONE (verified 351 unit + 44 integration pass, version 0.1.34)** |
| **9** | **Observability + Reliability (B+C)** | **19.5-22.5d** | `research-phase9-observability-reliability-plan.md` (post-review updated 2026-04-29) |
| 10+ | TBD: Perf baseline, distributed | — | Future |

---

## 12. Implementation Kickoff Checklist (Pre-Wave 1)

Trước khi bắt đầu Wave 1, verify:

- [x] Phase 7 đã commit (snapshot cache + render scheduler + 4 panes). Included in `phase-8-operator-experience` release commit.
- [x] `npm test` baseline pass (299 unit + 29 integration). Verified current suite: 351 unit + 44 integration pass.
- [x] `npm run typecheck` clean.
- [x] Q1-Q6 đã chốt (đã làm — table mục 7).
- [x] Branch mới `phase-8-operator-experience` từ main.
- [x] Read once: `src/extension/team-tool/api.ts` (đã có ack-message/send-message/nudge-agent operations — KHÔNG cần modify).
- [x] Read once: `src/ui/run-dashboard.ts:handleInput` để hiểu pattern key dispatch hiện tại.
- [x] Read once: `src/ui/live-run-sidebar.ts` để có template cho overlay implementation.

**Sẵn sàng triển khai Phase 8 Path X.**
