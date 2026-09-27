/**
 * Age-gate friction on the public /apply path (WS3 T3.8):
 *  1. the wheels open on a date that does NOT pass — Continue is disabled on arrival and
 *     no limit line shows until a wheel is touched (nobody is 18 by default);
 *  2. a refusal remembered on this device (last 24 h) is the answer on the next visit —
 *     the refused line shows and Continue stays disabled even for an adult year;
 *  3. the server's per-install cooldown: this install was refused a moment ago (API), so
 *     an adult date from it is refused too (403 age_gate_cooldown) and the screen shows
 *     the refused line and remembers it.
 * Normal + reducedMotion, 390x844, 0 page errors. Needs the API (rate limits ON — the
 * cooldown rides them) and Expo web.
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

function dobYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 200);
  return d.toISOString().slice(0, 10);
}

async function openAgeStep(browser, reduced, storage) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  if (storage) {
    await ctx.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  await page.goto(`${WEB}/apply`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await tid('apply-start').waitFor({ timeout: 90000 });
  await tid('apply-start').click();
  await tid('apply-dob-continue').waitFor({ timeout: 60000 });
  await page.waitForTimeout(reduced ? 200 : 800);
  return { ctx, page, errors, tid };
}

async function stepToAdult(page, tid) {
  const year = async () => Number(await tid('dob-year-value').innerText());
  const target = new Date().getFullYear() - 25;
  while ((await year()) > target) await tid('dob-year-up').click();
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';

  // 1 — no passing default.
  {
    const { ctx, page, errors, tid } = await openAgeStep(browser, reduced);
    try {
      if (!(await tid('apply-dob-continue').isDisabled())) {
        throw new Error('Continue is enabled on arrival — the default date passes the gate');
      }
      if (await page.locator('text=Mento is available to people 18 and older.').count()) {
        throw new Error('the limit line shows before any wheel was touched');
      }
      await tid('dob-year-down').click(); // a touch, still under age
      await page.waitForSelector('text=Mento is available to people 18 and older.', { timeout: 10000 });
      if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
      console.log(`${label}: OK no passing default; the limit line waits for a touch`);
    } finally {
      await ctx.close();
    }
  }

  // 2 — a refusal remembered on the device.
  {
    const { ctx, page, errors, tid } = await openAgeStep(browser, reduced, {
      'mento.age_refused_until': String(Date.now() + 60 * 60 * 1000),
    });
    try {
      await tid('apply-age-refused').waitFor({ timeout: 10000 });
      await stepToAdult(page, tid);
      if (!(await tid('apply-dob-continue').isDisabled())) {
        throw new Error('a remembered refusal still let an adult year continue');
      }
      if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
      console.log(`${label}: OK a refusal remembered on the device holds for an adult year`);
    } finally {
      await ctx.close();
    }
  }

  // 3 — the server's per-install cooldown.
  {
    const install = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const refused = await fetch(`${API}/onboarding/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dob: dobYearsAgo(15), install_id: install }),
    });
    if (refused.status !== 403) throw new Error(`under-age signup → ${refused.status}`);
    const { ctx, page, errors, tid } = await openAgeStep(browser, reduced, {
      'mento.install_id': install,
    });
    try {
      await stepToAdult(page, tid);
      const answer = page.waitForResponse((r) => r.url().includes('/onboarding/start'));
      await tid('apply-dob-continue').click();
      const res = await answer;
      const body = await res.json();
      if (res.status() !== 403 || body.code !== 'age_gate_cooldown') {
        throw new Error(`expected the install cooldown, got ${res.status()} ${JSON.stringify(body)}`);
      }
      await tid('apply-age-refused').waitFor({ timeout: 10000 });
      const remembered = await page.evaluate(() => localStorage.getItem('mento.age_refused_until'));
      if (!remembered || Number(remembered) <= Date.now()) throw new Error('refusal not remembered');
      if (await tid('primer-continue').count()) throw new Error('an account was made');
      if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
      console.log(`${label}: OK the server's install cooldown refuses an adult date and is remembered`);
    } finally {
      await ctx.close();
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('AGE-GATE-FRICTION E2E: ALL PASS');
  } catch (e) {
    console.error('AGE-GATE-FRICTION E2E FAILED', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
