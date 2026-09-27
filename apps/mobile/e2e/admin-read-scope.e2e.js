/**
 * Scoped admin conversation reads (WS3 T3.12): the Safety panel opens a flagged
 * conversation only after the reviewer states a reason (the server writes it into the
 * audit trail), and the server refuses a read with no open case or no reason.
 *
 * Flow: a member onboards and matches (API), a crisis scan flags that conversation →
 * /admin → Safety → the flag's "Open conversation" is disabled until a reason of 8+
 * characters is typed → opening sends the reason and gets 200. Then, straight at the
 * API: no reason → 422; a conversation with no open case → 403 `no_open_case`.
 * Normal + reducedMotion, 390x844, 0 page errors.
 *
 * REQUIRES an owner token in ADMIN_TOKEN, minted against the same DB the API uses:
 *   python -m scripts.issue_admin_token --owner --name "QA Owner"
 * Needs seeded, online listeners (the match). Env: MENTO_WEB, MENTO_API, ADMIN_TOKEN.
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const TOKEN = process.env.ADMIN_TOKEN;
const REASON = 'reviewing the open crisis flag';

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

async function flaggedConversation() {
  const dob = new Date(Date.now() - 30 * 366 * 864e5).toISOString().slice(0, 10);
  const member = await call('POST', '/onboarding/start', { dob });
  if (member.status !== 201) throw new Error(`onboarding → ${member.status}`);
  const token = member.body.session_token;
  const match = await call('POST', '/match', { kind: 'general' }, token);
  if (match.status !== 200) throw new Error(`match → ${match.status} (seed listeners?)`);
  const convo = match.body.conversation_id;
  const scan = await call(
    'POST',
    '/safety/scan',
    { text: 'I want to end my life', conversation_id: convo },
    token,
  );
  if (!scan.body?.triggered) throw new Error('crisis scan did not flag');
  return { convo, member: token };
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const { convo, member } = await flaggedConversation();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const reads = [];
  page.on('response', (r) => {
    if (r.url().includes(`/admin/conversations/${convo}/messages`)) reads.push(r);
  });
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  try {
    await page.goto(`${WEB}/admin#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await tid('admin-ready').waitFor({ timeout: 90000 });
    await tid('admin-tab-safety').click();
    await tid('admin-panel-safety').waitFor({ timeout: 15000 });

    // The flag for OUR conversation: its card holds the open button.
    const flags = await call('GET', '/admin/safety/flags?reviewed=false', null, TOKEN);
    const flag = (flags.body || []).find((f) => f.conversation_id === convo);
    if (!flag) throw new Error('our flag is not in the admin queue');

    const open = tid(`admin-flag-open-${flag.id}`);
    await open.waitFor({ timeout: 15000 });
    if ((await open.getAttribute('aria-disabled')) !== 'true') {
      throw new Error('Open conversation is enabled with no reason');
    }
    await tid(`admin-flag-reason-${flag.id}`).fill('look'); // too short
    if ((await open.getAttribute('aria-disabled')) !== 'true') {
      throw new Error('Open conversation is enabled with a 4-character reason');
    }
    await tid(`admin-flag-reason-${flag.id}`).fill(REASON);
    await page.waitForFunction(
      (id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-disabled') !== 'true',
      `admin-flag-open-${flag.id}`,
      { timeout: 5000 },
    );
    await open.click();
    await page.waitForFunction(() => document.body.innerText.includes('Hide conversation'), null, {
      timeout: 15000,
    });
    await page.waitForTimeout(500);
    if (reads.length !== 1) throw new Error(`expected one read, saw ${reads.length}`);
    if (reads[0].status() !== 200) throw new Error(`read → ${reads[0].status()}`);
    const sent = new URL(reads[0].url()).searchParams.get('reason');
    if (sent !== REASON) throw new Error(`reason not sent: ${sent}`);
    console.log(`${label}: OK the panel gates Open on a reason and sends it`);

    // Server-side scope, straight at the API.
    const noReason = await call('GET', `/admin/conversations/${convo}/messages`, null, TOKEN);
    if (noReason.status !== 422) throw new Error(`no reason → ${noReason.status}`);
    const match2 = await call('POST', '/match', { kind: 'general' }, member);
    const clean = match2.status === 200 ? match2.body.conversation_id : null;
    if (clean && clean !== convo) {
      const noCase = await call(
        'GET',
        `/admin/conversations/${clean}/messages?reason=${encodeURIComponent(REASON)}`,
        null,
        TOKEN,
      );
      if (noCase.status !== 403 || noCase.body?.code !== 'no_open_case') {
        throw new Error(`no open case → ${noCase.status} ${JSON.stringify(noCase.body)}`);
      }
      console.log(`${label}: OK the API refuses no reason (422) and no open case (403)`);
    } else {
      console.log(`${label}: OK the API refuses no reason (422) (no second chat to test 403)`);
    }
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    await ctx.close();
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
    console.log('ADMIN-READ-SCOPE E2E: ALL PASS');
  } catch (e) {
    console.error('ADMIN-READ-SCOPE E2E FAILED', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
