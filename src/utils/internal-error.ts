export function logInternalError(scope: string, error: unknown, details?: string): void {
	if (!process.env.PI_TEAMS_DEBUG) return;
	const message = error instanceof Error ? error.message : String(error);
	const suffix = details ? `: ${details}` : "";
	console.error(`[pi-crew:${scope}] ${message}${suffix}`);
}
