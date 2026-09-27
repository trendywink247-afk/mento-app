/**
 * Refreshing sessions (WS3 T3.2) — the "no forced logout" proof, on a screen that
 * needs no chat (so it runs without Stream credentials):
 *
 *  A. a pre-refresh install (long-lived token, no refresh token) opens Journals: the
 *     screen loads, the app upgrades silently in the background, and the old token
 *     still works on the server;
 *  B. a stale access token + a live refresh token: the 401 is refreshed and retried —
 *     the screen loads and the refresh token has rotated;
 *  C. the same, with /auth/refresh unreachable: the member is NOT signed out (tokens
 *     kept, never sent to the landing);
 *  D. a dead refresh family: the old behaviour — signed out, back to the landing.
 *
 * Normal + reducedMotion runs, 390x844, 0 page errors.
 * Needs the API on :8000 (MENTO_API) and Expo web on :8081 (MENTO_WEB).
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

function adultDob() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 30);
  return d.toISOString().slice(0, 10);
}

async function onboard(refresh) {
  const res = await fetch(`${API}/onboarding/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dob: adultDob(), companion_animal: 'panda', companion_colour: 'terracotta', refresh }),
  });
  if (res.status !== 201) throw new Error(`onboarding/start → ${res.status}`);
  return res.json();
}

function claims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

async function seed(ctx, body, overrides = {}) {
  const store = {
    'mento.session_token': body.session_token,
    'mento.stream_token': body.stream_token,
    'mento.persona': JSON.stringify(body.user),
    'mento.companion_animal': 'panda',
    'mento.companion_colour': 'terracotta',
    ...(body.refresh_token ? { 'mento.refresh_token': body.refresh_token } : {}),
    ...overrides,
  };
  await ctx.addInitScript((entries) => {
    if (sessionStorage.getItem('seeded')) return; // only the first load
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, store);
}

const read = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

async function scenario(browser, reduced, name, setup, check) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    const state = await setup(ctx, page);
    await page.goto(`${WEB}/journals`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await check(page, state);
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log(`${reduced ? 'reduced-motion' : 'normal'}: OK ${name}`);
  } finally {
    await ctx.close();
  }
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`).first();

async function run(browser, reduced) {
  await scenario(
    browser,
    reduced,
    'A — a pre-refresh install loads and upgrades silently',
    async (ctx) => {
      const legacy = await onboard(false);
      if (legacy.refresh_token) throw new Error('legacy onboarding returned a refresh token');
      await seed(ctx, legacy);
      return legacy;
    },
    async (page, legacy) => {
      await tid(page, 'journal-today').waitFor({ timeout: 90000 });
      await page.waitForFunction(() => !!localStorage.getItem('mento.refresh_token'), null, {
        timeout: 20000,
      });
      const access = await read(page, 'mento.session_token');
      if (access === legacy.session_token) throw new Error('session token was not swapped');
      if (!claims(access).sid) throw new Error('swapped token is not an access token');
      if (!page.url().includes('/journals')) throw new Error(`left Journals: ${page.url()}`);
      const me = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${legacy.session_token}` } });
      if (me.status !== 200) throw new Error(`legacy token stopped working: ${me.status}`);
    },
  );

  await scenario(
    browser,
    reduced,
    'B — a stale access token is refreshed and the call retried',
    async (ctx) => {
      const body = await onboard(true);
      if (!body.refresh_token) throw new Error('refresh onboarding returned no refresh token');
      await seed(ctx, body, { 'mento.session_token': 'stale.access.token' });
      return body;
    },
    async (page, body) => {
      await tid(page, 'journal-today').waitFor({ timeout: 90000 });
      await page.waitForFunction(
        (old) => localStorage.getItem('mento.refresh_token') !== old,
        body.refresh_token,
        { timeout: 20000 },
      );
      if (!page.url().includes('/journals')) throw new Error(`left Journals: ${page.url()}`);
      // The rotated-away token is spent: presenting it again would be reuse.
      const access = await read(page, 'mento.session_token');
      const me = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${access}` } });
      if (me.status !== 200) throw new Error(`refreshed access token rejected: ${me.status}`);
    },
  );

  await scenario(
    browser,
    reduced,
    'C — /auth/refresh unreachable: the member stays signed in',
    async (ctx, page) => {
      const body = await onboard(true);
      await seed(ctx, body, { 'mento.session_token': 'stale.access.token' });
      await page.route('**/auth/refresh', (route) => route.abort('internetdisconnected'));
      return body;
    },
    async (page, body) => {
      await page.waitForTimeout(8000);
      if (await tid(page, 'start').isVisible().catch(() => false)) {
        throw new Error('a network failure sent the member to the landing');
      }
      if ((await read(page, 'mento.refresh_token')) !== body.refresh_token) {
        throw new Error('refresh token was cleared or changed on a network failure');
      }
      if (!(await read(page, 'mento.session_token'))) throw new Error('session cleared offline');
    },
  );

  await scenario(
    browser,
    reduced,
    'D — a dead refresh family falls back to the old sign-out',
    async (ctx) => {
      const body = await onboard(true);
      await seed(ctx, body, {
        'mento.session_token': 'stale.access.token',
        'mento.refresh_token': 'mr1.revoked-or-unknown',
      });
      return body;
    },
    async (page) => {
      await tid(page, 'start').waitFor({ timeout: 90000 });
      await page.waitForFunction(() => !localStorage.getItem('mento.session_token'), null, {
        timeout: 20000,
      });
      if (await read(page, 'mento.refresh_token')) throw new Error('dead refresh token kept');
    },
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('SESSION-REFRESH E2E: ALL PASS');
  } catch (e) {
    console.error('SESSION-REFRESH E2E FAILED', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
