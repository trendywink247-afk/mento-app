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
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';

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

  // Leaving a chat is `router.replace('/chats')` — a NEW tab navigator, every tab remounts.
  // With data already loaded once, that return must paint the last list straight away and
  // refresh quietly: no spinner on My Chats, none on Path (lib/screenCache.ts).
  await visit('tabs: no spinner coming back from a chat', async () => {
    await tid('tab-chats').click();
    const row = page.locator('[data-testid^="convo-"]').first();
    await row.waitFor({ timeout: 30000 });
    await row.click();
    await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
    await page.evaluate(() => {
      window.__spinners = [];
      const look = () => {
        for (const id of ['chats-loading', 'path-loading'])
          if (document.querySelector(`[data-testid="${id}"]`) && !window.__spinners.includes(id)) window.__spinners.push(id);
      };
      new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
      look();
    });
    await tid('chat-back').click();
    await page.waitForURL('**/chats', { timeout: 30000 });
    await page.locator('[data-testid^="convo-"]').first().waitFor({ timeout: 30000 });
    await tid('tab-path').click();
    await page.waitForSelector('[data-testid="path-start"],[data-testid="path-change"]', { timeout: 30000 });
    await page.waitForTimeout(800);
    const seen = await page.evaluate(() => window.__spinners);
    if (seen.length) throw new Error(`spinner shown over already-loaded data: ${seen.join(', ')}`);
    // ...and it came back to the SAME tabs (lib/leaveToChats.ts), not a second navigator
    // stacked on the first.
    const bars = await tid('tab-chats').count();
    if (bars !== 1) throw new Error(`${bars} tab navigators are mounted after leaving a chat`);
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
    // Support the team (board A31) loads with the amount keys always visible, and says
    // BEFORE any tap that contributions are not switched on (T&S #4).
    await page.waitForSelector('[data-testid="amount-49"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="payments-not-live"]', { timeout: 30000 });
    // The primary key must surface the still "nothing was charged" note — never a thank-you.
    await tid('amount-49').click();
    await tid('coffee-contribute').click();
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

  // Clean Wipe → back on My Chats. The list is still MOUNTED under the chat and was showing
  // this chat's last message; the moment the wipe is asked for the row must become its
  // "wiped" marker, so the message never repaints — not even for the frame before the
  // refresh lands (T&S #8). Wiping also gives the mentor's seat back, so this sweep costs the
  // dev stack no capacity.
  await visit('chat: clean wipe never repaints the last message', async () => {
    // Letters only: a run of digits could be taken for a phone number by the PII redactor.
    const PROBE = `wipe probe ${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8)}`;
    await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
    const row = page.locator('[data-testid^="convo-"]').first();
    await row.waitFor({ timeout: 30000 });
    const rowId = await row.getAttribute('data-testid');
    await row.click();
    await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
    await tid('composer-input').fill(PROBE);
    await tid('composer-send').click();
    await page.waitForSelector(`text=${PROBE}`, { timeout: 30000 });
    // The bubble is optimistic; the field clears once the send has round-tripped to Stream.
    // Leaving before that, the list's refresh can query the channel ahead of the message.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="composer-input"]')?.value === '',
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(500);
    await tid('chat-back').click();
    await page.waitForURL('**/chats', { timeout: 30000 });
    // The list now previews that message — the state the wipe has to clean up.
    await page
      .locator(`[data-testid="${rowId}"]`, { hasText: PROBE })
      .waitFor({ timeout: 30000 })
      .catch(() => {
        throw new Error('My Chats never previewed the message just sent (quiet refresh on return did not run)');
      });
    await page.locator(`[data-testid="${rowId}"]`).click();
    await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
    await tid('open-options').click();
    await tid('opt-end-wipe').click(); // board A20: End and wipe is its own key on the sheet
    await tid('opt-confirm').click(); // "wipe it"
    await page.waitForSelector('text=All clean', { timeout: 30000 });
    await page.evaluate(
      ({ id, probe }) => {
        window.__ghost = false;
        const look = () => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el && el.textContent.includes(probe)) window.__ghost = true;
        };
        new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
        look();
      },
      { id: rowId, probe: PROBE }
    );
    await tid('opt-confirm').click(); // "got it" → My Chats
    await page.waitForURL('**/chats', { timeout: 30000 });
    await page
      .locator(`[data-testid="${rowId}"]`, { hasText: 'Messages wiped' })
      .waitFor({ timeout: 30000 })
      .catch(() => {
        throw new Error('the wiped row never showed its "Messages wiped" marker');
      });
    await page.waitForTimeout(800);
    if (await page.evaluate(() => window.__ghost)) throw new Error('the wiped chat still showed its last message on My Chats');
    if ((await tid('tab-chats').count()) !== 1) throw new Error('a second tab navigator was stacked on the first');
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
