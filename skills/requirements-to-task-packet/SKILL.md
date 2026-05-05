---
name: requirements-to-task-packet
description: Use when a goal, issue, roadmap item, review finding, or user request must become actionable worker tasks.
---

# requirements-to-task-packet

Core principle: workers need explicit task packets, not inherited ambiguity. Ask only when ambiguity changes architecture, safety, public behavior, or data loss risk; otherwise record assumptions.

Distilled from detailed reads of clarification, spec-to-implementation, subagent-driven development, and skill-authoring patterns.

## Clarify or Proceed

Ask before implementation when ambiguity affects:

- security boundary, permissions, ownership, or secret handling;
- destructive operations, migrations, publishing, or public API behavior;
- architecture or data model;
- acceptance criteria or rollback expectations.

Proceed with explicit assumptions when ambiguity is local, reversible, and testable.

## Task Packet Template

```text
Objective:
Scope/paths:
Allowed edits:
Forbidden edits/non-goals:
Inputs/dependencies:
Relevant context/artifacts:
Assumptions:
Risks:
Acceptance criteria:
Verification commands:
Expected output artifacts:
Escalation conditions:
```

## Subagent Context Rules

- Give each worker fresh, curated context; do not rely on hidden parent history.
- Include exact upstream artifact paths and summaries when needed.
- Keep implementation tasks independent or explicitly sequenced.
- Require workers to report one of: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED.
- For BLOCKED/NEEDS_CONTEXT, change context/model/scope before retrying.

## Acceptance Criteria

Use observable checks:

- command output, state transition, UI/status text, artifact contents;
- regression tests or named test files;
- security properties such as containment/ownership/no secrets;
- compatibility requirements such as Windows paths or Pi CLI flags;
- rollback notes.

## Anti-patterns

- Broad “fix everything” prompts.
- Buried assumptions.
- Expanding scope because context remains.
- Treating tests as proof when the requirement was never asserted.
