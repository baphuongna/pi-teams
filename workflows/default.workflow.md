---
name: default
description: Explore, plan, execute, and verify
---

## explore
role: explorer

Explore the codebase for the goal: {goal}

## plan
role: planner
dependsOn: explore
output: plan.md

Create a concise implementation plan for: {goal}

## execute
role: executor
dependsOn: plan

Implement the plan for: {goal}

## verify
role: verifier
dependsOn: execute
verify: true

Verify completion for: {goal}
