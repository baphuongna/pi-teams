---
name: research
description: Research and write up findings
---

## explore
role: explorer

Gather relevant facts for: {goal}

## analyze
role: analyst
dependsOn: explore

Analyze and organize the findings.

## write
role: writer
dependsOn: analyze
output: research-summary.md

Write a concise final summary with evidence and open questions.
