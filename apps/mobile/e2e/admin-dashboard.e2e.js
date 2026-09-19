/**
 * Admin dashboard smoke: token-link auth, then click through every tab asserting each
 * renders with 0 page errors. Web-only surface.
 *
 * Board port (2026-09-19): the Allowance (A13) and Feedback panels are opened with seeded
 * data — a member is minted through the API, posts one feedback note (unique per run) and
 * gets a ledger row for today (three in a row, one crisis-exempt send) — and the panels
 * must show it: the note's text, and counts at least as big as what was seeded. Neither
 * panel may carry a member's persona name (numbers only / no author).
 *
 * REQUIRES an owner token in ADMIN_TOKEN, minted against the same DB the API uses:
 *   python -m scripts.issue_admin_token --owner --name "QA Owner"
 * Env: MENTO_WEB, MENTO_API, MENTO_DB, ADMIN_TOKEN, SHOTS=<dir> for 1440-wide screenshots.
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const DB = process.env.MENTO_DB || 'mento';
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = process.env.SHOTS;
const TABS = ['overview', 'safety', 'moderation', 'listeners', 'contributions', 'health', 'allowance', 'feedback', 'admins'];

function psql(sql) {
  return execSync(`docker exec mento-postgres psql -U mento -d ${DB} -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
}

async function post(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

/** A member, one feedback note, and today's ledger row: three in a row + one crisis-exempt. */
async function seed() {
  const member = await post('/onboarding/start', { dob: '1995-04-12' });
  // Letters only: a long digit run would be redacted as a phone number before saving.
  const note = `The journal did not say it saved, run ${Date.now().toString(36).replace(/[0-9]/g, (d) => "abcdefghij"[d])}`;
  const fb = await post('/feedback', { category: 'confusing', text: note, screen: '(tabs)/journals', app_version: 'e2e' }, member.session_token);
  if (fb.status !== 'received') throw new Error(`feedback not received: ${JSON.stringify(fb)}`);
  const uid = member.user.id;
  psql(
    `INSERT INTO message_allowance_days (user_id, day, sent, crisis_exempt, row_cap_hits, day_cap_hits, reached_day_cap, created_at, updated_at) ` +
      `VALUES ('${uid}', (now() AT TIME ZONE 'Asia/Kolkata')::date, 3, 1, 1, 0, false, now(), now()) ` +
      `ON CONFLICT (user_id, day) DO UPDATE SET sent = message_allowance_days.sent + 3, crisis_exempt = message_allowance_days.crisis_exempt + 1, row_cap_hits = message_allowance_days.row_cap_hits + 1;`,
  );
  return { note, persona: member.user.persona_name };
}

(async () => {
  if (!TOKEN) {
    console.error('ADMIN_TOKEN env required — mint via scripts.issue_admin_token --owner.');
    process.exit(2);
  }
  const seeded = await seed();
  console.log('OK seeded a feedback note + a three-in-a-row ledger row');

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const int = async (id) => Number((await tid(id).innerText()).trim());

  await page.goto(`${WEB}/admin#token=${TOKEN}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('[data-testid="admin-ready"]', { timeout: 60000 });
  console.log('OK admin authenticated + dashboard ready');

  for (const t of TABS) {
    const before = errors.length;
    try {
      await tid(`admin-tab-${t}`).click();
      await page.waitForTimeout(700);
      if (t === 'allowance') {
        await tid('allowance-messages').waitFor({ timeout: 15000 });
        const msgs = await int('allowance-messages');
        const pauses = await int('allowance-in-a-row');
        const crisis = await int('allowance-crisis-value');
        if (msgs < 3 || pauses < 1 || crisis < 1) throw new Error(`today's counts too small: ${msgs}/${pauses}/${crisis}`);
        await tid('allowance-period-7').click();
        if ((await int('allowance-messages')) < msgs) throw new Error('7 days < today');
        const text = await tid('admin-panel-allowance').innerText();
        if (text.includes(seeded.persona)) throw new Error('allowance panel carries a persona name');
        if ((await page.locator('[data-testid^="allowance-day-"]').count()) !== 14) throw new Error('per-day table is not 14 rows');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-allowance-1440.png`, fullPage: true });
        await tid('allowance-crisis-exempt').click();
        await tid('admin-panel-safety').waitFor({ timeout: 10000 });
        console.log(`OK allowance: today ${msgs} sent · ${pauses} pauses · ${crisis} crisis-exempt; crisis row → Safety`);
      }
      if (t === 'feedback') {
        await page.getByText(seeded.note).waitFor({ timeout: 15000 });
        const text = await tid('admin-panel-feedback').innerText();
        if (text.includes(seeded.persona)) throw new Error('feedback panel carries an author');
        await tid('feedback-cat-broken').click();
        await page.waitForTimeout(600);
        if (await page.getByText(seeded.note).count()) throw new Error('category filter kept a "confusing" note');
        await tid('feedback-cat-confusing').click();
        await page.getByText(seeded.note).waitFor({ timeout: 10000 });
        await tid('feedback-cat-all').click();
        await page.getByText(seeded.note).waitFor({ timeout: 10000 });
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-feedback-1440.png`, fullPage: true });
        console.log(`OK feedback: the note is listed, no author, the category filter works (${await tid('feedback-range').innerText()})`);
      }
      results.push({ t, ok: errors.length === before });
    } catch (e) {
      results.push({ t, ok: false, note: e.message.split('\n')[0] });
    }
  }

  await browser.close();

  // Both reads are audited server-side.
  const audited = psql(`SELECT count(DISTINCT action) FROM admin_audit_log WHERE action IN ('allowance.viewed','feedback.viewed') AND created_at > now() - interval '5 minutes';`);
  if (audited !== '2') results.push({ t: 'audit rows', ok: false, note: `expected allowance.viewed + feedback.viewed, got ${audited}` });
  else console.log('OK both reads wrote audit rows (allowance.viewed, feedback.viewed)');

  let failed = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} admin tab: ${r.t}${r.note ? ' — ' + r.note : ''}`);
    if (!r.ok) failed++;
  }
  if (errors.length) { console.error('PAGE ERRORS:', errors); }
  if (failed || errors.length) { console.error('\nADMIN DASHBOARD: failures'); process.exit(1); }
  console.log(`\nADMIN DASHBOARD E2E PASSED — all ${TABS.length} tabs rendered, 0 page errors`);
})().catch((e) => { console.error('ADMIN E2E FAILED:', e.message); process.exit(1); });
