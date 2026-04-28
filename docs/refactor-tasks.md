# pi-crew Refactor & Optimization Backlog

> Tài liệu này liệt kê chi tiết các task tối ưu/cải thiện cho `pi-crew/`, sắp xếp theo thứ tự ưu tiên thực hiện.
> Task #1 (tách `register.ts` & `team-tool.ts`) đã hoàn thành — xem CHANGELOG hoặc `src/extension/team-tool/`, `src/extension/registration/`.

Mỗi task gồm:
- **Vấn đề (Problem)** — bug/inefficiency hiện tại
- **Vị trí (Location)** — file:line
- **Đề xuất (Proposed fix)** — cách sửa
- **Verification** — lệnh test xác nhận
- **Rủi ro (Risk)** — tác động/rollback

---

## Trạng thái hoàn thành

- [x] Task #1 — Tách `register.ts` & `team-tool.ts` (đã hoàn thành)
- [x] Task #2 — Sửa `withRunLock` / `withRunLockSync` race condition + async blocking
- [x] Task #3 — Tối ưu `nextSequence` trong `event-log.ts` (O(n²) → O(1))
- [x] Task #4 — Cache `loadRunManifestById` resolution
- [x] Task #5 — Memoize task-graph maps trong `team-runner` loop
- [x] Task #6 — Cleanup timers trong `child-pi.ts`
- [x] Task #7 — `useProjectState` walk-up tìm git root
- [x] Task #8 — Gom hard-coded constants vào `config/defaults.ts`
- [x] Task #9 — Validate config bằng TypeBox
- [x] Task #10 — Tách `ensureMailbox` khỏi read path
- [x] Task #11 — `injectAdaptivePlanIfReady` chạy ít hơn
- [x] Task #12 — Bỏ `jiti` khỏi runtime dependencies
- [x] Task #13 — `atomicWriteFile` non-blocking variant
- [x] Task #14 — `defaultWorkflowConcurrency` đọc từ workflow frontmatter
- [x] Task #15 — Logging cho silent catches
- [x] Task #16 — Cosmetic & cleanup

## #2 — Sửa `withRunLock` / `withRunLockSync` race condition + async blocking

**Priority:** High — ảnh hưởng tính đúng đắn multi-process.

### Vấn đề
- File: `src/state/locks.ts`
- `withRunLockSync`:
  1. Check `existsSync(filePath)` → nếu stale thì `rmSync` rồi `writeFileSync(flag: "wx")`. Hai process cùng thấy stale có thể chạy `rmSync` đồng thời, một process `wx` thành công, process kia ném lỗi `EEXIST` ngay → caller phải retry thủ công nhưng không có cơ chế retry.
  2. Lock chỉ tồn tại trong scope `fn()` — nếu `fn()` throw, lock được release qua `finally` (đúng), nhưng khoảng thời gian giữa check stale và create file là race window.
- `withRunLock` (async) chỉ wrap `withRunLockSync`:
  ```ts
  export async function withRunLock<T>(manifest, fn, options) {
      return withRunLockSync(manifest, () => fn(), options);
  }
  ```
  ⇒ Lock giữ trong khi `fn()` async chạy, nhưng `withRunLockSync` trả về **Promise object ngay sau khi gọi `fn()`** chứ không đợi Promise resolve → lock release **trước khi** async work hoàn tất.

### Đề xuất

**Phương án A (nhỏ, bug-fix only):**
```ts
export async function withRunLock<T>(manifest: TeamRunManifest, fn: () => Promise<T>, options: RunLockOptions = {}): Promise<T> {
    const filePath = lockPath(manifest);
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await acquireLockWithRetry(filePath, staleMs);
    try {
        return await fn();
    } finally {
        try { fs.rmSync(filePath, { force: true }); } catch {}
    }
}

async function acquireLockWithRetry(filePath: string, staleMs: number): Promise<void> {
    const deadline = Date.now() + staleMs * 2;
    let attempt = 0;
    while (true) {
        try {
            // O_CREAT | O_EXCL | O_WRONLY (atomic)
            const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
            fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
            fs.closeSync(fd);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EEXIST") throw error;
            // Check stale
            try {
                const stat = fs.statSync(filePath);
                if (Date.now() - stat.mtimeMs > staleMs) {
                    fs.rmSync(filePath, { force: true });
                    continue;
                }
            } catch {}
            if (Date.now() > deadline) throw new Error(`Run lock '${filePath}' busy.`);
            await new Promise((resolve) => setTimeout(resolve, Math.min(250, 25 * 2 ** attempt)));
            attempt++;
        }
    }
}
```

**Phương án B (dùng thư viện):** Cài `proper-lockfile` (~13KB, MIT). API: `lockfile.lock(filePath, { stale, retries })`. Production-grade, nhưng thêm dependency.

### Verification
```powershell
npx tsc --noEmit
node --experimental-strip-types --test test/unit/api-locks.test.ts
node --experimental-strip-types --test test/unit/resume-cancel.test.ts test/unit/mailbox-api.test.ts
```

Test mới cần thêm: 2 process đồng thời gọi `withRunLock` cùng manifest → đúng 1 thành công tại một thời điểm.

### Rủi ro
- API giữ nguyên (`withRunLock(manifest, fn, options)`) → backward compat.
- Trên Windows, `O_EXCL` đôi khi flaky với antivirus — vẫn cần retry với backoff.

---

## #3 — Tối ưu `nextSequence` trong `event-log.ts` (O(n²) → O(1))

**Priority:** High — performance trên run dài (10k+ events).

### Vấn đề
- File: `src/state/event-log.ts:46-65`
- Cache hit nhanh, nhưng cache miss = đọc toàn bộ file + `JSON.parse` mỗi line:
  ```ts
  for (const line of fs.readFileSync(eventsPath, "utf-8").split("\n")) {
      const event = JSON.parse(line);
      max = Math.max(max, event.metadata?.seq ?? 0);
  }
  ```
- Mỗi process khác (background async runner, child Pi) ghi event → invalidate cache của process khác → mỗi append ở leader có thể trở thành full scan.
- Kết quả: với 10k events, mỗi append ~5-50ms; tổng cộng O(n²).

### Đề xuất

Lưu seq counter vào file riêng `events.seq`:

```ts
// src/state/event-log.ts
function seqFilePath(eventsPath: string): string {
    return `${eventsPath}.seq`;
}

function nextSequence(eventsPath: string): number {
    const seqPath = seqFilePath(eventsPath);
    let current = 0;
    try {
        current = Number.parseInt(fs.readFileSync(seqPath, "utf-8").trim(), 10);
        if (!Number.isFinite(current) || current < 0) current = 0;
    } catch {
        // First write or corrupted: scan once to recover
        if (fs.existsSync(eventsPath)) {
            for (const line of fs.readFileSync(eventsPath, "utf-8").split("\n")) {
                if (!line.trim()) continue;
                try { current = Math.max(current, (JSON.parse(line) as TeamEvent).metadata?.seq ?? 0); } catch { current++; }
            }
        }
    }
    const next = current + 1;
    try {
        atomicWriteFile(seqPath, String(next));
    } catch {
        // Best effort; sequence will recover on next read
    }
    return next;
}
```

Hoặc tốt hơn: dùng **incremental tail-read** từ cached size offset:

```ts
const sequenceCache = new Map<string, { size: number; mtimeMs: number; seq: number; offset: number }>();

function nextSequence(eventsPath: string): number {
    if (!fs.existsSync(eventsPath)) return 1;
    const stat = fs.statSync(eventsPath);
    const cached = sequenceCache.get(eventsPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.seq + 1;

    let max = cached?.seq ?? 0;
    let startOffset = cached && cached.size < stat.size ? cached.offset : 0;
    if (cached && cached.size > stat.size) { max = 0; startOffset = 0; } // file rotated

    const fd = fs.openSync(eventsPath, "r");
    try {
        const buf = Buffer.alloc(stat.size - startOffset);
        fs.readSync(fd, buf, 0, buf.length, startOffset);
        for (const line of buf.toString("utf-8").split("\n")) {
            if (!line.trim()) continue;
            try { max = Math.max(max, (JSON.parse(line) as TeamEvent).metadata?.seq ?? 0); } catch { max++; }
        }
    } finally {
        fs.closeSync(fd);
    }
    sequenceCache.set(eventsPath, { size: stat.size, mtimeMs: stat.mtimeMs, seq: max, offset: stat.size });
    return max + 1;
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/event-metadata.test.ts test/unit/run-events-artifacts.test.ts test/unit/phase5-observability.test.ts
```

Benchmark mới (optional): append 10k events, đo tổng thời gian — kỳ vọng < 1s thay vì 10-30s.

### Rủi ro
- Phương án "seq file" đơn giản hơn, dễ verify; phải chú ý cleanup (`forget`/`prune` xóa luôn `.seq`).
- Phương án incremental đọc đúng nhưng phức tạp hơn, cần test đặc biệt cho file rotation/truncate.

---

## #4 — Cache `loadRunManifestById` resolution

**Priority:** Medium — UI overhead (powerbar/sidebar 1Hz).

### Vấn đề
- File: `src/state/state-store.ts:104-115`
- Mỗi lần gọi: 2 lần `fs.existsSync` + 2 lần `path.join` + `readFileSync`+`JSON.parse` cho cả manifest và tasks.
- Được gọi từ:
  - `live-run-sidebar.ts` (1Hz timer)
  - `powerbar-publisher.ts` (1Hz)
  - `crew-widget.ts` (1Hz)
  - `subagent-helpers.refreshPersistedSubagentRecord`
  - `team-tool.handleStatus/Cancel/Resume/Events/Artifacts/Summary/Worktrees/Forget/Cleanup/Export/Api`

### Đề xuất

Thêm tầng cache stat-based (giống `nextSequence`):

```ts
// src/state/state-store.ts
interface ManifestCacheEntry {
    manifest: TeamRunManifest;
    tasks: TeamTaskState[];
    manifestMtime: number;
    tasksMtime: number;
}
const manifestCache = new Map<string, ManifestCacheEntry>();

function resolvedStateRoot(cwd: string, runId: string): string | undefined {
    const projectPath = path.join(projectPiRoot(cwd), "teams", "state", "runs", runId);
    if (fs.existsSync(projectPath)) return projectPath;
    const userPath = path.join(userPiRoot(), "extensions", "pi-crew", "runs", "state", "runs", runId);
    return fs.existsSync(userPath) ? userPath : undefined;
}

export function loadRunManifestById(cwd: string, runId: string): { manifest: TeamRunManifest; tasks: TeamTaskState[] } | undefined {
    const stateRoot = resolvedStateRoot(cwd, runId);
    if (!stateRoot) return undefined;
    const manifestPath = path.join(stateRoot, "manifest.json");
    const tasksPath = path.join(stateRoot, "tasks.json");

    let mStat: fs.Stats | undefined;
    let tStat: fs.Stats | undefined;
    try { mStat = fs.statSync(manifestPath); } catch { return undefined; }
    try { tStat = fs.statSync(tasksPath); } catch {}

    const cacheKey = `${stateRoot}`;
    const cached = manifestCache.get(cacheKey);
    if (cached && cached.manifestMtime === mStat.mtimeMs && cached.tasksMtime === (tStat?.mtimeMs ?? 0)) {
        return { manifest: cached.manifest, tasks: cached.tasks };
    }

    const manifest = readJsonFile<TeamRunManifest>(manifestPath);
    if (!manifest) return undefined;
    const tasks = readJsonFile<TeamTaskState[]>(tasksPath) ?? [];
    manifestCache.set(cacheKey, { manifest, tasks, manifestMtime: mStat.mtimeMs, tasksMtime: tStat?.mtimeMs ?? 0 });
    return { manifest, tasks };
}
```

Quan trọng: `saveRunManifest` / `saveRunTasks` phải invalidate cache:
```ts
export function saveRunManifest(manifest: TeamRunManifest): void {
    atomicWriteJson(path.join(manifest.stateRoot, "manifest.json"), manifest);
    manifestCache.delete(manifest.stateRoot); // OR: refresh entry
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/state-store.test.ts test/unit/team-run.test.ts test/unit/resume-cancel.test.ts test/unit/run-dashboard.test.ts test/unit/live-run-sidebar.test.ts
```

### Rủi ro
- Cross-process: process A cache → process B ghi → process A vẫn dùng cache cũ trong tầng mtime check. mtime resolution thường ≥1ms nên acceptable.
- **Memory leak**: cache không bound. Thêm LRU max 50 entries.

---

## #5 — Memoize task-graph maps trong `team-runner` loop

**Priority:** Medium — CPU/GC overhead trên run lớn (>100 tasks).

### Vấn đề
- File: `src/runtime/task-graph-scheduler.ts`
- Mỗi function (`getReadyTasks`, `markTaskRunning`, `markTaskDone`, `cancelTaskSubtree`, `failTaskAndBlockChildren`, `taskGraphSnapshot`) đều build lại 3 maps:
  - `completedStepIds(tasks)` — Set
  - `taskById(tasks)` — Map
  - `stepIdToTaskId(tasks)` — Map
- Trong `executeTeamRun` loop, `refreshTaskGraphQueues` được gọi nhiều lần per iteration:
  - `team-runner.ts:240` (getReadyTasks)
  - `team-runner.ts:228` (taskGraphSnapshot)
  - Mỗi snapshot/refresh = 3 maps × O(n)

### Đề xuất

Build maps 1 lần ở caller, truyền xuống:

```ts
// task-graph-scheduler.ts
export interface TaskGraphIndex {
    doneSteps: Set<string>;
    byId: Map<string, TeamTaskState>;
    byStepId: Map<string, string>;
}

export function buildTaskGraphIndex(tasks: TeamTaskState[]): TaskGraphIndex {
    return {
        doneSteps: completedStepIds(tasks),
        byId: taskById(tasks),
        byStepId: stepIdToTaskId(tasks),
    };
}

export function refreshTaskGraphQueues(tasks: TeamTaskState[], index?: TaskGraphIndex): TeamTaskState[] {
    const idx = index ?? buildTaskGraphIndex(tasks);
    return tasks.map((task) => {
        // ... use idx.doneSteps, idx.byId, idx.byStepId
    });
}
```

Trong `team-runner.executeTeamRun`:
```ts
while (tasks.some((task) => task.status === "queued")) {
    const idx = buildTaskGraphIndex(tasks);
    const snapshot = taskGraphSnapshot(tasks, idx);
    const readyBatch = getReadyTasks(tasks, concurrency.selectedCount, idx);
    // ...
    tasks = mergeTaskUpdates(tasks, results);
    // (rebuild index after mutations)
}
```

Hoặc: memoize bằng WeakMap với task array reference làm key:
```ts
const indexCache = new WeakMap<TeamTaskState[], TaskGraphIndex>();
function ensureIndex(tasks: TeamTaskState[]): TaskGraphIndex {
    let idx = indexCache.get(tasks);
    if (!idx) { idx = buildTaskGraphIndex(tasks); indexCache.set(tasks, idx); }
    return idx;
}
```
(Pattern này hoạt động vì `tasks.map()` luôn trả mảng mới → cache key đổi tự động khi mutation.)

### Verification
```powershell
node --experimental-strip-types --test test/unit/task-graph-scheduler.test.ts test/unit/phase3-runtime.test.ts test/unit/phase4-runtime.test.ts test/unit/implementation-fanout.test.ts
```

### Rủi ro
- Refactor lan rộng (5-6 callsite) nhưng giữ API cũ với optional param `index?` → backward compat.

---

## #6 — Cleanup timers trong `child-pi.ts`

**Priority:** Medium — leak nhẹ nhưng dễ tích lũy.

### Vấn đề
- File: `src/runtime/child-pi.ts:31-39`
- `killProcessTree` schedule SIGKILL sau `HARD_KILL_MS`:
  ```ts
  setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { ... } }, HARD_KILL_MS).unref?.();
  ```
- Không clear khi child exit bình thường giữa SIGTERM-SIGKILL window. Trên hệ thống chạy nhiều run, hàng trăm timer pending mỗi giờ.

### Đề xuất

Track timer và clear trong `child.on('exit')`:

```ts
function killProcessTree(pid: number | undefined, child?: ChildProcess): void {
    if (!pid || !Number.isInteger(pid) || pid <= 0) return;
    try {
        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
            return;
        }
        try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); }
        const killTimer = setTimeout(() => {
            try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
        }, HARD_KILL_MS);
        killTimer.unref?.();
        child?.once("exit", () => clearTimeout(killTimer));
    } catch {
        // Ignore shutdown races.
    }
}
```

Caller đã có `child` reference (từ `activeChildProcesses`), nên truyền xuống.

### Verification
```powershell
node --experimental-strip-types --test test/unit/pi-spawn.test.ts test/unit/mock-child-run.test.ts
```

Manual check (Linux/Mac): chạy `node -e "process.exit()"` trong test, đảm bảo không có timer leak qua `process._getActiveHandles()`.

### Rủi ro
- Thấp: chỉ thêm clearTimeout khi exit. Behavior không đổi ở fast-exit case (timer vẫn fire nếu child chưa exit).

---

## #7 — `useProjectState` walk-up tìm git root

**Priority:** Medium — DX bug trong monorepo.

### Vấn đề
- File: `src/state/state-store.ts:21-23`
  ```ts
  function useProjectState(cwd: string): boolean {
      return fs.existsSync(path.join(cwd, ".pi")) || fs.existsSync(path.join(cwd, ".git"));
  }
  ```
- Nếu user `cd` vào subfolder của repo (ví dụ `pi-crew/src/`), không tìm thấy `.git` ngay → fallback `~/.pi/agent/extensions/pi-crew/runs/...` → state không phải project-local nữa.
- Tương tự: `projectPiRoot(cwd) = path.join(cwd, ".pi")` → `.pi/` được tạo trong subfolder, không phải repo root.

### Đề xuất

```ts
// src/utils/paths.ts
export function findRepoRoot(cwd: string): string | undefined {
    let current = path.resolve(cwd);
    const root = path.parse(current).root;
    while (current !== root) {
        if (fs.existsSync(path.join(current, ".git")) || fs.existsSync(path.join(current, ".pi"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return undefined;
}

export function projectPiRoot(cwd: string): string {
    return path.join(findRepoRoot(cwd) ?? cwd, ".pi");
}
```

Và `useProjectState`:
```ts
function useProjectState(cwd: string): boolean {
    return findRepoRoot(cwd) !== undefined;
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/state-store.test.ts test/unit/team-run.test.ts test/unit/discovery.test.ts test/unit/project-init.test.ts
```

Test mới: tạo fixture `tmp/repo/.git/`, chạy `loadConfig(tmp/repo/sub/folder)` → expect path resolve về `tmp/repo/.pi`.

### Rủi ro
- **Medium:** Có thể đổi semantics nếu user cố ý dùng subfolder làm pi-crew root. Cần check `discovery.test.ts` và `project-init.test.ts` không assume `cwd === root`.
- Workaround: thêm config flag `pi-crew.useGitRoot: false` để giữ behavior cũ.

---

## #8 — Gom hard-coded constants vào `config/defaults.ts`

**Priority:** Low — DX/maintainability.

### Vấn đề
Các magic numbers rải rác:
- `child-pi.ts`: `POST_EXIT_STDIO_GUARD_MS=3000`, `FINAL_DRAIN_MS=5000`, `HARD_KILL_MS=3000`, `MAX_CAPTURE_BYTES=256*1024`, `MAX_ASSISTANT_TEXT_CHARS=8192`, ...
- `concurrency.ts`: `defaultWorkflowConcurrency` switch-case.
- `event-log.ts`: `TERMINAL_EVENT_TYPES` set.
- `state-store.ts`: paths.
- `locks.ts`: `DEFAULT_STALE_MS=30_000`.

### Đề xuất

Tạo `src/config/defaults.ts`:
```ts
export const CrewDefaults = {
    childPi: {
        postExitStdioGuardMs: 3000,
        finalDrainMs: 5000,
        hardKillMs: 3000,
        maxCaptureBytes: 256 * 1024,
        maxAssistantTextChars: 8192,
        maxToolResultChars: 1024,
        maxToolInputChars: 2048,
        maxCompactContentChars: 4096,
    },
    locks: {
        defaultStaleMs: 30_000,
    },
    concurrency: {
        workflows: { "parallel-research": 4, research: 2, implementation: 2, review: 2, default: 2 } as Record<string, number>,
        fallback: 1,
    },
    ui: {
        widgetRefreshMs: 1000,
        sidebarRefreshMs: 1000,
    },
} as const;
```

Cập nhật từng file thay vì hard-code. Cho phép override qua `loadConfig(cwd).config`:
```ts
export function effectiveLimits(config: PiTeamsConfig): typeof CrewDefaults & { /* overrides */ } {
    return {
        ...CrewDefaults,
        childPi: { ...CrewDefaults.childPi, ...(config.runtime?.childPi ?? {}) },
    };
}
```

### Verification
```powershell
npx tsc --noEmit
node --experimental-strip-types --test  # full suite
```

### Rủi ro
- Thấp: chỉ refactor constants. Test phải pass không đổi.

---

## #9 — Validate config bằng TypeBox

**Priority:** Low — chuẩn hóa, bắt config invalid sớm.

### Vấn đề
- File: `src/extension/team-tool/config-patch.ts`
- `configPatchFromConfig` validate manual: ~40 dòng `typeof x === "number" && Number.isInteger(x) && x > 0 ? x : undefined`.
- TypeBox đã có cho tool params (`team-tool-schema.ts`), nhưng config schema được load từ `loadConfig` không qua TypeBox — chỉ JSON parse.

### Đề xuất

Thêm `src/schema/config-schema.ts`:
```ts
import { Type, type Static } from "typebox";

export const PiTeamsLimitsSchema = Type.Object({
    maxConcurrentWorkers: Type.Optional(Type.Integer({ minimum: 1 })),
    maxTaskDepth: Type.Optional(Type.Integer({ minimum: 1 })),
    // ...
});

export const PiTeamsRuntimeSchema = Type.Object({
    mode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("scaffold"), Type.Literal("child-process"), Type.Literal("live-session")])),
    // ...
});

export const PiTeamsConfigSchema = Type.Object({
    asyncByDefault: Type.Optional(Type.Boolean()),
    executeWorkers: Type.Optional(Type.Boolean()),
    limits: Type.Optional(PiTeamsLimitsSchema),
    runtime: Type.Optional(PiTeamsRuntimeSchema),
    // ...
});

export type PiTeamsConfig = Static<typeof PiTeamsConfigSchema>;
```

Trong `config.ts`:
```ts
import { Value } from "typebox/value";
import { PiTeamsConfigSchema } from "../schema/config-schema.ts";

export function loadConfig(cwd: string): { config: PiTeamsConfig; path: string; error?: string } {
    const raw = readJsonFile(...);
    const errors = [...Value.Errors(PiTeamsConfigSchema, raw)];
    if (errors.length) {
        return { config: defaultConfig(), path, error: errors.map(e => `${e.path}: ${e.message}`).join("; ") };
    }
    return { config: Value.Cast(PiTeamsConfigSchema, raw), path };
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/config.test.ts test/unit/config-update.test.ts test/unit/project-config.test.ts
```

### Rủi ro
- Medium: thay đổi config validation → invalid config (đang silently bỏ qua) sẽ thành error → cần backward compat (downgrade error → warning hoặc dùng `Value.Cast` để cast best-effort).

---

## #10 — Tách `ensureMailbox` khỏi read path

**Priority:** Low — side effect không cần thiết ở read.

### Vấn đề
- File: `src/state/mailbox.ts:97-103`
- `readMailbox()` luôn gọi `ensureMailbox()` → `mkdirSync` + 4× `writeFileSync` empty + 1× `writeFileSync` delivery.json nếu thiếu.
- Read path không nên có side effects.

### Đề xuất
```ts
function safeReadMailboxFile(filePath: string, direction: MailboxDirection): MailboxMessage[] {
    if (!fs.existsSync(filePath)) return [];
    return readMailboxFile(filePath, direction);
}

export function readMailbox(manifest: TeamRunManifest, direction?: MailboxDirection, taskId?: string): MailboxMessage[] {
    // No ensureMailbox here
    const directions = direction ? [direction] : ["inbox", "outbox"] as const;
    return directions.flatMap((item) => safeReadMailboxFile(mailboxPath(manifest, item, taskId), item))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function appendMailboxMessage(...) {
    ensureMailbox(manifest, message.taskId);  // Only here
    // ...
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/mailbox-api.test.ts test/unit/mailbox-validation.test.ts
```

### Rủi ro
- Thấp: append vẫn ensure dir → cấu trúc mailbox luôn được tạo khi cần.

---

## #11 — `injectAdaptivePlanIfReady` chạy ít hơn

**Priority:** Low-Medium — performance + log noise.

### Vấn đề
- File: `src/runtime/team-runner.ts`
- `injectAdaptivePlanIfReady` được gọi 3 lần per scheduler iteration:
  1. Initial (line ~244)
  2. Mỗi vòng while (line ~268)
  3. Sau mỗi batch (line ~308)
- Mỗi lần đọc `assess` artifact + parse JSON nếu chưa inject. Đã có guard "tasks.some(adaptive-)" nhưng vẫn execute regex/IO.

### Đề xuất

Track flag trong manifest hoặc local state:
```ts
let adaptivePlanInjected = tasks.some((task) => task.stepId?.startsWith("adaptive-"));
let adaptivePlanFailed = false;

// Replace 3 invocations with:
function maybeInjectAdaptive() {
    if (adaptivePlanInjected || adaptivePlanFailed) return;
    const r = injectAdaptivePlanIfReady({ manifest, tasks, workflow, team: input.team });
    if (r.missingPlan) { adaptivePlanFailed = true; /* mark blocked */ }
    if (r.injected) { adaptivePlanInjected = true; tasks = r.tasks; workflow = r.workflow; }
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/adaptive-implementation.test.ts test/unit/implementation-fanout.test.ts
```

### Rủi ro
- Thấp: chỉ thay đổi điều kiện trigger, không thay đổi logic inject.

---

## #12 — Bỏ `jiti` khỏi runtime dependencies

**Priority:** Low — install size.

### Vấn đề
- `package.json` declare `"jiti": "^2.6.1"` trong `dependencies`.
- Grep trong source: không có `import.*jiti` nào trong `src/`.

### Đề xuất

```powershell
# Verify nothing imports jiti
Select-String -Path "D:\my\my_project\pi-crew\src\*","D:\my\my_project\pi-crew\index.ts" -Pattern "jiti" -Recurse
```

Nếu không có hit → remove khỏi `dependencies`:
```json
"dependencies": {
    "typebox": "^1.1.24"
}
```

### Verification
```powershell
npm install
npx tsc --noEmit
npm test
npm pack --dry-run
```

### Rủi ro
- Thấp. Nếu dynamic require thì sẽ fail rõ ràng.

---

## #13 — `atomicWriteFile` non-blocking variant

**Priority:** Low — chỉ matter trên hot path.

### Vấn đề
- File: `src/state/atomic-write.ts:5-9`
- `sleepSync` dùng `Atomics.wait` block thread chính:
  ```ts
  function sleepSync(ms: number): void {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
  ```
- `__test__renameWithRetry` retry up to 20 lần với backoff → có thể block 5+ giây trên main thread (Windows EBUSY/EPERM).

### Đề xuất

Thêm async variant cho hot path (saveRunTasks/saveRunManifest trong loop):
```ts
export async function atomicWriteFileAsync(filePath: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
        await fs.promises.writeFile(tempPath, content, "utf-8");
        await renameWithRetryAsync(tempPath, filePath);
    } catch (error) {
        try { await fs.promises.rm(tempPath, { force: true }); } catch {}
        throw error;
    }
}

async function renameWithRetryAsync(tempPath: string, filePath: string, retries = 20): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try { await fs.promises.rename(tempPath, filePath); return; }
        catch (error) {
            if (!isRetryableRenameError(error) || attempt === retries) throw error;
            await new Promise((r) => setTimeout(r, Math.min(250, 10 * 2 ** attempt)));
        }
    }
}
```

Dùng trong `saveRunTasks`/`saveRunManifest` (gọi từ async context):
```ts
export async function saveRunManifestAsync(manifest: TeamRunManifest): Promise<void> {
    await atomicWriteFileAsync(path.join(manifest.stateRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/atomic-write.test.ts test/unit/state-store.test.ts
```

### Rủi ro
- Medium: phải convert call chain sang async → nhiều file thay đổi. Có thể chỉ apply cho 1-2 hot path để tránh ripple.

---

## #14 — `defaultWorkflowConcurrency` đọc từ workflow frontmatter

**Priority:** Low — DX.

### Vấn đề
- File: `src/runtime/concurrency.ts:18-23`
  ```ts
  export function defaultWorkflowConcurrency(workflowName: string): number {
      if (workflowName === "parallel-research") return 4;
      if (workflowName === "research") return 2;
      // ...
  }
  ```
- User custom workflow không thể set default concurrency mà phải pass `team.maxConcurrency`.

### Đề xuất

`WorkflowConfig` đã có frontmatter loader. Thêm field:
```ts
// src/workflows/workflow-config.ts
export interface WorkflowConfig {
    // ...
    maxConcurrency?: number;
}
```

Cập nhật `resolveBatchConcurrency`:
```ts
export interface ResolveBatchConcurrencyInput {
    workflowName: string;
    workflowMaxConcurrency?: number;  // NEW
    teamMaxConcurrency?: number;
    limitMaxConcurrentWorkers?: number;
    readyCount: number;
    // ...
}

const requested = limitMax ?? teamMax ?? workflowMax ?? defaultByName ?? 1;
```

Trong `team-runner.ts:executeTeamRun`:
```ts
const concurrency = resolveBatchConcurrency({
    workflowName: workflow.name,
    workflowMaxConcurrency: workflow.maxConcurrency,  // pass through
    // ...
});
```

### Verification
```powershell
node --experimental-strip-types --test test/unit/concurrency.test.ts test/unit/parallel-research-dynamic.test.ts test/unit/workflow-validation.test.ts
```

### Rủi ro
- Thấp: thêm optional field, backward compat.

---

## #15 — Logging cho silent catches

**Priority:** Low — observability.

### Vấn đề

Nhiều `try { ... } catch {}` nuốt lỗi:
- `child-pi.ts`: `try { this.input.onJsonEvent?.(event); } catch {}` (line ~165)
- `state-store.ts`: lock cleanup `catch {}`
- `event-log.ts`: cache update `catch {}` (line ~93)
- `team-tool.ts:handleCancel`: `try { saveCrewAgents(...); } catch {}`
- `team-tool.ts:handleCancel`: `try { writeForegroundInterruptRequest(...); } catch {}`

### Đề xuất

Thêm helper `logInternalError`:
```ts
// src/utils/log.ts
export function logInternalError(scope: string, error: unknown, eventsPath?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.PI_TEAMS_DEBUG) {
        console.error(`[pi-crew:${scope}] ${message}`);
    }
    if (eventsPath) {
        try { appendEvent(eventsPath, { type: "internal.error", runId: "", message: `${scope}: ${message}` }); } catch {}
    }
}
```

Thay `catch {}` bằng `catch (e) { logInternalError("...", e); }` ở các điểm critical.

### Verification
```powershell
$env:PI_TEAMS_DEBUG = "1"
node --experimental-strip-types --test test/unit/runtime-hardening.test.ts
```

### Rủi ro
- Thấp: chỉ thêm observability, không thay đổi behavior khi `PI_TEAMS_DEBUG` chưa set.

---

## #16 — Cosmetic & cleanup

### 16a. `tsconfig.json` duplicate include

```json
"include": [
    "*.ts",
    "src/**/*.ts",
    "src/**/*.ts"  // <-- duplicate
]
```

Sửa thành:
```json
"include": [
    "*.ts",
    "src/**/*.ts",
    "test/**/*.ts"
]
```

### 16b. Test folder structure

90 unit tests không phân loại. Đề xuất:
```
test/
  unit/         # pure logic (no fs, no spawn)
  integration/  # spawn child Pi, tạo runs
  fixtures/
```

Cập nhật `package.json`:
```json
"test:unit": "node --experimental-strip-types --test test/unit/*.test.ts",
"test:integration": "node --experimental-strip-types --test test/integration/*.test.ts",
"test": "npm run test:unit && npm run test:integration"
```

Move các file `phase[N]-*.test.ts`, `worktree-run.test.ts`, `mock-child-*.test.ts` sang `integration/`.

### 16c. Subagent stuck-blocked notification

File: `src/runtime/subagent-manager.ts`
- `SubagentManager` callback chỉ trigger khi `completed/failed/cancelled/error`. Status `blocked` (run-level) không trigger.
- Đề xuất: khi `record.runId` linked manifest có status `blocked`, tự động gọi callback.

### Verification
```powershell
npx tsc --noEmit
npm test
```

### Rủi ro
- Thấp.

---

## Thứ tự thực hiện đề xuất

1. **#2** — Lock fix (correctness, multi-process)
2. **#3** — Sequence O(n²) → O(1) (performance)
3. **#4** — Cache loadRunManifestById (UI 1Hz overhead)
4. **#6** — Cleanup child-pi timers (memory leak)
5. **#7** — Walk-up git root (DX bug)
6. **#5** — Memoize task-graph maps (CPU)
7. **#11** — Adaptive plan trigger optimization
8. **#10** — ensureMailbox khỏi read path
9. **#8** — Gom constants
10. **#13** — Async atomic write
11. **#14** — Workflow.maxConcurrency
12. **#9** — TypeBox validate config
13. **#12** — Drop jiti
14. **#15** — Internal error logging
15. **#16** — Cosmetic

---

## Quy ước test cho mỗi task

Theo workflow `~/.factory/AGENTS.md` mục 11:

```powershell
# Sau mỗi thay đổi:
Set-Location D:\my\my_project\pi-crew
npx tsc --noEmit                                    # Type check
node --experimental-strip-types --test test/unit/<related>.test.ts   # Targeted tests
npm test                                            # Full suite (nếu thay đổi module core)
```

PR template (tham khảo `~/.factory/AGENTS.md` mục 10):
```
Summary: <task #N: short description>
Plan: ...
Files & Rationale: ...
Tests: ...
Verification:
- npx tsc --noEmit → Passed
- node --experimental-strip-types --test ... → N pass
Risks & Rollback: ...
```

---

## Phase 2 — Follow-up Tasks (sau review #2–#16)

> Phát hiện trong review ngày 28/04/2026 sau khi các task #2–#16 đã hoàn thành. Đây là các vấn đề lộ ra do fix tsconfig (#15) và một số chỗ chưa hoàn thiện.

### Trạng thái Phase 2

- [x] Task #17 — Fix 71 TS errors trong test files (CRITICAL)
- [x] Task #18 — LRU bound cho `manifestCache` (MEDIUM)
- [x] Task #19 — Cross-process cache staleness check (MEDIUM)
- [x] Task #20 — Tách `ensureMailbox` (LOW)
- [x] Task #21 — Giảm circular import giữa `team-tool.ts` ↔ `tool-result.ts` (đã fix trong review)
- [x] Task #22 — Codemod `TeamContext` import (LOW)
- [x] Task #23 — Subagent stuck-blocked notification (LOW)
- [x] Task #24 — TypeBox config validation warnings (MEDIUM)
- [x] Task #25 — `atomicWriteFileAsync` idempotent retry (LOW)

### Thứ tự thực hiện đề xuất

1. **#17** ✅ (CRITICAL — chặn CI) → hoàn thành
2. **#18** + **#19** (MEDIUM — cùng file `state-store.ts`, gộp 1 PR)
3. **#24** (MEDIUM — UX cải thiện rõ ràng)
4. **#20** + **#22** (LOW — refactor cosmetic)
5. **#23** (LOW — feature mới)
6. **#25** (LOW — edge case hiếm)

---

### Task #17 — Fix 71 TypeScript errors trong test files (CRITICAL)

**Vấn đề:**
Sau khi `tsconfig.json` được sửa để include `test/**/*.ts` (#15), 71 lỗi type pre-existing lộ ra. `src/` không có lỗi nào — toàn bộ ở `test/`. Tests vẫn chạy pass nhờ `node --experimental-strip-types` xoá type ở runtime, nhưng `npm run typecheck` (CI) sẽ fail.

**Nguyên nhân:**
`AgentToolResult.content` có kiểu `(TextContent | ImageContent)[]`. Test cũ dùng `result.content[0]?.text ?? ""` không hợp lệ vì `ImageContent` không có field `text`. Trước đây tests không bị typecheck nên không phát hiện.

**Vị trí:** ~32 file trong `test/unit/` và `test/integration/` (số trong ngoặc = số lỗi):
```
test/integration/phase5-observability.test.ts (6)
test/integration/phase6-control.test.ts       (2)
test/integration/worktree-run.test.ts         (2)
test/unit/agent-runtime-files.test.ts         (5)
test/unit/api-claim.test.ts                   (1)
test/unit/api-locks.test.ts                   (1)
test/unit/async-stale.test.ts                 (2)
test/unit/autonomy-config.test.ts             (3)
test/unit/config-action.test.ts               (1)
test/unit/crew-gap-lessons.test.ts            (4)
test/unit/cross-extension-rpc.test.ts         (1)
test/unit/doctor-smoke.test.ts                (1)
test/unit/doctor-validation.test.ts           (4)
test/unit/foreground-nonblocking.test.ts      (1)
test/unit/help.test.ts                        (1)
test/unit/import-list.test.ts                 (1)
test/unit/lazy-agent-materialization.test.ts  (1)
test/unit/live-agent-control.test.ts          (2)
test/unit/live-control-realtime.test.ts       (1)
test/unit/live-session-context.test.ts        (3)
test/unit/live-session-runtime.test.ts        (4)
test/unit/mailbox-api.test.ts                 (4)
test/unit/mailbox-validation.test.ts          (1)
test/unit/management-references.test.ts       (1)
test/unit/project-init.test.ts                (1)
test/unit/run-events-artifacts.test.ts        (4)
test/unit/runtime-hardening.test.ts           (2)
test/unit/subagent-manager.test.ts            (5)
test/unit/summary.test.ts                     (2)
test/unit/team-recommendation.test.ts         (1)
test/unit/team-run.test.ts                    (2)
test/unit/validate-resources.test.ts          (1)
```

**Đề xuất fix:**

**Bước 1 — Tạo helper** trong `test/fixtures/tool-result-helpers.ts`:
```ts
export function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
	return result.content
		?.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n") ?? "";
}

export function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
	const first = result.content?.find((item) => item.type === "text" && typeof item.text === "string");
	return first?.text ?? "";
}
```

**Bước 2 — Codemod** thay `result.content[0]?.text ?? ""` → `firstText(result)`:
```powershell
Get-ChildItem D:\my\my_project\pi-crew\test -Recurse -Filter *.test.ts | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $new = $content -replace '(\w+)\.content\[0\]\?\.text \?\? ""', 'firstText($1)'
    if ($new -ne $content) {
        Set-Content $_.FullName $new -NoNewline
    }
}
```
Sau đó thêm `import { firstText } from "../fixtures/tool-result-helpers.ts";` vào mỗi file đã sửa.

**Bước 3 — Sửa riêng** 5 lỗi trong `test/unit/subagent-manager.test.ts` (mock `SpawnRunner` trả `status: string`):
```ts
// Cũ
const runner = async () => ({ content: [...], details: { action: "x", status: "ok" } });
// Mới
const runner: SpawnRunner = async () => ({ content: [...], details: { action: "x", status: "ok" as const } });
```

**Bước 4 — Sửa** 2 lỗi `cross-extension-rpc.test.ts(37)` & `live-control-realtime.test.ts(18)` — `setTimeout(...)` trả `number` không match `() => void | Promise<void>`. Bọc:
```ts
// Cũ
setTimeout(() => doSomething(), 100);
// Mới
() => { setTimeout(() => doSomething(), 100); }
```

**Bước 5 — Sửa** `test/unit/live-session-context.test.ts(27)`: mock object thiếu các field bắt buộc của `TeamContext`. Thêm `as TeamContext` cast hoặc bổ sung field.

**Verification:**
```bash
npx tsc --noEmit                                    # → 0 errors
npm test                                            # → all pass
npm run ci                                          # → typecheck + test + pack OK
```

**Risk:** Thấp — thuần test code, không ảnh hưởng runtime. Chạy `git diff test/` review trước khi commit để chắc codemod không thay nhầm.

---

### Task #18 — LRU bound cho manifestCache (MEDIUM)

**Vấn đề:**
`manifestCache` trong `src/state/state-store.ts:29` là `Map<string, ManifestCacheEntry>` không có giới hạn. Trong long-running session với nhiều run (status query liên tục), Map có thể grow vô hạn → memory leak.

**Vị trí:** `src/state/state-store.ts:29, 206`

**Đề xuất fix:**
```ts
// config/defaults.ts
export const DEFAULT_CACHE = {
	manifestMaxEntries: 64,
};

// state-store.ts
import { DEFAULT_CACHE } from "../config/defaults.ts";

const manifestCache = new Map<string, ManifestCacheEntry>();

function setManifestCache(stateRoot: string, entry: ManifestCacheEntry): void {
	if (manifestCache.has(stateRoot)) manifestCache.delete(stateRoot); // refresh recency
	manifestCache.set(stateRoot, entry);
	while (manifestCache.size > DEFAULT_CACHE.manifestMaxEntries) {
		const oldest = manifestCache.keys().next().value;
		if (!oldest) break;
		manifestCache.delete(oldest);
	}
}

// Trong loadRunManifestById, đổi:
// manifestCache.set(stateRoot, { ... });
// thành:
// setManifestCache(stateRoot, { ... });
```

**Verification:**
```bash
node --experimental-strip-types --test test/unit/state-store.test.ts
# Thêm test mới: load 100 run khác nhau, verify manifestCache.size <= 64
```

**Risk:** Thấp — chỉ ảnh hưởng cache, không ảnh hưởng đúng đắn vì mtime invalidation vẫn đảm bảo data fresh.

---

### Task #19 — Cross-process cache staleness check (MEDIUM)

**Vấn đề:**
`manifestCache` invalidate dựa trên `manifestStat.mtimeMs`. Trên Windows, mtime granularity ~1ms. Nếu process A ghi manifest tại t=0ms và process B đọc cùng lúc với cache cũ tại t=1ms, mtime có thể trùng → cache stale.

**Vị trí:** `src/state/state-store.ts:175-208` (`loadRunManifestById`)

**Đề xuất fix:**
Kết hợp mtime + size (cheap):
```ts
interface ManifestCacheEntry {
	manifest: TeamRunManifest;
	tasks: TeamTaskState[];
	manifestMtimeMs: number;
	manifestSize: number;        // <-- thêm
	tasksMtimeMs: number;
	tasksSize: number;           // <-- thêm
}

// Validate
if (cached
    && cached.manifestMtimeMs === manifestStat.mtimeMs
    && cached.manifestSize === manifestStat.size
    && cached.tasksMtimeMs === tasksMtimeMs
    && cached.tasksSize === (tasksStat?.size ?? 0)) {
	return { manifest: cached.manifest, tasks: cached.tasks };
}

// Khi cache:
manifestCache.set(stateRoot, {
	manifest, tasks,
	manifestMtimeMs: manifestStat.mtimeMs,
	manifestSize: manifestStat.size,
	tasksMtimeMs,
	tasksSize: tasksStat?.size ?? 0,
});
```

**Verification:**
```bash
node --experimental-strip-types --test test/unit/state-store.test.ts
# Test mới: write manifest 2 lần liên tiếp với content khác nhau cùng mtime giả định, verify load lần 2 không trả cached
```

**Risk:** Thấp — chỉ thắt chặt validation, không loại trừ cache hit hợp lệ.

---

### Task #20 — Tách ensureMailbox thành 2 hàm rõ ràng (LOW)

**Vấn đề:**
`ensureMailbox(manifest, taskId?)` trong `src/state/mailbox.ts:54-62` xử lý cả run-level và task-level. Dòng 60 gọi `mkdirSync(mailboxDir(manifest), ...)` lặp lại vì task path đã chứa run path. Code khó đọc, dễ regress khi thêm scope mới.

**Vị trí:** `src/state/mailbox.ts:54-62`

**Đề xuất fix:**
```ts
function ensureRunMailbox(manifest: TeamRunManifest): void {
	fs.mkdirSync(mailboxDir(manifest), { recursive: true });
	for (const direction of ["inbox", "outbox"] as const) {
		const filePath = mailboxPath(manifest, direction);
		if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf-8");
	}
	const delivery = deliveryPath(manifest);
	if (!fs.existsSync(delivery)) {
		fs.writeFileSync(delivery, `${JSON.stringify({ messages: {}, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
	}
}

function ensureTaskMailbox(manifest: TeamRunManifest, taskId: string): void {
	ensureRunMailbox(manifest); // task-level cần delivery.json ở run-level
	fs.mkdirSync(taskMailboxDir(manifest, taskId), { recursive: true });
	for (const direction of ["inbox", "outbox"] as const) {
		const filePath = mailboxPath(manifest, direction, taskId);
		if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf-8");
	}
}

// Update tất cả call sites:
//   ensureMailbox(manifest)             → ensureRunMailbox(manifest)
//   ensureMailbox(manifest, taskId)     → ensureTaskMailbox(manifest, taskId)
```

**Verification:**
```bash
node --experimental-strip-types --test test/unit/mailbox-api.test.ts test/unit/mailbox-validation.test.ts
```

**Risk:** Thấp — refactor thuần, behavior không đổi.

---

### Task #21 — ✅ ĐÃ HOÀN THÀNH trong review

Giảm circular import giữa `team-tool.ts` ↔ `tool-result.ts`:
- `src/extension/tool-result.ts` — đổi `import type { TeamToolDetails } from "./team-tool.ts"` → `from "./team-tool-types.ts"`
- `src/extension/management.ts` — tương tự

Cần verify thêm chưa có chỗ nào còn import xấu:
```powershell
Select-String -Path src\extension\*.ts,src\extension\**\*.ts -Pattern 'TeamToolDetails.*from "(\.\.?/)*team-tool\.ts"'
```
Nếu còn match → đổi sang `team-tool-types.ts`.

---

### Task #22 — Codemod TeamContext import rời khỏi team-tool.ts (LOW)

**Vấn đề:**
`team-tool.ts:40` re-export `TeamContext` từ `./team-tool/context.ts`. Các file khác import qua `team-tool.ts` tạo dependency chain dài. Nên import trực tiếp từ `./team-tool/context.ts` để rõ chuỗi dependency.

**Vị trí:** Search:
```powershell
Select-String -Path src\**\*.ts -Pattern 'TeamContext.*from "(\.\.?/)*extension/team-tool\.ts"'
```

**Đề xuất fix:**
Đổi import sang `team-tool/context.ts`. Có thể giữ re-export ở `team-tool.ts` cho backward compat ngoài (extension API public).

**Verification:**
```bash
npx tsc --noEmit
npm test
```

**Risk:** Thấp — refactor pure.

---

### Task #23 — Subagent stuck-blocked notification (LOW, từ #16c Phase 1)

**Vấn đề:**
`subagent-manager.ts` có status `"blocked"` trong `TERMINAL_RUN_STATUS` nhưng không có notification UI khi child run blocked > N phút. User không biết child đang stuck.

**Vị trí:** `src/runtime/subagent-manager.ts`

**Đề xuất fix:**

1. Thêm constant trong `config/defaults.ts`:
```ts
export const DEFAULT_SUBAGENT = {
	stuckBlockedNotifyMs: 5 * 60_000, // 5 phút
};
```

2. Bổ sung field vào `SubagentRecord`:
```ts
export interface SubagentRecord {
	// ... existing
	stuckNotified?: boolean;
}
```

3. Trong polling/watch loop kiểm tra child status:
```ts
import { DEFAULT_SUBAGENT } from "../config/defaults.ts";

if (record.status === "blocked"
    && record.startedAt
    && Date.now() - record.startedAt > DEFAULT_SUBAGENT.stuckBlockedNotifyMs
    && !record.stuckNotified) {
	emitEvent("subagent.stuck-blocked", {
		id: record.id,
		runId: record.runId,
		durationMs: Date.now() - record.startedAt,
	});
	record.stuckNotified = true;
	savePersistedSubagentRecord(cwd, record);
}
```

4. UI/dashboard subscribe event `subagent.stuck-blocked` hiển thị badge cảnh báo.

**Verification:**
Test mới `test/unit/subagent-stuck-notify.test.ts`:
```ts
test("subagent blocked > threshold emits stuck-blocked event", async () => {
	const record = createRecord({ status: "blocked", startedAt: Date.now() - 10 * 60_000 });
	const events: string[] = [];
	checkSubagentStuck(record, (type) => events.push(type));
	assert.ok(events.includes("subagent.stuck-blocked"));
	assert.equal(record.stuckNotified, true);
});
```

**Risk:** Thấp — feature mới, không ảnh hưởng path hiện có.

---

### Task #24 — TypeBox config validation warnings (MEDIUM)

**Vấn đề:**
`config.ts` `parseConfig()` dùng `parseWithSchema` trả `undefined` khi schema fail → silent drop. User config sai sẽ bị bỏ qua không cảnh báo.

**Vị trí:** `src/config/config.ts:189-207, parseConfig()`

**Đề xuất fix:**

1. Thêm hàm `validateConfigStrict` trả về warnings:
```ts
import { Value } from "typebox/value";
import { PiTeamsConfigSchema } from "../schema/config-schema.ts";

export interface ConfigValidation {
	config: PiTeamsConfig;
	warnings: string[];
}

export function validateConfigStrict(raw: unknown): ConfigValidation {
	const warnings: string[] = [];
	if (raw && typeof raw === "object" && !Value.Check(PiTeamsConfigSchema, raw)) {
		for (const err of Value.Errors(PiTeamsConfigSchema, raw)) {
			warnings.push(`Config invalid at ${err.path}: ${err.message}`);
		}
	}
	return { config: parseConfig(raw), warnings };
}
```

2. Thêm field `warnings` vào `LoadedPiTeamsConfig`:
```ts
export interface LoadedPiTeamsConfig {
	config: PiTeamsConfig;
	path: string;
	paths: string[];
	error?: string;
	warnings?: string[];   // <-- thêm
}
```

3. `loadConfig()` populate warnings từ cả user + project config:
```ts
export function loadConfig(cwd?: string): LoadedPiTeamsConfig {
	const filePath = configPath();
	const paths = cwd ? [filePath, projectConfigPath(cwd)] : [filePath];
	const warnings: string[] = [];
	try {
		const userValidation = validateConfigStrict(readConfigRecord(filePath));
		warnings.push(...userValidation.warnings.map((w) => `${filePath}: ${w}`));
		let config = userValidation.config;
		if (cwd) {
			const projectValidation = validateConfigStrict(readConfigRecord(projectConfigPath(cwd)));
			warnings.push(...projectValidation.warnings.map((w) => `${projectConfigPath(cwd)}: ${w}`));
			config = mergeConfig(config, projectValidation.config);
		}
		return { path: filePath, paths, config, warnings: warnings.length ? warnings : undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { path: filePath, paths, config: {}, error: message };
	}
}
```

4. UI hiển thị warnings trong action `team doctor` (`handleDoctor`).

**Verification:**
```bash
node --experimental-strip-types --test test/unit/config-schema-validation.test.ts
# Thêm test:
//   - invalid config (e.g., notifierIntervalMs: 100) → warnings non-empty
//   - valid config → warnings undefined
```

**Risk:** Thấp — chỉ thêm thông tin, không thay đổi runtime behavior. Backward-compat: nếu callers không đọc `warnings` thì không ảnh hưởng.

---

### Task #25 — atomicWriteFileAsync idempotent retry (LOW)

**Vấn đề:**
`atomicWriteFileAsync` ghi temp + rename. Nếu 2 process song song write cùng `filePath`, đôi khi rename của process A vào lúc process B đã rename xong → `EPERM`/`EBUSY` Windows. Retry handle nhưng có thể spin nhiều lần không cần thiết.

**Vị trí:** `src/state/atomic-write.ts:34-46`

**Đề xuất fix:**
Sau retry exhaust, kiểm tra nếu file đã tồn tại với content khớp mong muốn → coi như success (idempotent write):

```ts
export async function atomicWriteFileAsync(filePath: string, content: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await fs.promises.writeFile(tempPath, content, "utf-8");
		try {
			await __test__renameWithRetryAsync(tempPath, filePath);
		} catch (renameError) {
			// Idempotent fallback: nếu file đã có nội dung khớp → success
			try {
				const existing = await fs.promises.readFile(filePath, "utf-8");
				if (existing === content) {
					await fs.promises.rm(tempPath, { force: true });
					return;
				}
			} catch {
				// file không tồn tại hoặc không đọc được → throw original
			}
			throw renameError;
		}
	} catch (error) {
		try {
			await fs.promises.rm(tempPath, { force: true });
		} catch (cleanupError) {
			logInternalError("atomic-write.cleanupAsync", cleanupError, `tempPath=${tempPath}`);
		}
		throw error;
	}
}
```

**Verification:**
Stress test mới `test/unit/atomic-write-concurrent.test.ts`:
```ts
test("100 concurrent writes of same content succeed", async () => {
	const filePath = path.join(tmpDir, "concurrent.json");
	await Promise.all(
		Array.from({ length: 100 }, () => atomicWriteFileAsync(filePath, '{"v":1}'))
	);
	assert.equal(fs.readFileSync(filePath, "utf-8"), '{"v":1}');
});
```

**Risk:** Trung bình — race rất hiếm, ưu tiên sau cùng. Cần test kỹ trên Windows + Linux để chắc fallback không hide bug.

---

## Quick Reference — Verification cho mọi follow-up task

```powershell
Set-Location D:\my\my_project\pi-crew

# Type check (PHẢI pass sau task #17)
npx tsc --noEmit

# Targeted tests
node --experimental-strip-types --test test/unit/<file>.test.ts

# Full unit suite
npm run test:unit

# Full CI
npm run ci   # = typecheck + test + npm pack --dry-run
```

