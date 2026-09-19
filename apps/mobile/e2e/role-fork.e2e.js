/** Role fork (DECISIONS §K.7): landing → listen door → age → email → primer →
 * handoff → Mentor Home (inline application) → pending → switch to talking →
 * Chats. Then a fresh page with the same stored session must land on Mentor Home
 * straight from `/`. Runs once normally and once under reducedMotion: 'reduce'. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

/** What the SERVER holds for this session (GET /me) — read from Node, not the page. */
async function serverMe(token) {
  const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /me answered ${res.status}`);
  return res.json();
}

const MOTIVATION =
  'I went through a rough prelims year and a friend sat with me through it. I want to be that for someone else.';

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  // The fork arrives as ONE sequence: the footer line is the LAST Entrance item, so on the
  // frame it first exists it must not be ahead of the headline (it used to sit outside the
  // stagger, at full strength before anything else had faded in).
  const arrival = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        // Opacity BELOW the two nodes' common ancestor — the step's own layer fade (shared by
        // both) is excluded, so this reads each item's place in the Entrance sequence only.
        const eff = (el, stop) => {
          let o = 1;
          for (let n = el; n && n !== stop; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          return o;
        };
        const t0 = performance.now();
        const tick = () => {
          const footer = document.querySelector('[data-testid="role-footer"]');
          const headline = document.querySelector('[role="heading"]');
          if (footer && headline) {
            let common = footer.parentElement;
            while (common && !common.contains(headline)) common = common.parentElement;
            return resolve({ footer: eff(footer, common), headline: eff(headline, common) });
          }
          if (performance.now() - t0 > 60000) return reject(new Error('role fork never mounted'));
          requestAnimationFrame(tick);
        };
        tick();
      })
  );
  if (arrival.footer > arrival.headline + 0.01) {
    throw new Error(`role footer (${arrival.footer}) arrived ahead of the headline (${arrival.headline})`);
  }
  if (!reduced && arrival.footer > 0.5) {
    throw new Error(`role footer is outside the entrance sequence: opacity ${arrival.footer} on its first frame`);
  }
  await page.waitForFunction(() => {
    let o = 1;
    for (let n = document.querySelector('[data-testid="role-footer"]'); n && n.nodeType === 1; n = n.parentElement)
      o *= Number(getComputedStyle(n).opacity);
    return o > 0.99;
  }, null, { timeout: 15000 });
  console.log(
    `${label}: OK role fork arrives as one sequence (first frame: headline ${arrival.headline.toFixed(2)}, footer ${arrival.footer.toFixed(2)}; footer settles at 1)`
  );
  await tid('role-listen').waitFor({ timeout: 60000 });

  // The art band (board A02): the companions-at-play film really plays in the normal pass;
  // under reduced motion there is no <video> at all, only the still.
  await tid('playground-band').waitFor({ timeout: 30000 });
  if (reduced) {
    const videos = await page.locator('[data-testid="playground-band"] video').count();
    if (videos !== 0) throw new Error('reduced motion: the playground band mounted a <video>');
    await tid('playground-still').waitFor({ timeout: 15000 });
    console.log(`${label}: OK playground band is the still only (no <video>)`);
  } else {
    await page.waitForFunction(() => {
      const v = document.querySelector('[data-testid="playground-band"] video');
      return Boolean(v && !v.paused && v.currentTime > 0.2 && v.muted && v.loop && v.playsInline && !v.controls);
    }, null, { timeout: 30000 });
    console.log(`${label}: OK playground film is playing inline (muted, looped, no controls)`);
  }
  // Leaving the ROUTE while the film plays must be clean (the DotLottie canvas crashed on
  // exactly this): back to the landing, then in again. Page errors fail the run at the end.
  await tid('back').click();
  await tid('start').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(600);
  await tid('start').click();
  await tid('role-listen').waitFor({ timeout: 60000 });
  console.log(`${label}: OK left the fork mid-film and came back, no teardown error so far`);

  await tid('role-listen').click();
  await page.waitForSelector('text=How old are you?', { timeout: 30000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await tid('primer-continue').waitFor({ timeout: 30000 });
  console.log(`${label}: OK listen door → age → email → primer`);
  await tid('primer-continue').click();

  await page.waitForURL('**/mentor-home', { timeout: 60000 });
  await tid('mentor-home').waitFor({ timeout: 30000 });
  await tid('apply-motivation').waitFor({ timeout: 30000 });
  console.log(`${label}: OK handoff → Mentor Home with inline application form`);

  // Fill the shared ApplicationForm (same testIDs the member flow uses).
  await tid('apply-motivation').fill(MOTIVATION);
  await tid('apply-community-upsc').click();
  await tid('apply-availability-few_hours').click();
  await tid('apply-pledge').click();
  await tid('apply-submit').click();
  await tid('mentor-status').waitFor({ timeout: 30000 });
  await page.waitForSelector('text=Mentor application received', { timeout: 30000 });
  console.log(`${label}: OK application submitted → pending status card`);

  // First switch: a mentor never chose a companion, so "I'd rather talk today" walks the
  // rest of the member journey on the SAME account — never a silent default Panda, never
  // a second account.
  const tokenBefore = await page.evaluate(() => globalThis.localStorage.getItem('mento.session_token'));
  const meBefore = await serverMe(tokenBefore);
  if (meBefore.companion_animal !== null) {
    throw new Error(`a mentor account already has a companion on the server: ${meBefore.companion_animal}`);
  }
  await tid('mentor-switch-talk').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  if ((await page.evaluate(() => globalThis.localStorage.getItem('mento.role'))) !== 'mentor') {
    throw new Error('role flipped to mentee before a companion was confirmed');
  }
  // Back from the pick = "never mind": still a mentor, back on Mentor Home.
  await tid('back').click();
  await tid('mentor-switch-talk').waitFor({ timeout: 30000 });
  console.log(`${label}: OK first switch opens the companion pick; back returns to Mentor Home as a mentor`);

  await tid('mentor-switch-talk').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-capybara').scrollIntoViewIfNeeded();
  await tid('animal-capybara').click();
  await tid('colour-sage').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  const after = await page.evaluate(() => ({
    token: globalThis.localStorage.getItem('mento.session_token'),
    role: globalThis.localStorage.getItem('mento.role'),
    animal: globalThis.localStorage.getItem('mento.companion_animal'),
  }));
  if (after.token !== tokenBefore) throw new Error('switching to talk minted a second account');
  if (after.role !== 'mentee') throw new Error(`role is ${after.role}, expected mentee`);
  if (after.animal !== 'Capybara') throw new Error(`companion is ${after.animal}, expected the one they picked`);
  console.log(`${label}: OK companion → ready → live chat on the same account, as the chosen Capybara`);

  // The pick is on the ACCOUNT too (PUT /me/companion), not only on this device. The save is
  // fire-and-forget, so give it a moment to land.
  let me = await serverMe(after.token);
  for (let i = 0; i < 20 && me.companion_animal !== 'Capybara'; i += 1) {
    await page.waitForTimeout(250);
    me = await serverMe(after.token);
  }
  if (me.companion_animal !== 'Capybara' || me.companion_colour !== 'sage') {
    throw new Error(`server holds ${me.companion_animal} / ${me.companion_colour}, expected Capybara / sage`);
  }
  console.log(`${label}: OK the server has the companion (GET /me → ${me.companion_animal} / ${me.companion_colour})`);

  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('tab-chats').waitFor({ timeout: 30000 });
  console.log(`${label}: OK Chats tab renders`);

  await ctx.close();
  return errors;
}

async function returningMentor(browser) {
  // Second onboarding as a mentor, then reload `/` in a NEW page of the same
  // context: the stored session + role must route straight to Mentor Home.
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-listen').click();
  await page.waitForSelector('text=How old are you?', { timeout: 30000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await tid('primer-continue').click();
  await page.waitForURL('**/mentor-home', { timeout: 60000 });

  const again = await ctx.newPage();
  again.on('pageerror', (e) => errors.push(String(e)));
  await again.goto(WEB, { waitUntil: 'networkidle', timeout: 120000 });
  await again.waitForURL('**/mentor-home', { timeout: 30000 });
  console.log('returning: OK stored mentor session lands on Mentor Home from /');

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const all = [
    ...(await run(browser, false)),
    ...(await run(browser, true)),
    ...(await returningMentor(browser)),
  ];
  await browser.close();
  if (all.length) {
    console.error(`FAIL role-fork — ${all.length} page error(s):`);
    for (const e of all) console.error('  ' + e);
    process.exit(1);
  }
  console.log('\nROLE-FORK E2E PASSED — 0 page errors (normal + reduced-motion + returning mentor)');
})().catch((e) => {
  console.error('ROLE-FORK E2E FAILED', e);
  process.exit(1);
});
