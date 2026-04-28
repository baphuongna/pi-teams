# safe-bash

Use this skill whenever a task may execute shell commands.

## Rules

- Prefer read-only commands first: `pwd`, `ls`, `find`, `rg`, `git status`, package-manager dry runs.
- Before mutating commands, explain the target path and expected effect.
- Never run destructive cleanup (`rm -rf`, `git clean`, force delete, prune, reset hard) without explicit confirmation.
- Avoid shell-specific assumptions when a cross-platform Node/Pi API exists.
- On Windows, prefer argv-based process execution and avoid `cmd /c start` or `/bin/bash` unless explicitly required.
- Capture verification output and summarize exit status.

## Reporting

Mention commands run and whether they were read-only or mutating.
