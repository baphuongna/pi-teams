---
name: model-routing-context
description: Model routing, parent context, thinking level, and prompt construction workflow. Use when changing model fallback, child Pi args, inherited context, task prompts, or compact-read behavior.
---

# model-routing-context

Use this skill when working on model/context propagation.

## Source patterns distilled

- Pi session context/model state: `source/pi-mono/packages/coding-agent/src/core/session-manager.ts`, `agent-session.ts`, compaction modules
- pi-crew model and prompt code: `src/runtime/model-fallback.ts`, `src/runtime/pi-args.ts`, `src/runtime/task-runner/prompt-builder.ts`, `src/runtime/task-output-context.ts`, `src/extension/team-tool/context.ts`

## Rules

- Preserve parent model inheritance unless an agent/task/user explicitly provides a non-empty model override.
- Treat empty strings and whitespace model values as absent.
- Carry relevant parent conversation context as reference-only; do not let it override explicit task instructions or safety constraints.
- Respect compact-read/compaction summaries when building context; avoid ballooning prompts with redundant transcript data.
- Avoid inline dynamic imports for model providers or prompt helpers.
- When changing model precedence, add tests for undefined, empty, whitespace, agent, task, parent, and explicit tool override cases.
- Redact secrets in context snippets and child prompts where logs/artifacts may persist them.

## Anti-patterns

- Letting `agentModel: ""` block parent model fallback.
- Treating parent conversation text as executable instructions rather than context.
- Passing full session transcripts to every child by default.
- Losing thinking level or model changes across session switch/fork flows.

## Verification

```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/model-inheritance.test.ts test/unit/model-precedence.test.ts test/unit/task-output-context-security.test.ts test/unit/extension-api-surface.test.ts
npm test
```
