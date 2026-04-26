import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPiTeams } from "./src/extension/register.ts";

export default function (pi: ExtensionAPI): void {
	registerPiTeams(pi);
}
