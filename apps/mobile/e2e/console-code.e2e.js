/**
 * One-time mentor console links (WS3 T3.10): an approved mentor's `#code=` link opens
 * the web console ONCE — the fragment is stripped at once, the console is ready — and
 * the same link opened again (a second browser, a forwarded message) is refused with an
 * honest "expired or already used" state. The status poll carries no token at all.
 *
 * Flow per run: member onboards + applies (API) → admin approves (API) → POST
 * console-code → /listener#code=… (context 1: console-ready, no code left in the URL)
 * → same link in context 2 (console-error). Normal + reducedMotion, 390x844, 0 page
 * errors.
 *
 * REQUIRES an owner token in ADMIN_TOKEN (python -m scripts.issue_admin_token --owner
 * --name "QA"). Env: MENTO_WEB, MENTO_API.
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const TOKEN = process.env.ADMIN_TOKEN;

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

async function approvedMentorLink() {
  const dob = new Date(Date.now() - 30 * 366 * 864e5).toISOString().slice(0, 10);
  const member = await call('POST', '/onboarding/start', { dob });
  if (member.status !== 201) throw new Error(`onboarding → ${member.status}`);
  const token = member.body.session_token;
  const applied = await call(
    'POST',
    '/listener-applications',
    {
      motivation: 'I have sat my exams twice and know how long the evenings get after results.',
      communities: ['upsc'],
      availability: 'most_evenings',
      email: null,
      mentor_interest: false,
      pledge_accepted: true,
    },
    token,
  );
  if (applied.status !== 200) throw new Error(`apply → ${applied.status}`);
  const approve = await call('POST', `/admin/applications/${applied.body.id}/approve`, null, TOKEN);
  if (approve.status !== 200) throw new Error(`approve → ${approve.status}`);
  const poll = await call('GET', '/listener-applications/me', null, token);
  if (poll.body.console_url !== null || poll.body.console_active !== true) {
    throw new Error(`status poll still carries a console token: ${JSON.stringify(poll.body)}`);
  }
  if (JSON.stringify(poll.body).includes('eyJ')) throw new Error('a JWT is in the status poll');
  const code = await call('POST', '/listener-applications/me/console-code', null, token);
  if (code.status !== 200) throw new Error(`console-code → ${code.status}`);
  return code.body.console_url.replace(/^https?:\/\/[^/]+/, WEB);
}

async function open(browser, reduced, link) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 180000 });
  return { ctx, page, errors };
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const link = await approvedMentorLink();

  const first = await open(browser, reduced, link);
  try {
    await first.page.locator('[data-testid="console-ready"]').waitFor({ timeout: 90000 });
    if (first.page.url().includes('code=')) throw new Error(`code left in the URL: ${first.page.url()}`);
    if (first.errors.length) throw new Error(`page errors: ${first.errors.join(' | ')}`);
    console.log(`${label}: OK the one-time link opens the console and leaves no code behind`);
  } finally {
    await first.ctx.close();
  }

  const second = await open(browser, reduced, link);
  try {
    await second.page.locator('[data-testid="console-error"]').waitFor({ timeout: 90000 });
    const text = await second.page.locator('[data-testid="console-error"]').innerText();
    if (!/expired or was already used/.test(text)) throw new Error(`unexpected error copy: ${text}`);
    if (await second.page.locator('[data-testid="console-ready"]').count()) {
      throw new Error('a spent code opened the console');
    }
    if (second.errors.length) throw new Error(`page errors: ${second.errors.join(' | ')}`);
    console.log(`${label}: OK the same link a second time is refused`);
  } finally {
    await second.ctx.close();
  }
}

(async () => {
  if (!TOKEN) {
    console.error('ADMIN_TOKEN is required (python -m scripts.issue_admin_token --owner --name "QA")');
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('CONSOLE-CODE E2E: ALL PASS');
  } catch (e) {
    console.error('CONSOLE-CODE E2E FAILED', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
