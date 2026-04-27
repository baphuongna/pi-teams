import type { TaskGraphNode, TeamTaskState } from "../state/types.ts";

export interface TaskGraphSchedulerSnapshot {
	ready: string[];
	blocked: string[];
	running: string[];
	done: string[];
	failed: string[];
	cancelled: string[];
}

function completedStepIds(tasks: TeamTaskState[]): Set<string> {
	return new Set(tasks.filter((task) => task.status === "completed").map((task) => task.stepId).filter((id): id is string => id !== undefined));
}

function taskById(tasks: TeamTaskState[]): Map<string, TeamTaskState> {
	return new Map(tasks.map((task) => [task.id, task]));
}

function stepIdToTaskId(tasks: TeamTaskState[]): Map<string, string> {
	return new Map(tasks.map((task) => [task.stepId, task.id]).filter((entry): entry is [string, string] => entry[0] !== undefined));
}

function dependencySatisfied(task: TeamTaskState, doneStepIds: Set<string>, idMap: Map<string, TeamTaskState>, stepMap: Map<string, string>): boolean {
	return task.dependsOn.every((dependency) => {
		if (doneStepIds.has(dependency)) return true;
		const taskId = stepMap.get(dependency) ?? dependency;
		return idMap.get(taskId)?.status === "completed";
	});
}

function withQueue(task: TeamTaskState, queue: TaskGraphNode["queue"]): TeamTaskState {
	return task.graph ? { ...task, graph: { ...task.graph, queue } } : task;
}

export function refreshTaskGraphQueues(tasks: TeamTaskState[]): TeamTaskState[] {
	const doneSteps = completedStepIds(tasks);
	const ids = taskById(tasks);
	const steps = stepIdToTaskId(tasks);
	return tasks.map((task) => {
		if (task.status === "queued") return withQueue(task, dependencySatisfied(task, doneSteps, ids, steps) ? "ready" : "blocked");
		if (task.status === "running") return withQueue(task, "running");
		if (task.status === "completed" || task.status === "skipped") return withQueue(task, "done");
		return withQueue(task, "blocked");
	});
}

export function getReadyTasks(tasks: TeamTaskState[], maxCount = 1): TeamTaskState[] {
	return refreshTaskGraphQueues(tasks).filter((task) => task.status === "queued" && task.graph?.queue === "ready").slice(0, Math.max(0, maxCount));
}

export function markTaskRunning(tasks: TeamTaskState[], taskId: string, now = new Date()): TeamTaskState[] {
	return refreshTaskGraphQueues(tasks).map((task) => task.id === taskId ? withQueue({ ...task, status: "running", startedAt: task.startedAt ?? now.toISOString() }, "running") : task);
}

export function markTaskDone(tasks: TeamTaskState[], taskId: string, now = new Date()): TeamTaskState[] {
	return refreshTaskGraphQueues(tasks.map((task) => task.id === taskId ? { ...task, status: "completed", finishedAt: task.finishedAt ?? now.toISOString() } : task));
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

export function taskGraphSnapshot(tasks: TeamTaskState[]): TaskGraphSchedulerSnapshot {
	const refreshed = refreshTaskGraphQueues(tasks);
	return {
		ready: refreshed.filter((task) => task.status === "queued" && task.graph?.queue === "ready").map((task) => task.id),
		blocked: refreshed.filter((task) => task.status === "queued" && task.graph?.queue === "blocked").map((task) => task.id),
		running: refreshed.filter((task) => task.status === "running").map((task) => task.id),
		done: refreshed.filter((task) => task.status === "completed" || task.status === "skipped").map((task) => task.id),
		failed: refreshed.filter((task) => task.status === "failed").map((task) => task.id),
		cancelled: refreshed.filter((task) => task.status === "cancelled").map((task) => task.id),
	};
}
