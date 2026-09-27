/**
 * The recovery code (WS3 T3.5), across two "phones":
 *  A. a member (refreshing session, seeded) opens Profile → "Make a recovery code" → the
 *     code shows once with "Mento will never ask you for this" → "I've saved it" hides it;
 *  B. a fresh browser: landing → "I have a recovery code" → a wrong code is a still line →
 *     the right code (typed in lower case with spaces — forgiven) → My Chats, signed in as
 *     the SAME member;
 *  and A's refresh token is now dead (every other session is signed out).
 * Normal + reducedMotion, 390x844, 0 page errors. No Stream needed.
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

async function call(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const sub = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

async function context(browser, reduced) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors, tid: (id) => page.locator(`[data-testid="${id}"]`) };
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const dob = new Date(Date.now() - 30 * 366 * 864e5).toISOString().slice(0, 10);
  const member = (
    await call('POST', '/onboarding/start', {
      dob,
      companion_animal: 'fox',
      companion_colour: 'terracotta',
      refresh: true,
    })
  ).body;

  // A — make the code on Profile.
  const a = await context(browser, reduced);
  let phrase;
  try {
    await a.ctx.addInitScript((m) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mento.session_token', m.session_token);
      localStorage.setItem('mento.refresh_token', m.refresh_token);
      localStorage.setItem('mento.stream_token', m.stream_token);
      localStorage.setItem('mento.persona', JSON.stringify(m.user));
      localStorage.setItem('mento.companion_animal', 'fox');
      localStorage.setItem('mento.companion_colour', 'terracotta');
    }, member);
    await a.page.goto(`${WEB}/profile`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await a.tid('recovery-make').waitFor({ timeout: 90000 });
    await a.tid('recovery-make').scrollIntoViewIfNeeded();
    await a.tid('recovery-make').click();
    await a.tid('recovery-phrase').waitFor({ timeout: 15000 });
    phrase = (await a.tid('recovery-phrase').innerText()).trim();
    if (!/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/.test(phrase)) throw new Error(`odd code: ${phrase}`);
    const never = await a.tid('recovery-never-ask').innerText();
    if (!never.includes('Mento will never ask you for this')) throw new Error(`missing line: ${never}`);
    await a.tid('recovery-done').click();
    await a.tid('recovery-phrase').waitFor({ state: 'detached', timeout: 10000 });
    if (a.errors.length) throw new Error(`page errors (A): ${a.errors.join(' | ')}`);
    console.log(`${label}: OK Profile makes a code, shows it once with "never ask", then hides it`);
  } finally {
    await a.ctx.close();
  }

  // B — a fresh browser comes back with it.
  const b = await context(browser, reduced);
  try {
    await b.page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await b.tid('landing-recover').click({ timeout: 90000 });
    await b.tid('recover-input').waitFor({ timeout: 30000 });
    await b.tid('recover-input').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await b.tid('recover-submit').click();
    await b.tid('recover-problem').waitFor({ timeout: 15000 });
    if (!(await b.tid('recover-problem').innerText()).includes('did not work')) {
      throw new Error('a wrong code did not say so');
    }
    await b.tid('recover-input').fill(phrase.toLowerCase().replace(/-/g, ' '));
    await b.tid('recover-submit').click();
    await b.page.waitForURL((u) => u.pathname.endsWith('/chats'), { timeout: 60000 });
    const token = await b.page.evaluate(() => localStorage.getItem('mento.session_token'));
    if (sub(token) !== member.user.id) throw new Error('signed in as someone else');
    if (!(await b.page.evaluate(() => localStorage.getItem('mento.refresh_token')))) {
      throw new Error('no refresh token after recovery');
    }
    if (b.errors.length) throw new Error(`page errors (B): ${b.errors.join(' | ')}`);
    console.log(`${label}: OK a new browser comes back as the same member (lower case + spaces forgiven)`);
  } finally {
    await b.ctx.close();
  }

  const old = await call('POST', '/auth/refresh', { refresh_token: member.refresh_token });
  if (old.status !== 401) throw new Error(`A's refresh token survived recovery: ${old.status}`);
  console.log(`${label}: OK every other session was signed out`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('RECOVERY-CODE E2E: ALL PASS');
  } catch (e) {
    console.error('RECOVERY-CODE E2E FAILED', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
