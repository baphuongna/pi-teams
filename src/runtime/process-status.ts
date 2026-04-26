export interface ProcessLiveness {
	pid?: number;
	alive: boolean;
	detail: string;
}

export function checkProcessLiveness(pid: number | undefined): ProcessLiveness {
	if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
		return { pid, alive: false, detail: "no pid recorded" };
	}
	try {
		process.kill(pid, 0);
		return { pid, alive: true, detail: "process is alive" };
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === "EPERM") return { pid, alive: true, detail: "process exists but permission is denied" };
		if (nodeError.code === "ESRCH") return { pid, alive: false, detail: "process does not exist" };
		const message = error instanceof Error ? error.message : String(error);
		return { pid, alive: false, detail: message };
	}
}

export function isActiveRunStatus(status: string): boolean {
	return status === "queued" || status === "planning" || status === "running";
}
