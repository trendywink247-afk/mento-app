/**
 * First-question builder (DECISIONS §L.8, app/path-question.tsx + lib/questionBuilder.ts).
 *
 * Proves: a Path starter opens the builder (it no longer matches on the tap); chips
 * change the live preview deterministically (exclusive attempts, independent "Working
 * alongside", exclusive tried, every chip can be toggled off); "Another" swaps the
 * starter and keeps the chosen clauses; BOTH actions land in the chat with the ASSEMBLED
 * text in the composer and NOTHING sent (the transcript is still empty, and stays empty)
 * — "Edit in chat" additionally arrives with the composer focused, caret at the end; a
 * road that is not an exam is never offered exam chips; past 160 characters the last
 * clause is dropped whole and the screen says so.
 * Normal + reducedMotion (must stay static AND complete), 0 page errors.
 * (The sentence assembly itself is unit-tested: npm run test:question.)
 */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';

const P0 = 'I keep recalculating my marks.';
const P1 = "My friends think they cleared. I don't.";
const LONG = 'I have been turning this over for weeks and I still cannot tell whether the plan I made is one I believe in.';

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
  const preview = async () => ((await tid('pq-preview').textContent()) ?? '').trim();
  const expectPreview = async (want, why) => {
    await page.waitForFunction(
      (w) => (document.querySelector('[data-testid="pq-preview"]')?.textContent ?? '').trim() === w,
      want,
      { timeout: 10000 },
    ).catch(async () => {
      throw new Error(`${why}: preview is "${await preview()}", expected "${want}"`);
    });
  };

  /** In the chat: the text is IN the composer and the transcript is EMPTY — now, and a
   * beat later (nothing sends itself late either). */
  const expectUnsentInComposer = async (want) => {
    await page.waitForURL('**/chat/**', { timeout: 60000 });
    await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
    const draft = await tid('composer-input').inputValue();
    if (draft !== want) throw new Error(`composer holds "${draft}", expected "${want}"`);
    for (const wait of [0, 2000]) {
      await page.waitForTimeout(wait);
      if (!(await page.locator("text=You're connected.").count())) {
        throw new Error('the transcript is not empty — something was sent');
      }
      if ((await tid('composer-input').inputValue()) !== want) throw new Error('the draft left the composer');
    }
  };

  // Onboard, then walk the Pathfinder to UPSC · waiting after prelims.
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-fox').click();
  await tid('colour-teal').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });

  await page.goto(`${WEB}/path`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('path-start').click();
  await page.locator("text=I'm preparing for an exam").click();
  await page.locator('text=UPSC').click();
  await page.locator('text=Waiting after prelims').click();
  await page.waitForSelector(`text=${P0}`, { timeout: 30000 });

  // A starter opens the builder — no match, no chat, nothing sent.
  await tid('path-prompt-0').click();
  await page.waitForURL('**/path-question**', { timeout: 30000 });
  await page.waitForSelector('[data-testid="pq-headline"]', { timeout: 30000 });
  if (((await tid('pq-headline').textContent()) ?? '').trim() !== P0) throw new Error('headline is not the chosen starter');
  if (((await tid('pq-lens').textContent()) ?? '').trim() !== 'UPSC · The wait after prelims') throw new Error('lens line is wrong');
  await expectPreview(P0, 'no chips');
  await page.waitForSelector('text=30 of 160 characters', { timeout: 10000 });
  await page.waitForSelector('text=Nothing is sent until you tap Send.', { timeout: 10000 });
  await page.waitForSelector('text=A starter, not a script. Type your own anytime.', { timeout: 10000 });
  console.log(`[${label}] OK starter opens the builder: headline, lens, bare preview, 30 of 160`);

  // Chips → preview, deterministically.
  await tid('pq-chip-first').click();
  await expectPreview(`${P0} This was my first attempt.`, 'first');
  await tid('pq-chip-second').click(); // exclusive with first
  await expectPreview(`${P0} This was my second attempt.`, 'second replaces first');
  await tid('pq-chip-working').click(); // independent
  await expectPreview(`${P0} This was my second attempt, and I'm working alongside.`, 'working beside an attempt');
  await tid('pq-chip-break').click();
  await tid('pq-chip-prep').click(); // exclusive with break
  const FULL = `${P0} This was my second attempt, I'm working alongside, and I've started interview prep.`;
  await expectPreview(FULL, 'three clauses — prep replaced break');
  await tid('pq-chip-working').click(); // any chip toggles off
  const TWO = `${P0} This was my second attempt, and I've started interview prep.`;
  await expectPreview(TWO, 'working toggled off');
  await page.waitForSelector(`text=${TWO.length} of 160 characters`, { timeout: 10000 });
  console.log(`[${label}] OK chips: exclusive attempts, independent working, exclusive tried, toggle-off, live count`);

  // "Another" swaps the starter, keeps the clauses; three taps come back round.
  await tid('pq-another').click();
  await expectPreview(`${P1} This was my second attempt, and I've started interview prep.`, 'another starter');
  await tid('pq-another').click();
  await tid('pq-another').click();
  await expectPreview(TWO, 'back to the first starter');
  console.log(`[${label}] OK Another cycles the path's starters and keeps the chosen clauses`);

  // Primary: assembled text IN the composer, NOT sent, field not focused.
  await tid('pq-continue').click();
  await expectUnsentInComposer(TWO);
  const focusedAfterContinue = await page.evaluate(
    () => document.activeElement === document.querySelector('[data-testid="composer-input"]'),
  );
  if (focusedAfterContinue) throw new Error('"Take it to a mentor" must not focus the composer');
  console.log(`[${label}] OK Take it to a mentor → chat, assembled text in the composer, nothing sent`);
  if (process.env.SHOT_CHAT && !reduced) await page.screenshot({ path: process.env.SHOT_CHAT });

  // Secondary: the same, plus the composer is focused with the caret at the end.
  await page.goto(`${WEB}/path`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('path-prompt-1').click();
  await page.waitForURL('**/path-question**', { timeout: 30000 });
  await tid('pq-chip-none').click();
  const EDIT = `${P1} I haven't tried anything yet.`;
  await expectPreview(EDIT, 'none');
  if (process.env.SHOT && !reduced) {
    await tid('pq-chip-third').click();
    await tid('pq-chip-working').click();
    await page.waitForTimeout(1200); // entrances settled
    await page.screenshot({ path: process.env.SHOT });
    await tid('pq-chip-third').click();
    await tid('pq-chip-working').click();
    await expectPreview(EDIT, 'back to none only');
  }
  await tid('pq-edit').click();
  await expectUnsentInComposer(EDIT);
  const caret = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="composer-input"]');
    return { focused: document.activeElement === el, start: el.selectionStart, length: el.value.length };
  });
  if (!caret.focused || caret.start !== caret.length) {
    throw new Error(`"Edit in chat" must focus the composer with the caret at the end: ${JSON.stringify(caret)}`);
  }
  console.log(`[${label}] OK Edit in chat → chat, text in the focused composer (caret at the end), nothing sent`);

  // A road that is not an exam is never offered exam chips.
  await page.goto(`${WEB}/path`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('path-change').click();
  await page.locator('text=Life feels heavy right now').click();
  await page.waitForSelector('text=Life · Heavy days', { timeout: 30000 });
  await tid('path-prompt-0').click();
  await page.waitForURL('**/path-question**', { timeout: 30000 });
  await page.waitForSelector('[data-testid="pq-group-tried"]', { timeout: 30000 });
  for (const id of ['first', 'second', 'third', 'working', 'prep']) {
    if (await tid(`pq-chip-${id}`).count()) throw new Error(`the Life path must not offer the "${id}" chip`);
  }
  if (await tid('pq-group-where').count()) throw new Error('an empty chip group must not render');
  if (!(await tid('pq-chip-break').count()) || !(await tid('pq-chip-none').count())) throw new Error('Life keeps the universal chips');
  console.log(`[${label}] OK Life path: no exam chips, no empty group`);

  // Past 160: the last clause is dropped whole, and the screen says so.
  await page.goto(`${WEB}/path-question?starter=${encodeURIComponent(LONG)}&community=upsc`, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="pq-headline"]', { timeout: 30000 });
  await tid('pq-chip-second').click();
  await expectPreview(`${LONG} This was my second attempt.`, 'long starter + one clause');
  if (await tid('pq-dropped').count()) throw new Error('nothing was dropped yet');
  await tid('pq-chip-prep').click();
  await expectPreview(`${LONG} This was my second attempt.`, 'a clause that would not fit is dropped whole');
  await page.waitForSelector('[data-testid="pq-dropped"]', { timeout: 10000 });
  const len = (await preview()).length;
  if (len > 160) throw new Error(`preview is ${len} characters`);
  console.log(`[${label}] OK 160 limit: last clause dropped whole (${len} chars), honest note shown`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('path-question: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
