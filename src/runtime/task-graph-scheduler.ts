import type { TeamTaskState } from "../state/types.ts";

export interface TaskGraphSchedulerSnapshot {
	ready: string[];
	blocked: string[];
	running: string[];
	done: string[];
	failed: string[];
	cancelled: string[];
}

export interface TaskGraphIndex {
	doneSteps: Set<string>;
	idMap: Map<string, TeamTaskState>;
	stepToTaskId: Map<string, string>;
}

export function buildTaskGraphIndex(tasks: TeamTaskState[]): TaskGraphIndex {
	return {
		doneSteps: new Set(tasks.filter((task) => task.status === "completed").map((task) => task.stepId).filter((id): id is string => id !== undefined)),
		idMap: new Map(tasks.map((task) => [task.id, task])),
		stepToTaskId: new Map(tasks.map((task) => [task.stepId, task.id]).filter((entry): entry is [string, string] => entry[0] !== undefined)),
	};
}

function taskById(tasks: TeamTaskState[]): Map<string, TeamTaskState> {
	return new Map(tasks.map((task) => [task.id, task]));
}

function dependencySatisfied(task: TeamTaskState, doneStepIds: Set<string>, idMap: Map<string, TeamTaskState>, stepMap: Map<string, string>): boolean {
	return task.dependsOn.every((dependency) => {
		if (doneStepIds.has(dependency)) return true;
		const taskId = stepMap.get(dependency) ?? dependency;
		return idMap.get(taskId)?.status === "completed";
	});
}

function withQueue(task: TeamTaskState, index: TaskGraphIndex): TeamTaskState {
	if (task.status === "queued") {
		const isReady = dependencySatisfied(task, index.doneSteps, index.idMap, index.stepToTaskId);
		return { ...task, graph: task.graph ? { ...task.graph, queue: isReady ? "ready" : "blocked" } : task.graph };
	}
	if (task.status === "running") {
		return { ...task, graph: task.graph ? { ...task.graph, queue: "running" } : task.graph };
	}
	if (task.status === "completed" || task.status === "skipped") {
		return { ...task, graph: task.graph ? { ...task.graph, queue: "done" } : task.graph };
	}
	return { ...task, graph: task.graph ? { ...task.graph, queue: "blocked" } : task.graph };
}

function ensureIndex(tasks: TeamTaskState[], index?: TaskGraphIndex): TaskGraphIndex {
	return index ?? buildTaskGraphIndex(tasks);
}

export function refreshTaskGraphQueues(tasks: TeamTaskState[], index?: TaskGraphIndex): TeamTaskState[] {
	const resolved = ensureIndex(tasks, index);
	return tasks.map((task) => withQueue(task, resolved));
}

export function getReadyTasks(tasks: TeamTaskState[], maxCount = 1, index?: TaskGraphIndex): TeamTaskState[] {
	return refreshTaskGraphQueues(tasks, index).filter((task) => task.status === "queued" && task.graph?.queue === "ready").slice(0, Math.max(0, maxCount));
}

export function markTaskRunning(tasks: TeamTaskState[], taskId: string, now = new Date(), index?: TaskGraphIndex): TeamTaskState[] {
	const resolved = ensureIndex(tasks, index);
	return refreshTaskGraphQueues(tasks, resolved).map((task) => task.id === taskId ? withQueue({ ...task, status: "running", startedAt: task.startedAt ?? now.toISOString() }, resolved) : task);
}

export function markTaskDone(tasks: TeamTaskState[], taskId: string, now = new Date(), index?: TaskGraphIndex): TeamTaskState[] {
	const resolved = ensureIndex(tasks, index);
	return refreshTaskGraphQueues(tasks.map((task) => task.id === taskId ? { ...task, status: "completed", finishedAt: task.finishedAt ?? now.toISOString() } : task), resolved);
}

export function cancelTaskSubtree(tasks: TeamTaskState[], rootTaskId: string, reason = "Cancelled by task graph scheduler.", now = new Date()): TeamTaskState[] {
	const ids = taskById(tasks);
	const toCancel = new Set<string>();
	const stack = [rootTaskId];
	while (stack.length) {
		const current = stack.pop();
		if (!current || toCancel.has(current)) continue;
		toCancel.add(current);
		const task = ids.get(current);
		for (const child of task?.graph?.children ?? []) stack.push(child);
	}
	return refreshTaskGraphQueues(tasks.map((task) => {
		if (!toCancel.has(task.id)) return task;
		if (task.status === "completed") return task;
		return { ...task, status: "cancelled", error: reason, finishedAt: task.finishedAt ?? now.toISOString() };
	}));
}

export function failTaskAndBlockChildren(tasks: TeamTaskState[], rootTaskId: string, reason: string, now = new Date()): TeamTaskState[] {
	const ids = taskById(tasks);
	const blocked = new Set<string>();
	const root = ids.get(rootTaskId);
	const stack = [...(root?.graph?.children ?? [])];
	while (stack.length) {
		const current = stack.pop();
		if (!current || blocked.has(current)) continue;
		blocked.add(current);
		const task = ids.get(current);
		for (const child of task?.graph?.children ?? []) stack.push(child);
	}
	return refreshTaskGraphQueues(tasks.map((task) => {
		if (task.id === rootTaskId) return { ...task, status: "failed", error: reason, finishedAt: task.finishedAt ?? now.toISOString() };
		if (blocked.has(task.id) && task.status === "queued") return { ...task, status: "skipped", error: `Blocked by failed task '${rootTaskId}'.`, finishedAt: task.finishedAt ?? now.toISOString() };
		return task;
	}));
}

export function taskGraphSnapshot(tasks: TeamTaskState[], index?: TaskGraphIndex): TaskGraphSchedulerSnapshot {
	const refreshed = refreshTaskGraphQueues(tasks, index);
	return {
		ready: refreshed.filter((task) => task.status === "queued" && task.graph?.queue === "ready").map((task) => task.id),
		blocked: refreshed.filter((task) => task.status === "queued" && task.graph?.queue === "blocked").map((task) => task.id),
		running: refreshed.filter((task) => task.status === "running").map((task) => task.id),
		done: refreshed.filter((task) => task.status === "completed" || task.status === "skipped").map((task) => task.id),
		failed: refreshed.filter((task) => task.status === "failed").map((task) => task.id),
		cancelled: refreshed.filter((task) => task.status === "cancelled").map((task) => task.id),
	};
}
