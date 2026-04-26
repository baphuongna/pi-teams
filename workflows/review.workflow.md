---
name: review
description: Review workflow for correctness and security
---

## explore
role: explorer

Identify changed or relevant areas for review: {goal}

## code-review
role: reviewer
dependsOn: explore
parallelGroup: review

Review correctness, maintainability, tests, and regressions.

## security-review
role: security-reviewer
dependsOn: explore
parallelGroup: review

Review security risks and trust boundaries.

## verify
role: verifier
dependsOn: code-review, security-review
verify: true

Summarize review outcome and pass/fail status.
