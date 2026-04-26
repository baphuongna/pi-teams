---
name: implementation
description: Full implementation team with analysis, critique, execution, review, and verification
defaultWorkflow: implementation
workspaceMode: single
maxConcurrency: 3
---

- explorer: agent=explorer map the codebase
- analyst: agent=analyst clarify requirements and constraints
- planner: agent=planner create execution plan
- critic: agent=critic challenge the plan
- executor: agent=executor implement the plan
- reviewer: agent=reviewer review the implementation
- verifier: agent=verifier verify done
