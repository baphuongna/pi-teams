---
name: secure-agent-orchestration-review
description: Use when reviewing delegation, skill loading, tool access, worker prompts, artifacts, runtime config, state, ownership, or subprocess execution.
---

# secure-agent-orchestration-review

Core principle: every delegated worker crosses trust boundaries. Safe orchestration requires contained paths, explicit ownership, scoped tools, non-invasive defaults, and prompt-injection resistance.

Distilled from detailed reads of security notice, insecure-defaults, sharp-edges, differential-review, guardrail, and skill quality patterns.

## Trust Boundaries

Review:

- parent session ↔ child Pi worker;
- user prompt ↔ generated task packet;
- project skills ↔ package skills;
- global config ↔ project config;
- artifacts/logs ↔ future prompts/UI;
- mailbox/respond/steer/cancel ↔ session ownership;
- external skills/docs ↔ prompt injection/tool poisoning;
- runtime env/CLI args ↔ provider/model behavior.

## Must-Check Findings

- Unsafe defaults: scaffold mode unexpectedly enabled, dangerous limits, missing depth guards, overbroad tools.
- Path containment: cwd override escape, symlink traversal, unsafe skill names, absolute path leakage.
- Prompt injection: untrusted output treated as instruction, skill metadata overtrusted, missing precedence text.
- Secrets: env/config/log/artifact/diagnostic leakage.
- Destructive commands: delete/prune/reset/force push without explicit confirmation.
- Ownership races: authorization checked outside lock, stale task/manifest written after re-read.
- Supply chain: external skill content imported without review, unknown tool requirements, hidden commands.

## Secure Defaults for pi-crew

- Real execution should be explicit and disable-able, but generated config must not accidentally block normal workflows.
- Project overrides should be contained to the project root.
- Missing/invalid config should fall back safely.
- Skills should be loaded by safe name and source-labeled without absolute path disclosure.
- Worker prompts should state instruction precedence and treat artifacts as data.

## Finding Format

Include severity, path/symbol, scenario, fix, and verification. Separate must-fix security issues from hardening suggestions.
