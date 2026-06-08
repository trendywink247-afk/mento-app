# AGENTS.md

Cross-tool brief for any AI agent or assistant working in this repo (Claude Code, Copilot, Cursor, Codex, etc.).

## Read these first, in order
1. **`CLAUDE.md`** — the durable project brain: stack, repo layout, conventions, SCOPE, definition-of-done, Trust & Safety, performance targets, colour tokens. This is the primary brief.
2. **`docs/DECISIONS.md`** — authoritative product decisions. **Wins over the PRD and the mockups on any conflict.**
3. **`docs/PRD.md`** — full product requirements (context and rationale).
4. **`PROGRESS.md`** — current state and exactly how to resume.

## Ground rules
- **Source-of-truth order:** DECISIONS → PRD → mockups. Don't resolve conflicts by guessing; check DECISIONS, and if it's silent, flag it as an open decision in `PROGRESS.md`.
- **Trust & Safety in `CLAUDE.md` is non-negotiable.** Crisis flow, honest payments, anonymity, age-gate, PII-minimization, "privacy policy matches reality."
- **Build only what's in SCOPE → v1.** Deferred items (Module B mentoring, UPSC self-assessment suite, Community) are not built by default.
- **Quality bar is international B2C.** Make the opinionated, top-tier-consumer-app call; record load-bearing choices in `PROGRESS.md`.
- **End every work session** by updating `PROGRESS.md`, committing with a clear message, and stating the resume command.

If `CLAUDE.md` and this file ever disagree, `CLAUDE.md` wins.
