#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-teams");
const configPath = path.join(configDir, "config.json");
fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, `${JSON.stringify({ asyncByDefault: false, executeWorkers: false, notifierIntervalMs: 5000, requireCleanWorktreeLeader: true, autonomous: { enabled: true, injectPolicy: true, preferAsyncForLongTasks: false, allowWorktreeSuggestion: true } }, null, 2)}\n`, "utf-8");
  console.log(`Created default pi-teams config: ${configPath}`);
} else {
  console.log(`pi-teams config already exists: ${configPath}`);
}

console.log("\nInstall this package in Pi with:");
console.log("  pi install ./pi-teams");
console.log("\nEnable real child workers by setting either config executeWorkers=true or environment:");
console.log("  PI_TEAMS_EXECUTE_WORKERS=1 pi");
