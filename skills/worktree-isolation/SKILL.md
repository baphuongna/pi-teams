---
name: worktree-isolation
description: Conflict-safe git worktree workflow. Use when running parallel implementation workers, isolating risky edits, or cleaning up task worktrees.
---

# worktree-isolation

Use this skill for worktree-based execution or cleanup.

## Source patterns distilled

- pi-subagents worktree runner and cleanup patterns
- pi-crew worktrees: `src/worktree/worktree-manager.ts`, `src/worktree/cleanup.ts`, `src/worktree/branch-freshness.ts`
- Team runner workspace mode: `src/runtime/team-runner.ts`, workflow/team resource fields

## Rules

- Use worktree mode for parallel or risky code-changing tasks when the repository is clean enough and merge ownership is clear.
- Assign one owner per file/symbol/migration path to avoid conflict-heavy merges.
- Name branches/worktrees deterministically from run/task IDs; avoid user-controlled path fragments without sanitization.
- Before cleanup, check dirty state. Preserve dirty worktrees unless `force` is explicitly set.
- Record worktree paths and branch metadata in artifacts/events so the operator can inspect or recover.
- Do not run destructive git operations without explicit confirmation and evidence of target path containment.

## Anti-patterns

- Parallel editing the same file in multiple worktrees without a merge plan.
- Force-removing dirty worktrees by default.
- Reusing stale worktrees after the base branch has moved without freshness checks.
- Storing worktrees outside the intended contained workspace root.

## Verification

```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/integration/worktree-mode.test.ts test/unit/run-index.test.ts
npm test
```
