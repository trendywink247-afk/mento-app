# AGENTS.md

Cross-tool brief for any AI agent or assistant working in this repo (Claude Code, Copilot, Cursor, Codex, etc.).

## Workspace boundary (founder, 2026-10-02)
- Work only inside `H:\Mento gpt`; this checkout is `H:\Mento gpt\Mento`.
- Do not read, edit, sync, launch, or commit the Desktop checkout for this work.
- Use `scripts/local/workspace.ps1` for isolated local development; do not use the
  old shared container names, databases, or ports in historical commands.
- Release order: local development and automated checks → isolated VPS staging
  and end-to-end acceptance → staged production promotion. See `docs/ENVIRONMENTS.md`.

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

## Local validation before push (founder, 2026-10-04)
- Finish implementation and relevant tests locally before pushing changes. Do not use GitHub CI as the first runtime validation.
- Use scripts/local/workspace.ps1 and scripts/local/api.py for this checkout's isolated localhost app/API/test database. Do not run default pytest against the legacy localhost:5432 database.
- If required local validation is unavailable, keep changes and progress commits local, record the blocker and repair the local environment. Do not push unvalidated changes.
- CI, exact-master checks and staging remain additional gates after local acceptance; production remains locked until operational acceptance.