---
name: mento-session-end
description: Use when ending a Mento work session, when the user says wrap up or log progress, or after a shipped unit of work needs recording.
---

# Mento session end — log, reconcile, commit

The repo's contract (AGENTS.md): **every session ends by updating PROGRESS.md and committing.** ~40% of the repo's commits are `docs(progress)` — this ritual is not optional.

## Steps

1. **Verify first** — nothing gets logged as Done that didn't pass **mento-verify**.
2. **PROGRESS.md entry** — newest on top, under today's date + session number:

```markdown
## YYYY-MM-DD (session N) — <one-line outcome> ✅
**Context:** <founder ruling / why this work>
**Done:** <per commit: what + how it was proven (pytest count, tsc, e2e name)>
**Open (founder):** <new decisions needing a veto/answer + carried backlog>
**Next:** <agreed horizon>
**How to resume:** <stack state, any new commands, new gotchas discovered>
```

3. **Log gotchas permanently** — anything that cost >15 min (a trap, a workaround, a root-caused flake) goes in the entry AND, if it will recur, into the matching skill or CLAUDE.md.
4. **Drift check** — did this session change scope, tabs, stack, or conventions? Update CLAUDE.md's affected section and its "Docs drift to reconcile" list now; a founder ruling needs a DECISIONS.md entry (flag if deferred).
5. **Commit** — conventional format; `docs(progress): session N — <slug>` for the log commit; verify `git status` is clean after.

## Red flags

| Thought | Reality |
|---|---|
| "I'll log it next session" | Next session starts by reading PROGRESS.md — an unlogged session is invisible. |
| "The commit message documents it" | PROGRESS carries context, founder decisions, and resume state that commits can't. |
| "Docs can catch up later" | That's how CLAUDE.md went a full session stale. Reconcile or list the drift now. |

Output: the committed PROGRESS entry + a one-line statement of any drift left on the reconcile list.
