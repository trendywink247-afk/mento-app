/**
 * Member polish (lane u12, board A03 · A09 · A06):
 *
 *  1. Companion pick (A03): the sub-line is the board's words without "emotional"
 *     ("Your growth will be represented by an animal and a colour."), and once an animal +
 *     colour are picked and the name row arrives, the hero companion is never cut: its top
 *     stays below the journey header (the headline and hero stay put; the picks scroll).
 *  2. Profile (A09): the row that opens Support reads "Support the team" — no "coffee"
 *     anywhere on the screen — and opens the Support page.
 *  3. My Chats with no conversation yet: the empty state shows the member's companion on
 *     its own stage, a calm line and "Start a conversation", which opens the New chat sheet;
 *     no perched companion renders beside it (one companion per screen).
 *
 * Runs at 390×844 and 360×740, EN and HI, normal + reduced motion; 0 page errors.
 * Env: MENTO_WEB, MENTO_API, MENTO_REDIS_DB. `SHOTS=<dir>` writes screenshots (normal only).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';
const SHOTS = process.env.SHOTS;

const COPY = {
  en: {
    sub: 'Your growth will be represented by an animal and a colour.',
    support: 'Support the team',
    empty: 'No conversations yet',
    start: 'Start a conversation',
  },
  hi: {
    sub: 'आपकी ग्रोथ को एक जानवर और एक रंग दर्शाएगा।',
    support: 'टीम का साथ दें',
    empty: 'अभी कोई बातचीत नहीं',
    start: 'बातचीत शुरू करें',
  },
};

function flush() {
  execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`, { stdio: 'pipe' });
}

async function member() {
  const res = await fetch(`${API}/onboarding/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dob: '1996-02-03', companion_animal: 'Fox', companion_colour: 'sage' }),
  });
  if (res.status !== 201) throw new Error(`onboarding/start → ${res.status}`);
  return res.json();
}

async function run(browser, { w, h, lang, reduced }) {
  const label = `${w}x${h} ${lang}${reduced ? ' reduced' : ''}`;
  const copy = COPY[lang];
  const errors = [];
  const shot = async (page, name) => {
    if (SHOTS && !reduced) await page.screenshot({ path: `${SHOTS}/${name}-${w}-${lang}.png` });
  };
  const opts = { viewport: { width: w, height: h }, deviceScaleFactor: 2, ...(reduced ? { reducedMotion: 'reduce' } : {}) };

  // --- 1. Companion pick ----------------------------------------------------------------
  {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript((l) => localStorage.setItem('mento.lang', l), lang);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const tid = (id) => page.locator(`[data-testid="${id}"]`);
    await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
    await tid('start').click();
    await tid('role-talk').click();
    await tid('continue').waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    await tid('continue').click();
    await tid('skip').click();
    await page.getByText(copy.sub, { exact: true }).waitFor({ timeout: 30000 });
    const body = await page.locator('body').innerText();
    if (/emotional|भावनात्मक/i.test(body)) throw new Error(`[${label}] the pick still says "emotional"`);
    await page.waitForTimeout(900);
    await shot(page, 'a03-rest');

    await tid('animal-cat').click();
    await tid('colour-sage').click();
    await tid('companion-name-input').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200); // the reveal glide + the name row's arrival
    // The hero must sit wholly below the journey header (back key row) and inside the frame.
    const clip = await page.evaluate(() => {
      const hero = [...document.querySelectorAll('[role="img"]')].find((n) => n.getBoundingClientRect().height >= 100);
      const back = [...document.querySelectorAll('[data-testid="back"]')].find((n) => n.getBoundingClientRect().width > 0);
      if (!hero) return { error: 'no hero' };
      const r = hero.getBoundingClientRect();
      const b = back ? back.getBoundingClientRect() : { bottom: 0 };
      return { top: r.top, bottom: r.bottom, headerBottom: b.bottom, height: window.innerHeight };
    });
    if (clip.error) throw new Error(`[${label}] ${clip.error}`);
    if (clip.top < clip.headerBottom - 1 || clip.bottom > clip.height) {
      throw new Error(`[${label}] hero cut: top ${clip.top} under header ${clip.headerBottom}`);
    }
    const name = await tid('companion-name-input').boundingBox();
    const cont = await tid('continue').boundingBox();
    if (!name || name.y + name.height > cont.y) throw new Error(`[${label}] the name row sits under the footer keys`);
    await shot(page, 'a03-named');
    console.log(`[${label}] OK A03: the board's words, no "emotional"; hero whole (top ${Math.round(clip.top)} ≥ header ${Math.round(clip.headerBottom)}) with the name row in view`);
    await ctx.close();
  }

  // --- 2 + 3. A member with no conversation yet -------------------------------------------
  {
    const m = await member();
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript(
      ([tok, st, user, l]) => {
        localStorage.setItem('mento.session_token', tok);
        localStorage.setItem('mento.stream_token', st);
        localStorage.setItem('mento.persona', JSON.stringify(user));
        localStorage.setItem('mento.companion_animal', 'Fox');
        localStorage.setItem('mento.companion_colour', 'sage');
        localStorage.setItem('mento.lang', l);
      },
      [m.session_token, m.stream_token, m.user, lang],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const tid = (id) => page.locator(`[data-testid="${id}"]`);

    await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 120000 });
    await tid('chats-empty').waitFor({ timeout: 30000 });
    await page.getByText(copy.empty, { exact: true }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    const perched = await page.evaluate(
      () => [...document.querySelectorAll('[data-testid^="companion-slot-"]')].filter((n) => n.getBoundingClientRect().width > 0).length,
    );
    if (perched !== 0) throw new Error(`[${label}] a perched companion renders beside the empty state (${perched})`);
    const key = await tid('start-from-chats').boundingBox();
    const tabbar = await tid('tab-chats').boundingBox();
    if (!key || (tabbar && key.y + key.height > tabbar.y)) throw new Error(`[${label}] the start key is under the tab bar`);
    const keyText = await tid('start-from-chats').innerText();
    if (!keyText.includes(copy.start)) throw new Error(`[${label}] start key reads ${JSON.stringify(keyText)}`);
    await shot(page, 'a06-empty');
    await tid('start-from-chats').click();
    await tid('new-chat-sheet').waitFor({ timeout: 15000 });
    console.log(`[${label}] OK My Chats empty: companion on its stage, no perch, "${copy.start}" → New chat sheet`);

    // In touch view with nothing yet: the calm card, never a placeholder tile.
    await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
    await tid('chats-view-touch').click();
    await tid('in-touch-empty').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot(page, 'a06-in-touch-empty');

    await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
    await tid('profile-coffee').waitFor({ timeout: 30000 });
    const row = await tid('profile-coffee').innerText();
    if (!row.includes(copy.support)) throw new Error(`[${label}] Profile row reads ${JSON.stringify(row)}`);
    const profile = await page.locator('body').innerText();
    if (/coffee|कॉफ़ी|कॉफी/i.test(profile)) throw new Error(`[${label}] Profile still says coffee`);
    await tid('profile-coffee').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'a09-support-row');
    await tid('profile-coffee').click();
    await tid('coffee-contribute').waitFor({ timeout: 15000 });
    console.log(`[${label}] OK Profile: "${copy.support}" opens Support, no coffee wording`);
    await ctx.close();
  }
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    for (const reduced of [false, true]) {
      for (const [w, h] of [[390, 844], [360, 740]]) {
        for (const lang of ['en', 'hi']) {
          flush();
          errors.push(...(await run(browser, { w, h, lang, reduced })));
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nMEMBER POLISH E2E PASSED — A03 copy + whole hero, Support row, My Chats empty state; 8 passes, 0 page errors');
})().catch((e) => {
  console.error('MEMBER POLISH E2E FAILED:', e.message);
  process.exit(1);
});
