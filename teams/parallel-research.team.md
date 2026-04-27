---
name: parallel-research
description: Parallel research team for multi-project/source audits
workspaceMode: single
defaultWorkflow: parallel-research
maxConcurrency: 4
triggers: đọc sâu, deep read, deep research, source audit, multiple projects, parallel research, pi-*
category: research
cost: cheap
---

- explorer: agent=explorer gather source facts in parallel shards
- analyst: agent=analyst synthesize shard findings
- writer: agent=writer produce final notes
