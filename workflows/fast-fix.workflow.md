---
name: fast-fix
description: Minimal workflow for small fixes
---

## explore
role: explorer

Find the likely source of the issue: {goal}

## execute
role: executor
dependsOn: explore

Make the smallest safe fix.

## verify
role: verifier
dependsOn: execute
verify: true

Verify the fix with available evidence.
