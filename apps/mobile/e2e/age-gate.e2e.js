/** Age gate (board A16) — the three pillow wheels. Read-only: never leaves the age step, so
 * no account is created and no rate limit is spent.
 *  - wheels are CLAMPED to real dates: Feb of a leap year stops at 29, and stepping the year
 *    to a non-leap year pulls the day back to 28; the first day/month cannot go lower
 *  - the readout follows every step
 *  - an under-18 date disables Continue and shows the still limit line; an adult date re-enables it
 *  - press-and-hold keeps stepping (a birth year is many steps away)
 * Once normally, once under reducedMotion: 'reduce'. 0 page errors. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

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
  const text = async (id) => (await tid(id).textContent()).trim();
  const expect = (ok, msg) => {
    if (!ok) throw new Error(`[${label}] ${msg}`);
  };

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('dob-year-value').waitFor({ timeout: 30000 });
  await page.waitForTimeout(900); // the wheels arrive in a stagger

  const thisYear = new Date().getFullYear();
  const start = Number(await text('dob-year-value'));
  expect(start === thisYear - 18, `default year ${start} is not the youngest adult year ${thisYear - 18}`);
  expect(await tid('continue').isEnabled(), 'Continue is disabled on the default (adult) date');
  expect(await tid('dob-day-up').isDisabled(), 'day 01 can still go lower');
  expect(await tid('dob-month-up').isDisabled(), 'January can still go lower');

  // Walk the year back to a leap year, then February, then push the day to its end.
  let year = start;
  while (!(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) {
    await tid('dob-year-up').click();
    year -= 1;
  }
  expect(Number(await text('dob-year-value')) === year, `year wheel shows ${await text('dob-year-value')}, wanted ${year}`);
  await tid('dob-month-down').click();
  for (let i = 0; i < 31; i++) {
    if (await tid('dob-day-down').isDisabled()) break;
    await tid('dob-day-down').click();
  }
  expect((await text('dob-day-value')) === '29', `leap February stopped at ${await text('dob-day-value')}, not 29`);
  expect((await text('dob-readout')).includes(`29 February ${year}`), `readout says "${await text('dob-readout')}"`);
  console.log(`${label}: OK leap February clamps at 29 (${await text('dob-readout')})`);

  await tid('dob-year-up').click(); // a non-leap year: the 29th cannot exist
  expect((await text('dob-day-value')) === '28', `non-leap February kept day ${await text('dob-day-value')}`);
  expect((await text('dob-readout')).includes(`28 February ${year - 1}`), `readout says "${await text('dob-readout')}"`);
  console.log(`${label}: OK stepping to a non-leap year pulls the day back to 28`);

  // Under 18: step the year forward past the gate.
  const toMinor = thisYear - 10 - (year - 1);
  for (let i = 0; i < toMinor; i++) await tid('dob-year-down').click();
  await page.waitForSelector('text=Mento is available to people 18 and older.', { timeout: 10000 });
  expect(await tid('continue').isDisabled(), 'Continue stayed enabled for a 10-year-old');
  console.log(`${label}: OK an under-18 date disables Continue and says why`);

  // Press-and-hold: the year keeps stepping without further taps.
  const before = Number(await text('dob-year-value'));
  const box = await tid('dob-year-up').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  const after = Number(await text('dob-year-value'));
  expect(before - after >= 5, `holding the year wheel only moved it ${before - after} years`);
  await page.waitForTimeout(300);
  expect(Number(await text('dob-year-value')) === after, 'the wheel kept stepping after release');
  expect(await tid('continue').isEnabled(), `Continue did not come back for ${after}`);
  console.log(`${label}: OK press-and-hold stepped ${before - after} years and stopped on release; Continue is back`);

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await run(browser, false)), ...(await run(browser, true))];
  await browser.close();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nAGE-GATE E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
