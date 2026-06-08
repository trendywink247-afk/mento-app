# PROGRESS.md — Mento

> Restart-from-anywhere log. Newest entry on top. Each entry: Done / In-progress / Next / Open decisions / How to resume.

---

## 2026-06-08 — Docs scaffolded + Step-1 alignment complete

**Done**
- Located source materials (were on `Desktop\Mento`, not in the repo) and **consolidated into the git repo** `C:\Users\khana\mento` (Desktop originals untouched). Repo is the project home.
- Read **`docs/PRD.md`** (v2.0) in full.
- Read **`docs/DECISIONS.md`** — founder added it mid-session (was empty at start); now the **authoritative** reconciliation (Option A). Treated as source-of-truth.
- Cataloged **all 64 mockups** → `docs/MOCKUP_INVENTORY.md` (faithful per-screen inventory + conflict flags).
- Produced the **alignment table** → `docs/ALIGNMENT.md` (PRD × mockups × build-now, every gap/contradiction flagged).
- Scaffolded the four docs: **`README.md`, `CLAUDE.md`, `AGENTS.md`, `PROGRESS.md`**.
- Wrote `.gitignore` for the intended Expo + FastAPI monorepo.

**In-progress**
- None — awaiting founder review of the docs + alignment before any build (checkpoint per the brief).

**Next (once approved)**
1. Resolve the 3 highest-priority open decisions below (they change architecture/legal).
2. Scaffold `services/api` (FastAPI + Postgres + Alembic + Redis) and `apps/mobile` (Expo SDK 52, TS, theme tokens).
3. Build vertical slice #1: **onboarding → anonymous match → live 1:1 chat** (the 30-second promise), with the crisis-scan stub wired from day one.

**Open decisions (need founder/CA input)** — full list in `docs/ALIGNMENT.md` §6
- ⚠️ **Razorpay model:** confirm transparent **contribution (₹49+) + Module B session fees**, *not* ₹399/599/999 membership tiers (PRD forbids membership framing).
- ⚠️ **Message storage vs "Panda Wipe":** mockups promise *"we don't store messages on our servers; on-device only"* — **Stream Chat stores server-side.** Change the copy or change the architecture. Trust + legal.
- **Under-18:** block entirely at MVP? (PRD recommends yes.)
- Realtime: Stream Chat vs self-hosted WebSocket.
- Final issue-category names (lean life/emotional, not UPSC-only).
- Crisis helplines: verify current India numbers (Tele-MANAS / KIRAN) at build.
- Stale PRD sections to patch (DECISIONS F): §4, §18, §6.1, §12, §15 — say the word and I'll update PRD.

**How to resume**
- Open this file, then `CLAUDE.md` (project brain) and `docs/DECISIONS.md` (rules).
- Repo: `C:\Users\khana\mento` (branch `master`). Nothing to run yet — app/backend not scaffolded.
- To continue: get founder sign-off on the alignment + the 3 ⚠️ decisions, then start the `services/api` + `apps/mobile` scaffold and the onboarding→chat slice.
