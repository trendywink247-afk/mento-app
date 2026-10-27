# Desktop web layout — design

**Date:** 2026-09-19 · **Status:** draft for founder review · **Source rulings (founder, session 34):** "let's fix web view on browsers too"; chose the recommended level — **centered column for the whole app + a two-pane workspace for the mentor side**. Companion to `2026-09-19-unified-domains-routes-design.md` (the "routes spec"); the workspace in §5 builds on that spec's `/mentoring` and unified `/chat/[id]`.

Source-of-truth order applies. Motion rules, the Calm register and token discipline (CLAUDE.md) bind every line below.

---

## 1. Goal

The web build is public now, and above phone width it has no layout: at 1440×900 the onboarding doors run ~1,400 px edge to edge, the back arrow and the companion sit in opposite corners of the monitor. Only `/admin` (1100), the old `/listener` console (720) and `/apply` cap their width.

Make every screen look intended in a desktop browser with **one** mechanism, and give mentors — the people who actually sit at a laptop holding several conversations — a real workspace.

## 2. Non-goals

- No per-screen desktop redesigns. No member-side two-pane (members are on phones; revisit with data).
- No change at phone width: **at ≤ 480 px the frame is a passthrough** and every existing 390×844 e2e run must behave exactly as today.
- No native tablet work. No `/admin` changes (it keeps its own wide layout).
- No fake phone bezel — a device mockup around a support conversation reads as a gimmick.

---

## 3. Layout tokens — `theme/layout.ts`

```
columnMax      480   // the app column on wide screens
workspaceMin   900   // two-pane threshold
railWidth      360   // mentor workspace left pane
readingMax     720   // widest a conversation pane may grow
```

`useLayoutMode(): 'phone' | 'column' | 'workspace'` — native is always `'phone'`; web is `'phone'` ≤ 480; `'workspace'` when width ≥ 900 **and** the device's active role is mentor **and** a listener token is on device **and** the first route segment is `mentoring` or `chat`; otherwise `'column'`. The one correction: if the routes spec's resolver (§4.2) returns `member` for the open `/chat/[id]` (a dual-role device opening its own member chat while in the mentor role), the mode drops to `'column'` — the verdict cache is a tiny subscribable store so the frame can read it. Deciding from role + token rather than waiting for the verdict means the workspace is there on the first frame — no column→workspace jump. Components consume the hook and the tokens — never raw pixel widths, same rule as colour and motion.

## 4. The frame — `components/WebFrame(.web).tsx`

Wraps the root `<Stack>` in `app/_layout.tsx`. `WebFrame.tsx` (native) is a passthrough; `WebFrame.web.tsx`:

- **Backdrop:** full window, the existing `StaticAmbient` ground. Deliberately static — a second live aurora behind the app's own would break "≤ 3 simultaneous movers" and costs GPU for decoration.
- **Column:** centered, `maxWidth: columnMax`, full height, app `bg`, `overflow: 'hidden'`, a hairline `EdgeSurface`-style edge (no `elevation.*` — that group is reserved for floating layers).
- **Exemptions:** full width when the first route segment is `admin`. In `'workspace'` mode the frame becomes two panes (§5).

Because the navigator lives *inside* the column, everything positioned against it is contained for free: the floating tab bar, `transparentModal` sheets (`start-fresh`, report, helplines, line), absolute-positioned companions (`PandaStage`), toasts.

**The one rule this adds (CLAUDE.md → conventions):** on web, *never size from the window* — `useWindowDimensions` is replaced by `useFrameSize()` (frame context fed by the column's `onLayout`; equals the window on native and in `'phone'` mode). Today's two callers move over: `components/motion/AuroraCanvas.tsx` and `app/index.tsx`.

Reduced motion: nothing to strip — the frame has no animation. First frame stays the static gradient.

## 5. Mentor workspace — the frame's second shape

`'workspace'` mode only. **URLs are identical to phone** — layout changes, routing does not. The workspace is not a screen: it is `WebFrame.web` laying out **a rail beside the navigator**.

```
┌──────────── rail 360 ────────────┬──────── pane (≤ readingMax, centered) ────────┐
│ MentorConsoleList                │ the root <Stack> — whatever route is open      │
│ presence + "your line"           │  /mentoring      → calm empty state            │
│ requests (accept / decline)      │  /chat/[id]      → MentorChatScreen            │
│ conversations (selected = [id])  │  /chat/[id]/about, report, helplines, line     │
└──────────────────────────────────┴────────────────────────────────────────────────┘
```

- The rail lives **above** the navigator, so it stays mounted while routes change in the pane — the presence heartbeat and the request poll never restart on a click. (Rendering the list inside each route's screen would remount it on every selection; that is the design this replaces.)
- Selecting a row is `router.replace('/chat/[id]')` (replace, not push — browser Back should leave the workspace, not walk the mentor's clicks). The selected row is derived from the URL, never from rail state. Accepting a request selects the new conversation; ending a chat returns to `/mentoring`.
- In workspace mode `/mentoring` renders only the empty state in the pane (companion + one line, "Pick a conversation") — its list is already in the rail. `MentorChatScreen` hides its back-to-home affordance in this mode. Both read `useLayoutMode()`; no new props.
- `/chat/[id]/about`, report, helplines and line are ordinary routes, so they open **in the pane** exactly as they do on phone. No third pane.

**Extraction this requires (targeted, not a refactor spree):** `app/mentor-home.tsx` (421 lines; `/mentoring` after the routes spec) splits into the route shell (application form / status / console gate / workspace empty state) and `components/mentor/MentorConsoleList.tsx` (presence header, requests, conversations, their polling). Phone renders the list full-screen inside the route as today; the workspace renders the same component in the rail.

Crisis cards, the member brief's privacy rules, report/end flows: unchanged — same components, same data.

## 6. Accessibility + input

Desktop means keyboard: rows and requests are `PressKey`s (already focusable on web); visible focus ring from the accent token; `Enter` sends (already proven in `two-party-chat.e2e.js`); `Esc` closes a sheet. Tab order: rail → pane.

## 7. Error / empty states

Rail load failure, no conversations, no requests: the existing still states from Mentor Home, inside the rail. Right-pane chat failure: the existing `MentorChatScreen` error state, inside the pane — the rail stays usable.

## 8. Rollout

| # | Step | Depends on |
|---|---|---|
| A | `theme/layout.ts`, `useLayoutMode`, `useFrameSize`, `WebFrame`, the two `useWindowDimensions` migrations, CLAUDE.md rule | nothing — **ship early**, the stretched layout is public today |
| B | `MentorConsoleList` extraction (no behaviour change, phone-proven) | routes spec step 2 (`/mentoring`, unified `/chat/[id]`) |
| C | workspace shape in `WebFrame.web` (rail + pane), `/mentoring` empty state, chat back-affordance rule | B |

Routes spec step 4 (deleting the old `/listener` console) waits for C.

## 9. Proof

- **Unchanged-at-phone gate:** every existing e2e script passes untouched at 390×844, normal + reduced motion, 0 page errors.
- **`desktop-frame.e2e.js`** (1440×900, normal + reduced): landing, onboarding role fork, `/chats`, `/apply` — asserts the column's bounding box is ≤ `columnMax` and centered, the tab bar and an opened sheet sit inside it, `/admin` is *not* framed; 0 page errors. Plus one 768-wide run (tablet ⇒ column).
- **`mentor-workspace.e2e.js`** (1440×900): list and chat visible together; selecting another row changes the URL to that `/chat/[id]` and the rail's DOM node survives (same element handle); accept-request selects the new chat; resize to 390 collapses to the phone flow on the same URL.
- `npx tsc --noEmit` clean. No API change ⇒ no pytest/alembic surface.

## 10. Open decisions (founder veto)

1. `columnMax` 480 / `workspaceMin` 900 / `railWidth` 360 — tuned by eye on the first build.
2. Static backdrop outside the column (not a live aurora).
3. Members stay single-column on desktop.
4. Row selection uses `replace` (browser Back leaves the workspace).
