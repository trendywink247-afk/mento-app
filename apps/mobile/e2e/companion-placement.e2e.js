/**
 * The companion finds a new place on every screen (founder ruling 2026-09-19;
 * lib/companionPlacement.ts + components/art/PerchedCompanion.tsx).
 *
 * Proves, at 390×844, once normally and once under reducedMotion: 'reduce', 0 page errors:
 *  - it is the MEMBER'S animal (onboards as a Fox — never a fixed cat), and on each of the four
 *    tabs exactly ONE `companion-slot-*` is showing, drawing decoded Fox art;
 *  - going back and forth lands it in at least two different slots on the same screen, never
 *    the same slot twice running, and never two companions at once;
 *  - a Fox never takes a cling slot (no art for it); the same member as a Cat does, within a
 *    bounded number of arrivals (the slot id and pose are read off the testIDs);
 *  - inside a conversation it has ONE fixed place (the composer's edge) and is not drawn while
 *    the options sheet is up;
 *  - a still state (My Chats cannot load) holds the home slot in the sit pose, every arrival;
 *  - reduced motion keeps the placement (placement is not motion) with no breathing transform;
 *    normally it breathes;
 *  - Profile's recolour reaches the account (PUT /me/companion, read back with GET /me).
 */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const TABS = ['chats', 'path', 'journals', 'profile'];
const CLING = ['dangle', 'hang', 'peek'];
const CAT_ARRIVALS = 14;

async function serverMe(token) {
  const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /me answered ${res.status}`);
  return res.json();
}

/** Every companion the member can SEE right now: [{ slot, animal, pose, decoded, src }]. */
async function companions(page) {
  return page.evaluate(() => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
        // A tab that is not focused stays mounted BEHIND the focused one (opaque, z-index -1,
        // its scene aria-hidden) — faded out normally, simply covered under reduced motion.
        if (n !== el && n.getAttribute('aria-hidden') === 'true') return false;
      }
      return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    };
    return [...document.querySelectorAll('[data-testid^="companion-slot-"]')].filter(shown).map((el) => {
      const art = el.querySelector('[data-testid^="companion-art-"]');
      const [, animal, pose] = (art ? art.getAttribute('data-testid') : '').match(/^companion-art-([^-]+)-(.+)$/) || [];
      const img = el.querySelector('img');
      return {
        slot: el.getAttribute('data-testid').replace('companion-slot-', ''),
        animal,
        pose,
        decoded: Boolean(img && img.complete && img.naturalWidth > 0),
        src: img ? decodeURIComponent(img.currentSrc || img.src) : '',
        pointerEvents: getComputedStyle(el).pointerEvents,
        hiddenFromA11y: el.getAttribute('aria-hidden') === 'true',
        height: Math.round(el.getBoundingClientRect().height),
      };
    });
  });
}

/** Arrive on a tab and return the ONE companion there (fails on zero or two). */
async function arrive(page, tab, label) {
  await page.locator(`[data-testid="tab-${tab}"]`).click();
  let seen = [];
  const deadline = Date.now() + 15000;
  // The tab hand-over is ~350 ms; the companion's own fade ≤ 200 ms. Settle, then count.
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    seen = await companions(page);
    if (seen.length === 1 && seen[0].decoded) {
      await page.waitForTimeout(450);
      const again = await companions(page);
      if (again.length === 1 && again[0].slot === seen[0].slot) return again[0];
      seen = again;
    }
  }
  throw new Error(`[${label}] ${tab}: expected exactly one companion, saw ${JSON.stringify(seen)}`);
}

async function breathScale(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="companion-breath"]')].find((n) => n.getBoundingClientRect().width > 0);
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 1;
    const m = t.match(/matrix\(([^,]+),/);
    return m ? Number(m[1]) : 1;
  });
}

async function onboardAsFox(page) {
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-fox').scrollIntoViewIfNeeded();
  await tid('animal-fox').click();
  await tid('colour-sage').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

async function run(browser, reduced, storageState) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
    ...(storageState ? { storageState } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  if (!storageState) {
    await onboardAsFox(page);

    // --- inside a conversation: ONE fixed place, and none while a sheet is up ---------------
    const inChat = [];
    for (let i = 0; i < 40 && inChat.length !== 1; i += 1) {
      await page.waitForTimeout(250);
      inChat.splice(0, inChat.length, ...(await companions(page)));
    }
    if (inChat.length !== 1 || inChat[0].slot !== 'composerTop' || inChat[0].animal !== 'Fox' || inChat[0].pose !== 'idle') {
      throw new Error(`[${label}] chat: expected the Fox on the composer's edge, saw ${JSON.stringify(inChat)}`);
    }
    await tid('open-options').click();
    await page.waitForSelector('[data-testid="options-backdrop"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    const underSheet = await companions(page);
    if (underSheet.length !== 0) throw new Error(`[${label}] chat: companion still drawn under the options sheet`);
    await tid('options-backdrop').click({ position: { x: 20, y: 20 } }); // its centre is under the sheet
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="companion-slot-composerTop"]').length === 1, null, { timeout: 15000 });
    console.log(`[${label}] OK chat: one fixed place (composerTop, Fox, idle); not drawn under the options sheet`);
  }

  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 120000 });
  await tid('tab-chats').waitFor({ timeout: 60000 });

  // --- every tab: exactly one companion, and it is the member's Fox ---------------------------
  for (const tab of TABS) {
    const c = await arrive(page, tab, label);
    if (c.animal !== 'Fox' || !/Fox/.test(c.src)) throw new Error(`[${label}] ${tab}: not the member's Fox — ${JSON.stringify(c)}`);
    if (CLING.includes(c.pose)) throw new Error(`[${label}] ${tab}: a Fox took a cling pose (${c.pose}) it has no art for`);
    if (c.pointerEvents !== 'none' && c.slot !== 'bubble') throw new Error(`[${label}] ${tab}: slot ${c.slot} can take a tap`);
    if (c.slot !== 'bubble' && !c.hiddenFromA11y) throw new Error(`[${label}] ${tab}: slot ${c.slot} is exposed to assistive tech`);
    if (c.slot !== 'inviteHero' && c.height > 72) throw new Error(`[${label}] ${tab}: perched companion is ${c.height}px tall (> 72)`);
    console.log(`[${label}] OK ${tab}: one companion — Fox, ${c.pose}, slot ${c.slot}`);
  }

  // --- back and forth: a different place each arrival, never the same twice running -------------
  for (const [tab, other] of [['journals', 'profile'], ['chats', 'path']]) {
    const walk = [];
    for (let i = 0; i < 6; i += 1) {
      await arrive(page, other, label);
      walk.push((await arrive(page, tab, label)).slot);
    }
    for (let i = 1; i < walk.length; i += 1) {
      if (walk[i] === walk[i - 1]) throw new Error(`[${label}] ${tab}: same slot twice running — ${walk.join(' → ')}`);
    }
    if (new Set(walk).size < 2) throw new Error(`[${label}] ${tab}: never moved — ${walk.join(' → ')}`);
    console.log(`[${label}] OK ${tab}: ${walk.join(' → ')}`);
  }

  // --- it stays: nothing moves it between arrivals; it breathes unless motion is reduced -----------
  const resting = await arrive(page, 'journals', label);
  const scales = [];
  for (let i = 0; i < 8; i += 1) {
    scales.push(await breathScale(page));
    await page.waitForTimeout(350);
  }
  const still = await companions(page);
  if (still.length !== 1 || still[0].slot !== resting.slot) throw new Error(`[${label}] journals: the companion moved without an arrival`);
  const moving = scales.some((s) => s !== null && Math.abs(s - 1) > 0.0005);
  if (reduced && moving) throw new Error(`[${label}] breathing transform under reduced motion: ${scales.join(', ')}`);
  if (!reduced && !moving) throw new Error(`[${label}] the companion is not breathing: ${scales.join(', ')}`);
  console.log(`[${label}] OK it stays put for 2.8 s (${resting.slot}); breathing ${reduced ? 'off' : 'on'} (${scales.map((s) => s.toFixed(4)).join(' ')})`);

  if (!reduced) {
    // --- Profile recolour reaches the account -------------------------------------------------------
    const token = await page.evaluate(() => globalThis.localStorage.getItem('mento.session_token'));
    await arrive(page, 'profile', label);
    await tid('profile-colour-plum').click();
    let me = await serverMe(token);
    for (let i = 0; i < 20 && me.companion_colour !== 'plum'; i += 1) {
      await page.waitForTimeout(250);
      me = await serverMe(token);
    }
    if (me.companion_colour !== 'plum' || me.companion_animal !== 'Fox') {
      throw new Error(`[${label}] server holds ${me.companion_animal} / ${me.companion_colour}, expected Fox / plum`);
    }
    console.log(`[${label}] OK Profile recolour is on the account (GET /me → ${me.companion_animal} / ${me.companion_colour})`);
  }

  // --- a still state: My Chats cannot load → the home slot, sitting, on every arrival ----------------
  await page.route('**/api/v1/conversations', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"e2e"}' }));
  for (let i = 0; i < 3; i += 1) {
    await arrive(page, 'path', label);
    await page.locator('[data-testid="tab-chats"]').click();
    await page.locator('[data-testid="chats-load-error"]:visible').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const held = await companions(page);
    if (held.length !== 1 || held[0].slot !== 'titleCorner' || held[0].pose !== 'idle') {
      throw new Error(`[${label}] still state: expected the home slot sitting, saw ${JSON.stringify(held)}`);
    }
  }
  await page.unroute('**/api/v1/conversations');
  console.log(`[${label}] OK load error on My Chats → home slot (titleCorner), sit pose, 3 arrivals running`);

  // --- the same member as a Cat: the cling art shows up ----------------------------------------------
  await page.evaluate(() => globalThis.localStorage.setItem('mento.companion_animal', 'Cat'));
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 120000 });
  await tid('tab-profile').waitFor({ timeout: 60000 });
  const catWalk = [];
  let clung = null;
  for (let i = 0; i < CAT_ARRIVALS && !clung; i += 1) {
    await arrive(page, i % 2 ? 'path' : 'profile', label);
    const c = await arrive(page, 'journals', label);
    if (c.animal !== 'Cat' || !/Cat/.test(c.src)) throw new Error(`[${label}] expected the Cat, saw ${JSON.stringify(c)}`);
    catWalk.push(`${c.slot}:${c.pose}`);
    if (CLING.includes(c.pose)) clung = c;
  }
  if (!clung) throw new Error(`[${label}] Cat never took a cling slot in ${CAT_ARRIVALS} arrivals — ${catWalk.join(' → ')}`);
  if (!new RegExp(`Cat/${clung.pose}`).test(clung.src) || !clung.decoded) {
    throw new Error(`[${label}] cling slot did not draw the cling art: ${JSON.stringify(clung)}`);
  }
  console.log(`[${label}] OK as a Cat: ${catWalk.join(' → ')} (cling art ${clung.pose} decoded)`);
  // Put the member back the way onboarding left them (the reduced pass reuses this state).
  await page.evaluate(() => globalThis.localStorage.setItem('mento.companion_animal', 'Fox'));

  const state = await ctx.storageState();
  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
  return state;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const state = await run(browser, false, null);
    await run(browser, true, state); // same member — one onboarding, one seat
    console.log('companion-placement: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
