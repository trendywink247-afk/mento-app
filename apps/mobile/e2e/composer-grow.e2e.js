/**
 * The composer grows with its words (board A05's field; lane u10 item 3).
 *
 * The walker found the first-question builder's two-line starter clipped in a one-line
 * composer. Proves on the web composer (components/chat/ComposerField.tsx — react-native-web
 * never grows a textarea by itself):
 *  - the builder's "Take it to a mentor" lands in the chat with the WHOLE starter visible:
 *    the field is taller than one line and nothing is hidden inside it (scrollHeight fits);
 *  - one line of text is one line tall; a long text grows line by line up to five lines,
 *    then scrolls inside at exactly five; deleting words shrinks it back to one line;
 *  - nothing was sent for the member (the transcript stays empty).
 * Also checked at 360 wide. Normal + reduced motion, 0 page errors.
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const DB = process.env.MENTO_DB || 'mento';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';

const LINE = 24;
const PAD = 13 * 2;
const STARTER =
  "Today felt heavy. I've been taking a break from the books and I cannot tell whether that was the right call.";

function resetEnv() {
  execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`, { stdio: 'pipe' });
  execSync(
    `docker exec mento-postgres psql -U mento -d ${DB} -c "UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;"`,
    { stdio: 'pipe' },
  );
}

async function measure(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="composer-input"]')].find((n) => n.offsetParent !== null);
    if (!el) return null;
    return { h: el.clientHeight, sh: el.scrollHeight, value: el.value };
  });
}

async function run(browser, { reduced, width, height }) {
  const label = `${reduced ? 'reduced-motion' : 'normal'} ${width}`;
  const errors = [];
  resetEnv();
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await tid('skip').click();
  await tid('animal-panda').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });

  // --- the builder's starter lands whole ---------------------------------------------------
  const q = new URLSearchParams({ starter: STARTER, community: 'life', lens: 'Life · Heavy days' });
  await page.goto(`${WEB}/path-question?${q}`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('pq-continue').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  await page.waitForTimeout(600);
  const m = await measure(page);
  if (!m || m.value !== STARTER) throw new Error(`composer holds "${m && m.value}"`);
  if (m.h <= LINE + PAD) throw new Error(`the starter sits in a one-line field (${m.h}px)`);
  if (m.sh > m.h + 1) throw new Error(`the starter is clipped: ${m.sh}px of words in a ${m.h}px field`);
  if (!(await page.locator("text=You're connected.").count())) throw new Error('something was sent for the member');
  console.log(`[${label}] OK the builder's starter is whole in the composer (${m.h}px, ${Math.round((m.h - PAD) / LINE)} lines)`);

  // --- grows line by line to five, then scrolls; shrinks back -------------------------------
  const input = page.locator('[data-testid="composer-input"]:visible');
  await input.fill('One line.');
  await page.waitForTimeout(300);
  const one = await measure(page);
  if (one.h !== LINE + PAD) throw new Error(`one line is ${one.h}px, expected ${LINE + PAD}`);
  await input.fill('a\nb\nc');
  await page.waitForTimeout(300);
  const three = await measure(page);
  if (three.h !== 3 * LINE + PAD || three.sh > three.h + 1) throw new Error(`three lines: ${JSON.stringify(three)}`);
  await input.fill('1\n2\n3\n4\n5\n6\n7\n8');
  await page.waitForTimeout(300);
  const eight = await measure(page);
  if (eight.h !== 5 * LINE + PAD) throw new Error(`eight lines should cap at five: ${eight.h}px`);
  if (eight.sh <= eight.h) throw new Error('past five lines the field should scroll inside');
  await input.fill('');
  await page.waitForTimeout(300);
  const empty = await measure(page);
  if (empty.h !== LINE + PAD) throw new Error(`an empty field is ${empty.h}px`);
  console.log(`[${label}] OK 1 → 3 → 5 (cap, scrolls inside) → 1 line`);

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [
    ...(await run(browser, { reduced: false, width: 390, height: 844 })),
    ...(await run(browser, { reduced: true, width: 390, height: 844 })),
    ...(await run(browser, { reduced: false, width: 360, height: 740 })),
  ];
  await browser.close();
  resetEnv();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nCOMPOSER GROW E2E PASSED — 0 page errors (normal + reduced-motion, 390 + 360)');
})().catch((e) => {
  try {
    resetEnv();
  } catch {}
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
