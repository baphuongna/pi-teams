---
name: verification-before-done
description: Use when about to claim work is complete, fixed, passing, reviewed, committed, or ready to hand off.
---

# verification-before-done

Core principle: evidence before claims. A worker report, green-looking log, or previous run is not fresh verification.

Distilled from detailed reads of agent-skill patterns for verification-before-completion, TDD, review reception, and QA workflows.

## Gate Function

Before any completion claim:

1. Identify the command or inspection that proves the claim.
2. Run the full command fresh, or explicitly state why a command cannot be run.
3. Read the output, including exit code and failure counts.
4. Compare the output to the claim.
5. Report the claim only with the evidence.

## Claim-to-Evidence Table

| Claim | Requires | Not sufficient |
|---|---|---|
| Tests pass | Fresh test output with zero failures | Prior run, “should pass” |
| Typecheck passes | Typecheck command exit 0 | Lint or targeted tests only |
| Bug fixed | Original symptom/regression test passes | Code changed |
| Requirements met | Checklist against request/plan | Generic test success |
| Agent completed | Worker output plus artifact/diff/state inspection | Worker says DONE |
| Safe to commit | Relevant checks pass and status reviewed | Partial local confidence |

## Verification Ladder

Choose the smallest reliable gate, then escalate when risk requires it:

1. Read-only inspection for plans/reviews.
2. Targeted unit test for touched behavior.
3. Typecheck for TypeScript/schema/API changes.
4. Integration test for runtime, subprocess, state, filesystem, UI, config, or session behavior.
5. Full suite before commit/release or broad changes.
6. Real Pi smoke only when safe and needed.

## Done Report

Include:

- changed files or read-only status;
- commands run and pass/fail result;
- artifacts, run IDs, logs, or state paths inspected;
- behavior actually verified;
- skipped checks and why;
- risks and rollback notes.

## Red Flags

Stop before saying done if you are using words like “should”, “probably”, “looks”, “seems”, “I think”, or if you are trusting an agent report without checking evidence.
