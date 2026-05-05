# Awesome Agent Skills Distillation for pi-crew

Date: 2026-05-05
Source repo: `source/awesome-agent-skills` at `859172a` after fast-forward pull from `VoltAgent/awesome-agent-skills`.

## Source Character

`awesome-agent-skills` is a curated index/README of external agent skills, not a vendored skill-source tree. pi-crew should not copy external skill text from linked repositories. This distillation uses high-level themes from the index plus selected detailed reads of linked skills, rewritten as pi-crew-native workflows rather than vendored text.

## Detailed Links Read

Accessible raw GitHub links inspected:

- `obra/superpowers`:
  - `verification-before-completion/SKILL.md` — evidence before claims; fresh command output required.
  - `systematic-debugging/SKILL.md` — no fixes without root-cause investigation; four-phase debug loop.
  - `subagent-driven-development/SKILL.md` — fresh subagent context, staged review checkpoints, DONE/NEEDS_CONTEXT/BLOCKED handling.
  - `requesting-code-review/SKILL.md` — review early/often with explicit base/head context.
  - `receiving-code-review/SKILL.md` — verify feedback before implementing; push back with technical evidence.
  - `using-git-worktrees/SKILL.md` — detect existing isolation, prefer native worktree tools, verify clean baseline.
  - `finishing-a-development-branch/SKILL.md` — verify tests before merge/PR/discard options.
  - `test-driven-development/SKILL.md` — red/green/refactor; tests must fail for the intended reason.
  - `writing-skills/SKILL.md` — trigger-only descriptions, progressive skill structure, pressure-test skills.

Blocked/unavailable in this environment:

- `officialskills.sh` pages for Trail of Bits/OpenAI returned HTTP 403 when fetched directly.
- Some README paths have moved or are directory-based; missing paths were not treated as source of truth.

Relevant source themes:

- Trail of Bits: clarification, audit context, differential review, insecure defaults, sharp edges, static analysis, testing handbook.
- OpenAI/Sentry/CodeRabbit/Garry Tan: security review, threat modeling, PR/code review, QA, guardrails, release/deploy verification.
- Obra/NeoLab community skills: subagent-driven development, testing with subagents, worktrees, verification before completion, recursive decomposition, review checkpoints.
- Context-engineering entries: context degradation, compression, memory systems, tool design, evaluation frameworks.
- Skill quality standards: specific descriptions, progressive disclosure, no absolute paths, scoped tools.
- Security notice: skills are curated but not audited; external skill content can contain prompt injection, tool poisoning, malware payloads, or unsafe data handling.

## Added pi-crew Skills

### `requirements-to-task-packet`

Purpose: convert ambiguous work into task packets with assumptions, scope, non-goals, acceptance criteria, verification, and escalation conditions.

Primary roles: `analyst`, `planner`.

### `secure-agent-orchestration-review`

Purpose: security-review workflow for delegation, skill loading, tool access, prompts, artifacts, config, and session/state ownership.

Primary role: `security-reviewer`.

### `multi-perspective-review`

Purpose: structured review protocol separating correctness, security, tests, maintainability, operator experience, and compatibility.

Primary roles: `reviewer`, `critic`.

### `verification-before-done`

Purpose: completion gate requiring targeted checks, typecheck/integration/full test escalation, evidence, artifacts, risks, and rollback notes.

Primary roles: `executor`, `test-engineer`, `verifier`.

### `context-artifact-hygiene`

Purpose: prevent context poisoning, lost-in-middle failures, stale artifacts, absolute-path leakage, and poor handoffs.

Primary roles: `explorer`, `writer`.

### `systematic-debugging`

Purpose: reproduce/trace/hypothesize/fix loop for failing tests, blocked runs, config pollution, provider/runtime errors, and stale state.

Not currently default-mapped to avoid skill-budget bloat; can be requested by `skill: "systematic-debugging"` or added to future debug workflows.

## Default Role Mapping Changes

Updated `src/runtime/skill-instructions.ts` to use the new distilled skills while keeping prompt budgets small:

- `explorer`: `read-only-explorer`, `context-artifact-hygiene`
- `analyst`: `read-only-explorer`, `requirements-to-task-packet`
- `planner`: `delegation-patterns`, `requirements-to-task-packet`
- `critic`: `read-only-explorer`, `multi-perspective-review`
- `executor`: `state-mutation-locking`, `safe-bash`, `verification-before-done`
- `reviewer`: `read-only-explorer`, `multi-perspective-review`
- `security-reviewer`: `secure-agent-orchestration-review`, `ownership-session-security`
- `test-engineer`: `verification-before-done`, `safe-bash`
- `verifier`: `verification-before-done`, `runtime-state-reader`
- `writer`: `context-artifact-hygiene`, `verify-evidence`

## Rationale

The selected skills are generic, pi-crew-native, and immediately useful for team orchestration. Vendor/framework-specific skills from the index were intentionally skipped because pi-crew is a TypeScript Pi extension and should not bake in unrelated platform instructions.

## Follow-up Ideas

- Add workflow-level `skills:` defaults for debug/recovery workflows that include `systematic-debugging`.
- Add a `skill-supply-chain-audit` skill if pi-crew later imports external skill bundles automatically.
- Add documentation to README describing `skill` override usage and project `skills/<name>/SKILL.md` overrides.
