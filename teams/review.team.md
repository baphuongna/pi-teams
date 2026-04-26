---
name: review
description: Team for code review and security review
defaultWorkflow: review
workspaceMode: single
maxConcurrency: 2
---

- explorer: agent=explorer understand changed areas
- reviewer: agent=reviewer review correctness and maintainability
- security-reviewer: agent=security-reviewer review security risks
- verifier: agent=verifier summarize pass/fail
