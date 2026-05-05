#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const agentDir = path.join(os.homedir(), ".pi", "agent");
const configPath = path.join(agentDir, "pi-crew.json");
const legacyConfigPath = path.join(agentDir, "extensions", "pi-crew", "config.json");
const defaultConfig = {
  // Keep generated config non-invasive: runtime/limits use pi-crew internal defaults.
  autonomous: {
    enabled: true,
    injectPolicy: true,
    preferAsyncForLongTasks: false,
    allowWorktreeSuggestion: true
  },
  agents: {
    overrides: {
      explorer: { model: false, thinking: "off" },
      writer: { model: false, thinking: "off" },
      planner: { model: false, thinking: "medium" },
      analyst: { model: false, thinking: "off" },
      critic: { model: false, thinking: "low" },
      executor: { model: false, thinking: "medium" },
      reviewer: { model: false, thinking: "off" },
      "security-reviewer": { model: false, thinking: "medium" },
      "test-engineer": { model: false, thinking: "low" },
      verifier: { model: false, thinking: "off" }
    }
  },
  ui: {
    showModel: true
  }
};

fs.mkdirSync(agentDir, { recursive: true });
if (!fs.existsSync(configPath)) {
  if (fs.existsSync(legacyConfigPath)) {
    fs.copyFileSync(legacyConfigPath, configPath);
    console.log(`Migrated pi-crew global config to: ${configPath}`);
  } else {
    fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
    console.log(`Created default pi-crew global config: ${configPath}`);
  }
} else {
  console.log(`pi-crew global config already exists: ${configPath}`);
}

console.log("\nInstall the published package in Pi with:");
console.log("  pi install npm:pi-crew");
console.log("\nFor local development from a cloned repo:");
console.log("  pi install .");
console.log("\nChild workers are enabled by default. For dry runs, set runtime.mode=scaffold or executeWorkers=false.");
console.log("To force-disable or force-enable workers in a shell, use PI_TEAMS_EXECUTE_WORKERS=0/1.");
