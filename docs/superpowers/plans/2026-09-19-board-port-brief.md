# Port brief — shared by every lane (2026-09-19)

You are a senior React Native engineer + product designer porting the founder-approved FINAL DESIGN BOARD into the Mento app (Expo SDK 52, expo-router 4, Reanimated 3, TS strict).

## The acceptance test (founder, verbatim)
"I want the app to look what exactly is on the board. I don't need any excuse. Look, feel, transitions — everything should come out as it is."
So for every screen in your unit: same composition, same copy, same proportions, same idle motion, same arrival order as its artboard. "Deliberately differs" is not an acceptable outcome except where a platform truly cannot do it — then build the closest thing and say exactly what is different, per platform.

## Sources (inside YOUR worktree)
- `CLAUDE.md` — read first, obey completely: tokens only (never raw hex / raw durations in components); `PressKey` for every tappable, `EdgeSurface` for static cards; `t()` i18n with EN + HI parity; motion rules (transform/opacity only, manual shared values, never `entering=`/`exiting=`, every animation consults `useReducedMotion`, calm register); companions only through `components/art/Companion`; typed API clients only; Trust & Safety (crisis / error / limit states are STILL; helplines are exactly Tele-MANAS 14416 and KIRAN 1800-599-0019; money never inside a conversation; never hint at a paid tier; "mentor", never "listener"/"peer"/"anonymous" in member copy).
- `docs/design-board/` — the artboards (`A??_*.dc.html`, 390×844 HTML mocks with exact copy, order, sizes, radii, idle motion), `FINAL_SPEC.md` (wiring table + the ONE shared arrival choreography: sky / tab bar / back key / companion are already there; content rises in reading order, 80 ms apart; sheets rise over a screen that has settled back to 0.96 under a 0.35 scrim; deeper pages come in from the side), `TRANSITIONS_SPEC.md` (the six motion principles), `ROAM_SPEC_V2.md`.
- **Port the design, not the hex/ms**: map colours, sizes, radii, durations and easings onto `theme/tokens.ts`, `theme/motion.ts`, `theme/companion.ts`. If the board needs a token the app lacks (a wash, a danger wash, a stage tint), ADD it to the token files and run `python scripts/contrast_gate.py`.
- Already built and reusable (read them before writing new ones): `components/motion/PressKey`, `EdgeSurface`, `Entrance`, `StepTransition`, `useBreathing`, `components/art/PerchedCompanion` (+ `lib/companionPlacement`), `lib/leaveToChats` (`dismissTo` — never `router.replace` onto a tab route), `lib/screenCache` (no spinner on return), `components/chat/ChatHeaderCard`, the first-run pieces the main lane is adding right now (round Stage, ring, PromiseRow, wheel — check `components/` after you pull nothing: you cannot see the main lane's uncommitted work, so if you need a Stage/ring, build a small one in your own files and I will reconcile at merge).
- The API for the new features is DONE on your branch: read `docs/superpowers/specs/2026-09-19-board-port-api.md` for exact paths, shapes and error codes (allowance, stay in touch, rotating names with `first_met_as`, feedback). Extend `lib/api.ts` / `lib/listenerApi.ts` / `lib/adminApi.ts` (typed; keep `code` on `ApiError`).

## Your lane is isolated — use ONLY its own servers and data
You work in your own git worktree on your own branch; other lanes work elsewhere at the same time and cannot disturb you, nor you them. Never touch `C:\Users\khana\Desktop\Mento` (the main checkout) or another lane's folder. Your lane's values are given in your task message: worktree path, branch, web port, API port, database name, Redis index. E2E runs must use them:
```
cd <worktree>/apps/mobile
export NODE_PATH="$HOME/.claude/skills/playwright-skill/node_modules" MENTO_WEB=http://localhost:<web> MENTO_API=http://localhost:<api>/api/v1 MENTO_DB=<db> MENTO_REDIS_DB=<n>
docker exec mento-redis redis-cli -n <n> FLUSHDB
docker exec mento-postgres psql -U mento -d <db> -c "UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;"
node e2e/<spec>.e2e.js
```
Your Expo dev server watches your worktree (started WITHOUT CI — never restart it with CI=1); verify a change is in the served bundle before trusting a spec. If your API needs a restart to pick up something, say so in your report rather than killing processes (they were started detached; logs are `<worktree>/api.err.log` and `<worktree>/expo.log`). Never run pytest, never run the seed script, never touch the `mento` database.

## Discipline
- One commit per screen, each proven before the next: `npx tsc --noEmit` clean + the specs that touch it (normal + `reducedMotion: 'reduce'`, 0 page errors). Keep every testID the existing specs rely on (read `e2e/*.js` first) or update the spec in the same commit. New flows get a new `.e2e.js` in the same plain-Node style (390×844, both motion modes, 0 page errors).
- **Look at your own work**: after each screen, screenshot the app at 390×844 and 360×740 (deviceScaleFactor 2), in EN and in HI, open the shots with the Read tool next to the artboard's intent, and fix what does not match (spacing, hierarchy, weights, radii, the pillow edge, clipping, Hindi overflow). Save shots under `<worktree>/../shots-<lane>/`. Nothing may clip or overlap at 360 wide or inside the desktop web frame (`e2e/desktop-frame.e2e.js`).
- Every new string in `locales/en.json` AND `locales/hi.json`, under a namespace that is yours (given in your task) so lanes do not collide; natural, gender-neutral Hindi; no emoji; no exclamation marks.
- Shared files other lanes also edit (`locales/*.json`, `theme/tokens.ts`, `theme/motion.ts`, `lib/api.ts`, `app/_layout.tsx`): make ADDITIVE, localized edits only (append new keys/exports at the end of the relevant block; never reorder or reformat) so the merges stay mechanical.
- Stage your own paths BY NAME; never `git add -A`; no rebase / reset / stash / push / merge; conventional commits ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not edit PROGRESS.md (I will write it at merge) — put everything in your final reply.

## Final reply
Per screen: done / partial / blocked + commit hash; what matches the board; anything that differs and exactly why, per platform; token and string additions; new/changed specs; literal tsc + spec results; screenshots you looked at (paths); what is not device-checked; open decisions for the founder.
