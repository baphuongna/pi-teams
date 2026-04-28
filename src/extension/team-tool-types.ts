export interface TeamToolDetails {
	action: string;
	status: "ok" | "error" | "planned";
	runId?: string;
	artifactsRoot?: string;
}
