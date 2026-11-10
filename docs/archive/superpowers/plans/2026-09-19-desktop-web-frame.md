# Desktop Web Frame (layout spec step A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a wide browser window the whole app sits in a centered 480 px column over a still ambient ground; phones and native are untouched; `/admin` keeps its own wide layout.

**Architecture:** One `WebFrame` wraps the root `<Stack>` in `app/_layout.tsx`. Its tree shape never changes (only styles do), so resizing across the breakpoint or visiting `/admin` never remounts the navigator. Because the navigator lives inside the column, the tab bar, transparent-modal sheets and absolutely-positioned art are contained for free. The two components that size themselves from the window switch to `useFrameSize()`, which the frame computes synchronously (`min(window, columnMax)`) — correct on the first frame, no `onLayout` round-trip.

**Tech Stack:** Expo SDK 52, expo-router 4, react-native-web, Playwright (global install, plain Node script).

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-web-layout-design.md` §3, §4, §8 step A, §9. The `'workspace'` mode and `useLayoutMode()` are step C — **not built here** (nothing would consume them yet).

---

## Ground rules

- Work in this worktree on branch `feat/desktop-web-frame` (stacked on `worktree-unified-domains`). Another session owns the main checkout and the dev servers on **:8000 / :8081** — never stop or restart them.
- This worktree's Expo web server runs on **:8082**. `apps/mobile/.env` is gitignored, so copy it once from the main checkout (Task 0).
- The existing e2e scripts hardcode `:8081` (the other session's build) and that session is editing them — do **not** touch them. The new script reads `MENTO_WEB` and carries the unchanged-at-phone assertions itself. The full existing suite is a **pre-merge gate**, run against this branch once the shared stack is free.
- Mento rules that bind here: tokens not raw numbers (`theme/layout.ts`), one component per file, no animation in the frame (first frame = the static gradient), no `elevation.*` on the column.

## File structure

| File | Responsibility |
|---|---|
| `apps/mobile/theme/layout.ts` (new) | layout tokens: `columnMax`, plus the step-C values the spec fixed |
| `apps/mobile/lib/useFrameSize.ts` (new) | `FrameSizeContext` + `useFrameSize()` — the size a screen may draw into |
| `apps/mobile/components/WebFrame.tsx` (new) | native: passthrough |
| `apps/mobile/components/WebFrame.web.tsx` (new) | web: backdrop + centered column + frame-size provider |
| `apps/mobile/app/_layout.tsx` | wrap `<Stack>` in `<WebFrame>` |
| `apps/mobile/app/index.tsx`, `components/motion/AuroraCanvas.tsx` | `useWindowDimensions` → `useFrameSize` |
| `apps/mobile/e2e/desktop-frame.e2e.js` (new) | the proof, 4 viewports × (normal, reduced motion) |
| `CLAUDE.md` | the "never size from the window" convention + layout entries |

---

### Task 0: Workspace

- [ ] **Step 1:** `apps/mobile/node_modules` exists (`npm ci` — `.npmrc` + `patches/` apply via postinstall). Expected: exit 0 and `patch-package` lines in the log.
- [ ] **Step 2:** Copy the gitignored env: read `C:/Users/khana/Desktop/Mento/apps/mobile/.env`, write the same content to `apps/mobile/.env` in this worktree. Confirm `git status --short` shows nothing (still ignored).
- [ ] **Step 3:** Baseline: `cd apps/mobile && npx tsc --noEmit` → exit 0, no output.

---

### Task 1: The failing proof

**Files:** Create `apps/mobile/e2e/desktop-frame.e2e.js`

- [ ] **Step 1: Write the script**

```js
// Desktop web frame proof (spec 2026-09-19-desktop-web-layout §9).
// Run:  MENTO_WEB=http://localhost:8082 NODE_PATH=<playwright>/node_modules node e2e/desktop-frame.e2e.js
// Read-only: never submits a form. Asserts, per viewport, normal + reduced motion:
//   - the app column's box (≤ columnMax, centered) — or the full window on phones and /admin
//   - the landing's Start key and an opened sheet sit inside the column
//   - landing → Start → role fork works; 0 page errors.
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const COLUMN_MAX = 480; // theme/layout.ts

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, column: 390 },
  { name: 'tablet', width: 768, height: 1024, column: COLUMN_MAX },
  { name: 'desktop', width: 1440, height: 900, column: COLUMN_MAX },
];

const near = (a, b) => Math.abs(a - b) <= 1;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures.push(label);
  };

  for (const vp of VIEWPORTS) {
    for (const motion of ['no-preference', 'reduce']) {
      const tag = `[${vp.name}${motion === 'reduce' ? ' reduced' : ''}]`;
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        reducedMotion: motion,
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const tid = (id) => page.locator(`[data-testid="${id}"]`);
      const inColumn = (box, col) => box.x >= col.x - 1 && box.x + box.width <= col.x + col.width + 1;

      await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
      await tid('start').waitFor({ state: 'visible', timeout: 60000 });
      const col = await tid('web-frame-column').boundingBox();
      check(`${tag} column width ${vp.column}`, !!col && near(col.width, vp.column), JSON.stringify(col));
      check(`${tag} column centered`, !!col && near(col.x, (vp.width - vp.column) / 2), JSON.stringify(col));
      check(`${tag} column full height`, !!col && near(col.height, vp.height), JSON.stringify(col));
      const startBox = await tid('start').boundingBox();
      check(`${tag} Start key inside the column`, !!startBox && inColumn(startBox, col), JSON.stringify(startBox));

      await tid('start').click();
      await page.waitForURL(/\/onboarding/, { timeout: 30000 });
      await page.waitForTimeout(1500);
      const widest = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll('[role="button"], button')].map((el) => el.getBoundingClientRect().width), 0),
      );
      check(`${tag} role-fork doors no wider than the column`, widest > 0 && widest <= vp.column + 1, `widest=${widest}`);

      // A transparent-modal sheet must open inside the column, not across the window.
      await page.goto(`${WEB}/start-fresh`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(1200);
      const sheetWidest = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll('[role="button"], button')].map((el) => el.getBoundingClientRect().right), 0),
      );
      const col2 = await tid('web-frame-column').boundingBox();
      check(`${tag} sheet content inside the column`, !!col2 && sheetWidest <= col2.x + col2.width + 1, `right=${sheetWidest} col=${JSON.stringify(col2)}`);

      // /admin keeps its own wide layout.
      await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(800);
      const adminCol = await tid('web-frame-column').boundingBox();
      check(`${tag} /admin is not framed`, !!adminCol && near(adminCol.width, vp.width), JSON.stringify(adminCol));

      check(`${tag} 0 page errors`, pageErrors.length === 0, pageErrors.join(' | '));
      await ctx.close();
    }
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
```

- [ ] **Step 2: Start this worktree's web server** (background): `cd apps/mobile && npx expo start --web --port 8082`. Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:8082/` prints `200`.

- [ ] **Step 3: Run — verify it fails for the right reason**

Run: `MENTO_WEB=http://localhost:8082 NODE_PATH=C:/Users/khana/.claude/skills/playwright-skill/node_modules node e2e/desktop-frame.e2e.js`
Expected: `FAIL … column width …` lines with detail `null` (no `web-frame-column` exists yet); exit 1.

- [ ] **Step 4: Commit** — `git add apps/mobile/e2e/desktop-frame.e2e.js && git commit -m "test(e2e): desktop web frame proof (failing: no frame yet)"`

---

### Task 2: Tokens, the frame-size hook, the frame

**Files:** Create `theme/layout.ts`, `lib/useFrameSize.ts`, `components/WebFrame.tsx`, `components/WebFrame.web.tsx`; modify `app/_layout.tsx`.

- [ ] **Step 1: `apps/mobile/theme/layout.ts`**

```ts
/**
 * Layout tokens for wide screens (spec 2026-09-19-desktop-web-layout §3). Phones and
 * native never see these — below `columnMax` the web frame is a passthrough.
 * Components consume these, never raw pixel widths (same rule as colour and motion).
 */
export const layout = {
  /** The app column on wide screens. */
  columnMax: 480,
  /** Two-pane mentor workspace threshold (layout spec step C). */
  workspaceMin: 900,
  /** Mentor workspace left rail (step C). */
  railWidth: 360,
  /** Widest a conversation pane may grow (step C). */
  readingMax: 720,
} as const;
```

- [ ] **Step 2: `apps/mobile/lib/useFrameSize.ts`**

```ts
/**
 * The size a screen may draw into. On web above `layout.columnMax` that is the app
 * column, not the browser window — so NEVER size from `useWindowDimensions` in a
 * screen or a piece of art; use this. Native, phone-width web and /admin have no
 * frame, and this falls through to the window.
 */
import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

export type FrameSize = { width: number; height: number };

/** null = unframed (native, phone-width web, /admin). Provided by components/WebFrame.web. */
export const FrameSizeContext = createContext<FrameSize | null>(null);

export function useFrameSize(): FrameSize {
  const frame = useContext(FrameSizeContext);
  const { width, height } = useWindowDimensions();
  return frame ?? { width, height };
}
```

- [ ] **Step 3: `apps/mobile/components/WebFrame.tsx`** (native)

```tsx
import type { ReactNode } from 'react';

/** Native: no frame — the device is the column. Web: see WebFrame.web.tsx. */
export function WebFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 4: `apps/mobile/components/WebFrame.web.tsx`**

```tsx
/**
 * WebFrame (web) — on a wide window the whole app sits in a centered column over a
 * still ambient ground (spec 2026-09-19-desktop-web-layout §4). The navigator lives
 * INSIDE the column, so the tab bar, transparent-modal sheets and absolutely
 * positioned art are contained for free.
 *
 * The tree shape never changes — only styles do — so resizing across the breakpoint
 * or opening /admin never remounts the navigator. No animation: the frame's first
 * frame is its only frame. The backdrop is deliberately static; a second live
 * aurora behind the app's own would break "≤ 3 simultaneous movers".
 */
import { useSegments } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { StaticAmbient } from '@/components/motion/StaticAmbient';
import { FrameSizeContext, type FrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/layout';

export function WebFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const segments = useSegments();
  const { colors } = useTheme();

  // /admin keeps its own wide layout; at phone width the window IS the column.
  const framed = width > layout.columnMax && segments[0] !== 'admin';
  const frameSize = useMemo<FrameSize | null>(
    () => (framed ? { width: layout.columnMax, height } : null),
    [framed, height],
  );

  return (
    <View style={styles.window}>
      {framed ? <StaticAmbient /> : null}
      <View
        testID="web-frame-column"
        style={[
          styles.column,
          framed && {
            maxWidth: layout.columnMax,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderRightWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <FrameSizeContext.Provider value={frameSize}>{children}</FrameSizeContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1 },
  column: { flex: 1, width: '100%', alignSelf: 'center', overflow: 'hidden' },
});
```

- [ ] **Step 5: `apps/mobile/app/_layout.tsx`** — add `import { WebFrame } from '@/components/WebFrame';` after the `AppProviders` import, and wrap the navigator: inside `<ThemeProvider>`, keep `<StatusBar style="dark" />`, then `<WebFrame>` … the whole `<Stack>…</Stack>` … `</WebFrame>`. Add the comment `{/* Web: centered app column on wide windows (passthrough on native + phones). */}` above `<WebFrame>`.

- [ ] **Step 6:** `npx tsc --noEmit` → exit 0.

- [ ] **Step 7: Run the proof.** Expected now: every `column …`, `Start key`, `role-fork doors`, `sheet`, `/admin` and `0 page errors` line is `ok` for all 6 runs → `ALL PASS`. If a `role-fork doors` or `sheet` check fails, something measures the window — fix it in Task 3, not by loosening the check.

- [ ] **Step 8: Commit** — `git add apps/mobile/theme/layout.ts apps/mobile/lib/useFrameSize.ts apps/mobile/components/WebFrame.tsx apps/mobile/components/WebFrame.web.tsx apps/mobile/app/_layout.tsx && git commit -m "feat(web): centered app column on wide windows — WebFrame + layout tokens + useFrameSize"`

---

### Task 3: Nothing sizes from the window

**Files:** Modify `apps/mobile/app/index.tsx`, `apps/mobile/components/motion/AuroraCanvas.tsx`.

- [ ] **Step 1: `app/index.tsx`** — remove `useWindowDimensions` from the `react-native` import; add `import { useFrameSize } from '@/lib/useFrameSize';`; replace `const { width } = useWindowDimensions();` with `const { width } = useFrameSize();` (it feeds `<MountainsScene width={width + 24} …>`, which would otherwise be drawn 1,464 px wide inside a 480 px column).
- [ ] **Step 2: `components/motion/AuroraCanvas.tsx`** — same swap: drop `useWindowDimensions` from the import, add the `useFrameSize` import, `const { width, height } = useFrameSize();`.
- [ ] **Step 3: Prove no screen or art still measures the window**

Run: `grep -rn "useWindowDimensions" apps/mobile/app apps/mobile/components apps/mobile/lib`
Expected: exactly two hits — `lib/useFrameSize.ts` and `components/WebFrame.web.tsx`.

- [ ] **Step 4:** `npx tsc --noEmit` → exit 0. Re-run the proof → `ALL PASS`.
- [ ] **Step 5: Look at it.** Screenshot `/` and `/onboarding` at 1440×900 from :8082 and read both images: column centered, ground visible either side, mountains not clipped, companion inside the column.
- [ ] **Step 6: Commit** — `git add apps/mobile/app/index.tsx apps/mobile/components/motion/AuroraCanvas.tsx && git commit -m "fix(web): landing hero + aurora size from the frame, not the window"`

---

### Task 4: Convention + docs

- [ ] **Step 1: `CLAUDE.md` → Coding conventions**, after the "**Web/native splits**" bullet, add:

`- **Never size from the window on web.** Above \`layout.columnMax\` (480) the app draws into a centered column (\`components/WebFrame.web.tsx\`), so screens and art use \`useFrameSize()\` (\`lib/useFrameSize.ts\`), never \`useWindowDimensions\`. Widths come from \`theme/layout.ts\`, like colours and durations come from their tokens. \`/admin\` is exempt (own wide layout). Proof: \`e2e/desktop-frame.e2e.js\` (\`MENTO_WEB\` selects the server).`

- [ ] **Step 2: `CLAUDE.md` → Repo layout:** in the `theme/` line append ` · layout.ts`; in the `lib/` line append ` · useFrameSize`; in the `e2e/` list append ` · desktop-frame`; in `components/` add `WebFrame(.web)` next to the top-level components mention.
- [ ] **Step 3: `PROGRESS.md`** — entry per the `mento-session-end` skill: Done / proofs (literal) / pre-merge gate (full existing e2e suite against this branch) / Open decisions (`columnMax` 480, static backdrop, hairline edge).
- [ ] **Step 4: Commit** — `git add CLAUDE.md PROGRESS.md && git commit -m "docs: never-size-from-the-window convention; desktop frame logged"`

---

## Self-review (done while writing)

- **Spec coverage:** §3 tokens → Task 2.1 · §4 frame, exemptions, containment, static backdrop → Tasks 2.4–2.5 + the sheet/admin checks · §4 "never size from the window" → Task 3 + Task 4.1 · §9 unchanged-at-phone + desktop-frame proof incl. the 768 run → Task 1. `useLayoutMode` / workspace (§5) deliberately deferred to step C. `/chats` (needs a session → writes to the shared dev API) is covered by the pre-merge gate, not this script.
- **Names consistent:** `layout.columnMax`, `FrameSizeContext`, `useFrameSize`, `WebFrame`, testID `web-frame-column` — identical in tokens, hook, frame, proof and docs.
- **No placeholders:** every code step has its code; every run has its expected output.
