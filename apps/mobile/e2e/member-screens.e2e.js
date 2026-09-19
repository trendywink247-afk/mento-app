/**
 * Member-screens smoke: complete onboarding once (real session), then sweep every
 * member-facing screen and sub-flow asserting 0 page errors and that each renders.
 *
 * Discovery-oriented: it does NOT stop at the first failure — it visits every screen,
 * attributes any page error to the screen that was active, and prints a full report,
 * exiting non-zero if anything errored or failed to render. Runs once normal + once
 * under reducedMotion (must stay static AND complete).
 */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

async function onboard(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-panda').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const results = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push({ screen: current, msg: String(e) }));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  let current = 'boot';

  // Each visit records pass/fail without aborting the sweep.
  async function visit(name, fn) {
    current = name;
    const before = errors.length;
    try {
      await fn();
      const errd = errors.length - before;
      results.push({ name, ok: errd === 0, note: errd ? `${errd} page error(s)` : 'rendered' });
    } catch (e) {
      results.push({ name, ok: false, note: `FAILED: ${e.message.split('\n')[0]}` });
    }
  }

  await visit('onboarding+chat', () => onboard(page, tid));

  // Conversation options sheet opens.
  await visit('chat: options sheet', async () => {
    await tid('open-options').click();
    await page.waitForTimeout(600);
  });

  // Into the tab shell.
  await visit('tab: chats', async () => {
    await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-testid="tab-chats"]', { timeout: 30000 });
  });

  // New Chat FAB opens a two-option sheet — it must never mint a conversation by itself.
  await visit('chats: new-chat sheet', async () => {
    await tid('new-chat-fab').click();
    await page.waitForSelector('[data-testid="new-chat-sheet"]', { timeout: 15000 });
    const before = page.url();
    await page.waitForTimeout(800);
    if (page.url() !== before) throw new Error('FAB navigated without a choice');
    await tid('new-chat-pick').click();
    await page.waitForURL('**/mentors', { timeout: 30000 });
    await page.waitForSelector('[data-testid="next-available"]', { timeout: 30000 });
    await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-testid="tab-chats"]', { timeout: 30000 });
  });

  await visit('tab: path', async () => {
    await tid('tab-path').click();
    await page.waitForSelector('[data-testid="path-start"],[data-testid="path-change"]', { timeout: 30000 });
  });

  await visit('tab: journals', async () => {
    await tid('tab-journals').click();
    await page.waitForSelector('[data-testid="journal-mood"]', { timeout: 30000 });
  });

  // Tabs move sideways in bar order instead of cutting: Path is already mounted, so coming
  // back to it from Journal (one to its right) it must arrive from the LEFT and settle at
  // rest. Under reduced motion there is no transition — it never leaves x = 0.
  await visit('tabs: switch moves sideways', async () => {
    await page.evaluate(() => {
      window.__tabSamples = [];
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector('[data-testid="path-start"],[data-testid="path-change"]');
        if (el) {
          let o = 1;
          let x = 0;
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            o *= Number(cs.opacity);
            if (cs.transform && cs.transform !== 'none') x += new DOMMatrix(cs.transform).m41;
          }
          window.__tabSamples.push({ o, x });
        }
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await tid('tab-path').click();
    await page.waitForTimeout(1700);
    const samples = await page.evaluate(() => window.__tabSamples);
    if (!samples.length) throw new Error('Path was not kept mounted between tab switches');
    const last = samples[samples.length - 1];
    if (last.o < 0.99 || Math.abs(last.x) > 0.5) throw new Error(`Path did not settle: opacity ${last.o}, x ${last.x}`);
    const minX = Math.min(...samples.map((s) => s.x));
    const maxX = Math.max(...samples.map((s) => s.x));
    if (reduced) {
      if (minX !== 0 || maxX !== 0) throw new Error(`reduced motion moved the tab sideways (x ${minX}..${maxX})`);
    } else {
      if (minX > -4) throw new Error(`tab switch was a cut: Path never sat to the left (min x ${minX})`);
      if (maxX > 0.5) throw new Error(`Path arrived from the wrong side (max x ${maxX})`);
      if (!samples.some((s) => s.o > 0.02 && s.o < 0.98)) throw new Error('tab switch did not fade');
    }
  });

  // Every journal channel screen.
  // Finance is Coming soon on the unified hub (no tappable row for a member with no
  // finance history) — the channel route itself is still swept below.
  for (const ch of ['mood', 'mentor-notes', 'gratitude']) {
    await visit(`journal: ${ch}`, async () => {
      await tid('tab-journals').click();
      await page.waitForSelector(`[data-testid="journal-${ch}"]`, { timeout: 30000 });
      await tid(`journal-${ch}`).click();
      await page.waitForURL(`**/journal/${ch}`, { timeout: 30000 });
      await page.waitForTimeout(500);
      await page.goBack();
    });
  }

  await visit('tab: profile', async () => {
    await tid('tab-profile').click();
    await page.waitForSelector('[data-testid="profile-start-fresh"]', { timeout: 30000 });
  });

  await visit('profile: coffee', async () => {
    await tid('profile-coffee').click();
    // Coffee screen loads with the amount chips always visible.
    await page.waitForSelector('[data-testid="amount-49"]', { timeout: 30000 });
    // Tapping a method must surface the transparent "payments disabled" note (T&S #4).
    await tid('method-upi').click();
    await page.waitForSelector('[data-testid="payments-note"]', { timeout: 30000 });
    await page.goBack();
  });

  await visit('profile: start-fresh modal', async () => {
    await tid('tab-profile').click();
    await page.waitForSelector('[data-testid="profile-start-fresh"]', { timeout: 30000 });
    await tid('profile-start-fresh').click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape').catch(() => {});
  });

  await visit('reflection', async () => {
    await page.goto(`${WEB}/reflection`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-testid="reflection-finish"],[data-testid="reflection-skip"]', { timeout: 30000 });
  });

  // Unmatched routes render the branded not-found screen, never expo-router's default.
  await visit('not-found', async () => {
    await page.goto(`${WEB}/this-road-does-not-exist`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-testid="not-found"]', { timeout: 30000 });
    await tid('not-found-home').click();
    await page.waitForURL('**/chats', { timeout: 30000 });
  });

  await ctx.close();
  return { label, errors, results };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runs = [await run(browser, false), await run(browser, true)];
  await browser.close();

  let failed = 0;
  for (const r of runs) {
    console.log(`\n=== ${r.label} ===`);
    for (const res of r.results) {
      console.log(`  ${res.ok ? 'OK  ' : 'FAIL'} ${res.name} — ${res.note}`);
      if (!res.ok) failed++;
    }
    if (r.errors.length) {
      console.log('  page errors:');
      for (const e of r.errors) console.log(`    [${e.screen}] ${e.msg}`);
    }
  }
  if (failed) { console.error(`\nMEMBER-SCREENS: ${failed} screen(s) failed`); process.exit(1); }
  console.log('\nMEMBER-SCREENS E2E PASSED — every screen rendered, 0 page errors (normal + reduced)');
})().catch((e) => { console.error('E2E HARNESS FAILED:', e.message); process.exit(1); });
