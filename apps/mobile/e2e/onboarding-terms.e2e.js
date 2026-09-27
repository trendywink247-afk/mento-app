/**
 * The terms gate (WS3 T3.9).
 *
 * A — the member journey (any server): the age step carries the house-rules line;
 *     "Read them" opens the rules sheet (five rules + the honest draft note) and closes
 *     back onto the same step; continuing through to the end sends
 *     `terms_accepted: true` with the signup, and the account reads `terms_accepted`.
 * B — only when the API runs with TERMS_GATE_ENFORCED=true (detected, never assumed): a
 *     member who joined without accepting is asked once on the tabs ("I agree"); before
 *     agreeing no chat can start (409 terms_required), after it one can.
 *
 * Normal + reducedMotion, 390x844, 0 page errors. Part A stops at the signup request, so
 * it needs no Stream credentials.
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

async function partA(browser, reduced, label) {
  const { ctx, page, errors, tid } = await context(browser, reduced);
  try {
    await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await tid('start').click({ timeout: 90000 });
    await tid('role-talk').click();
    await page.waitForSelector('text=How old are you?', { timeout: 60000 });
    await tid('terms-notice').waitFor({ timeout: 15000 });

    await tid('terms-read').click();
    await tid('terms-modal').waitFor({ timeout: 15000 });
    const sheet = await tid('terms-modal').innerText();
    for (const line of ['18 and over.', 'Mentors are peers.', 'Stay anonymous.', 'Be kind.', 'Safety comes first.']) {
      if (!sheet.includes(line)) throw new Error(`rules sheet is missing "${line}"`);
    }
    await tid('terms-draft').waitFor({ timeout: 5000 });
    if (await tid('terms-agree').count()) throw new Error('the read-only sheet offers "I agree"');
    await tid('terms-close').click();
    await tid('terms-modal').waitFor({ state: 'detached', timeout: 15000 });
    await page.waitForSelector('text=How old are you?', { timeout: 15000 });
    console.log(`${label}: OK the age step carries the rules line; the sheet opens and closes`);

    await tid('continue').click();
    await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
    await tid('skip').click();
    await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
    await tid('animal-panda').click();
    await tid('colour-terracotta').click();
    await tid('continue').click();
    await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
    const signup = page.waitForRequest((r) => r.url().includes('/onboarding/start'), { timeout: 60000 });
    await tid('enter').click();
    const req = await signup;
    const sent = JSON.parse(req.postData() || '{}');
    if (sent.terms_accepted !== true) throw new Error(`signup did not carry terms_accepted: ${req.postData()}`);
    const res = await req.response();
    if (!res || res.status() !== 201) throw new Error(`signup → ${res && res.status()}`);
    const token = (await res.json()).session_token;
    const me = await call('GET', '/me', null, token);
    if (me.body.terms_accepted !== true) throw new Error(`account not accepted: ${JSON.stringify(me.body)}`);
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log(`${label}: OK the signup carries terms_accepted and the account records it`);
  } finally {
    await ctx.close();
  }
}

async function partB(browser, reduced, label) {
  const dob = new Date(Date.now() - 30 * 366 * 864e5).toISOString().slice(0, 10);
  const member = await call('POST', '/onboarding/start', {
    dob,
    companion_animal: 'panda',
    companion_colour: 'terracotta',
    refresh: true,
  });
  const token = member.body.session_token;
  const me = await call('GET', '/me', null, token);
  if (!me.body.terms_required) {
    console.log(`${label}: SKIP part B — the API does not enforce the gate (TERMS_GATE_ENFORCED)`);
    return;
  }
  const refused = await call('POST', '/match', { kind: 'general' }, token);
  if (refused.status !== 409 || refused.body.code !== 'terms_required') {
    throw new Error(`match before agreeing → ${refused.status} ${JSON.stringify(refused.body)}`);
  }
  const { ctx, page, errors, tid } = await context(browser, reduced);
  try {
    await ctx.addInitScript((m) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mento.session_token', m.session_token);
      localStorage.setItem('mento.refresh_token', m.refresh_token);
      localStorage.setItem('mento.stream_token', m.stream_token);
      localStorage.setItem('mento.persona', JSON.stringify(m.user));
      localStorage.setItem('mento.companion_animal', 'panda');
      localStorage.setItem('mento.companion_colour', 'terracotta');
    }, member.body);
    await page.goto(`${WEB}/journals`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await tid('terms-agree').waitFor({ timeout: 90000 });
    await tid('terms-agree').click();
    await tid('terms-modal').waitFor({ state: 'detached', timeout: 15000 });
    const after = await call('GET', '/me', null, token);
    if (!after.body.terms_accepted) throw new Error('agreeing did not record acceptance');
    const match = await call('POST', '/match', { kind: 'general' }, token);
    if (match.status === 409) throw new Error('still refused after agreeing');
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log(`${label}: OK enforced — asked once on the tabs, refused before, a chat can start after`);
  } finally {
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const reduced of [false, true]) {
      const label = reduced ? 'reduced-motion' : 'normal';
      await partA(browser, reduced, label);
      await partB(browser, reduced, label);
    }
    console.log('ONBOARDING-TERMS E2E: ALL PASS');
  } catch (e) {
    console.error('ONBOARDING-TERMS E2E FAILED', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
