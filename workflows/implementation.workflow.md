---
name: implementation
description: Full implementation workflow with critique and review gates
---

## explore
role: explorer

Map relevant files, APIs, and constraints for: {goal}

## analyze
role: analyst
dependsOn: explore

Analyze requirements, ambiguities, risks, and acceptance criteria for: {goal}

## plan
role: planner
dependsOn: analyze
output: plan.md

Create an execution plan for: {goal}

## critique
role: critic
dependsOn: plan

Critique the plan and identify required improvements.

## execute
role: executor
dependsOn: critique

Implement the improved plan for: {goal}

## review
role: reviewer
dependsOn: execute

Review the implementation.

## verify
role: verifier
dependsOn: review
verify: true

Verify the final result.
