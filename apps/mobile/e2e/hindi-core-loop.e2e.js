/** Hindi core loop (H1-remainder C6): with locale pre-seeded to `hi`, the whole
 * landing → onboarding → connecting → chat journey renders Hindi at every stage
 * and completes with 0 page errors — then again under reducedMotion: 'reduce'
 * (which must also complete; connecting flies by there, so only the chat
 * assertion holds on that pass). */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';

async function walk(ctx, { assertConnecting }) {
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForSelector('text=बातचीत शुरू करें', { timeout: 60000 }); // landing CTA
  console.log('OK hi landing');
  await tid('start').click();
  await tid('role-talk').click();

  await page.waitForSelector('text=आपकी उम्र क्या है?', { timeout: 60000 }); // age
  console.log('OK hi age step');
  await tid('continue').click();

  await page.waitForSelector('text=ज़रूरी नहीं, पर मददगार।', { timeout: 30000 }); // email
  console.log('OK hi email step');
  await tid('skip').click();

  await page.waitForSelector('text=आपकी ग्रोथ, आपकी थीम', { timeout: 30000 }); // companion
  console.log('OK hi companion step');
  await tid('animal-panda').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();

  await page.waitForSelector('text=आपका Mento स्पेस तैयार है।', { timeout: 30000 }); // ready
  console.log('OK hi ready step');
  await tid('enter').click();

  if (assertConnecting) {
    await page.waitForSelector('text=ढूँढ रहे हैं', { timeout: 30000 }); // connecting headline
    console.log('OK hi connecting story');
  }

  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[placeholder="संदेश लिखें…"]', { timeout: 60000 }); // chat composer
  console.log('OK hi chat (composer placeholder)');

  await page.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Pass 1 — normal motion, every stage asserted.
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx1.addInitScript(() => localStorage.setItem('mento.lang', 'hi'));
  const errs1 = await walk(ctx1, { assertConnecting: true });
  if (errs1.length) { console.error('PAGE ERRORS (normal):', errs1); process.exit(1); }
  console.log('PASS 1 (normal motion) — 0 page errors\n');
  await ctx1.close();

  // Pass 2 — reduced motion must stay usable and complete.
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await ctx2.addInitScript(() => localStorage.setItem('mento.lang', 'hi'));
  const errs2 = await walk(ctx2, { assertConnecting: false });
  if (errs2.length) { console.error('PAGE ERRORS (reduced):', errs2); process.exit(1); }
  console.log('PASS 2 (reduced motion) — 0 page errors');
  await ctx2.close();

  console.log('\nHINDI CORE-LOOP E2E PASSED — both passes, 0 page errors');
  await browser.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
