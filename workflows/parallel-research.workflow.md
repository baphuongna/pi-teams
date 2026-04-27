---
name: parallel-research
description: Parallel research with shard exploration and synthesis
---

## discover
role: explorer

Discover the relevant files/projects for: {goal}. Return a shard plan with paths grouped by topic. Do not deeply read every file yet; focus on routing the work.

## explore-core
role: explorer
parallelGroup: explore

Explore the core/runtime shard from the discover output. Focus on architecture, package config, docs, and reusable patterns for: {goal}

## explore-ui
role: explorer
parallelGroup: explore

Explore the UI/TUI/extension-interface shard from the discover output. Focus on widgets, overlays, commands, status bars, package config, docs, and reusable patterns for: {goal}

## explore-runtime
role: explorer
parallelGroup: explore

Explore the worker/runtime/subagent/runtime-control shard from the discover output. Focus on process/session/runtime orchestration, event streams, logs, package config, docs, and reusable patterns for: {goal}

## explore-extensions
role: explorer
parallelGroup: explore

Explore the extension bundle/small-package shard from the discover output. Focus on package config, extension registration, commands/tools, docs, and reusable patterns for: {goal}

## synthesize
role: analyst
dependsOn: explore-core, explore-ui, explore-runtime, explore-extensions

Synthesize all shard findings. Use discover output if available, but do not require it. Identify common patterns, gaps, and concrete recommendations.

## write
role: writer
dependsOn: synthesize
output: research-summary.md

Write a concise final summary with evidence, risks, and actionable next steps.
