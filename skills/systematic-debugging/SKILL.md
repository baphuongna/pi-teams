---
name: systematic-debugging
description: Use when encountering a bug, test failure, blocked run, provider error, stale state, crash, or unexpected behavior before proposing fixes.
---

# systematic-debugging

Core principle: no fixes without root-cause investigation first. Symptom patches create new bugs and hide the real failure.

Distilled from detailed reads of systematic-debugging, root-cause tracing, TDD, and error-analysis skill patterns.

## Four Phases

### 1. Root Cause Investigation

Before any fix:

- read error messages, stack traces, failing assertions, task status, and logs completely;
- reproduce narrowly and record the exact command/steps;
- check recent diffs, commits, config changes, dependency changes, and environment differences;
- trace data/control flow across component boundaries;
- add temporary diagnostics only when they answer a specific question.

For pi-crew, trace:

```text
user/tool params → config resolution → team/workflow/agent discovery → model/runtime routing → child args/env → state/events/artifacts → status/UI
```

### 2. Pattern Analysis

- Find a similar working path in the codebase.
- Compare working vs broken behavior field-by-field.
- Identify dependencies: config home, project root markers, env vars, locks, stale caches, provider model capabilities.
- Do not assume small differences are irrelevant.

### 3. Hypothesis and Test

- State one hypothesis: “I think X is the root cause because Y.”
- Test one variable at a time with the smallest read-only probe or targeted test.
- If wrong, discard the hypothesis instead of piling on fixes.
- After three failed fixes, question architecture or assumptions before continuing.

### 4. Implementation

- Add or identify a failing regression test when practical.
- Fix the root cause, not the symptom.
- Avoid “while I’m here” refactors.
- Verify targeted behavior, then broader gates.

## Evidence to Collect

- failing command and exit code;
- relevant manifest/tasks/events/mailbox files;
- effective config paths and redacted config;
- child Pi args/env after redaction;
- git diff and recent commits;
- provider/model/thinking resolution;
- async timing/race indicators.

## Anti-patterns

- Fixing before reproducing.
- Assuming real user global config cannot pollute tests.
- Treating provider errors as only transient network failures.
- Removing guards because they reveal a blocked state.
- Editing unrelated layers before checking the hypothesis.
