---
name: research
description: Team for investigation and documentation
defaultWorkflow: research
workspaceMode: single
maxConcurrency: 2
---

- explorer: agent=explorer gather codebase facts
- analyst: agent=analyst analyze findings
- writer: agent=writer produce final notes
