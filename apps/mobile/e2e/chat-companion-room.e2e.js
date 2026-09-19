/**
 * The companion never stands on the last chat bubble (boards A05 / A22).
 *
 * The member's companion sits on the composer footer's top edge and rises into the foot of
 * the thread; the thread keeps that much room free (components/chat/companionRoom.ts). This
 * sends three messages, the last one long (right-aligned, on the companion's side), and at
 * 390×844 and 360×740 asserts that the companion is drawn AND that its box does not touch
 * the last bubble's box, nor its delivery line.
 *
 * Plain Node, normal + reduced motion, 0 page errors. Needs the lane's API + web.
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const DB = process.env.MENTO_DB || 'mento';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';

function resetEnv() {
  execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`, { stdio: 'pipe' });
  execSync(
    `docker exec mento-postgres psql -U mento -d ${DB} -c "UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;"`,
    { stdio: 'pipe' },
  );
}

const MESSAGES = [
  'Hi, is anyone there?',
  'Today felt heavy.',
  'That I have given three years to this and I still freeze in the exam hall, every single time, even when I know the answer and I have practised it again and again.',
];

async function boxes(page) {
  return page.evaluate(() => {
    const box = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    const comp = [...document.querySelectorAll('[data-testid="companion-slot-composerTop"]')].map(box).find(Boolean) ?? null;
    const bubbles = [...document.querySelectorAll('[data-testid^="mine-"], [data-testid^="msg-"]')].map(box).filter(Boolean);
    const delivery = [...document.querySelectorAll('[data-testid="chat-delivery"]')].map(box).filter(Boolean);
    return { comp, last: bubbles[bubbles.length - 1] ?? null, delivery: delivery[delivery.length - 1] ?? null };
  });
}

const touches = (a, b) => !(a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y);

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  resetEnv();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  const member = await page.evaluate(() => localStorage.getItem('mento.session_token'));
  const convo = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];

  for (const text of MESSAGES) {
    const before = await page.locator('[data-testid^="mine-"]').count();
    await page.locator('[data-testid="composer-input"]:visible').fill(text);
    await page.locator('[data-testid="composer-send"]:visible').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="mine-"]').length > n, before, {
      timeout: 30000,
    });
  }

  for (const [w, h] of [
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1200); // the list re-rests on the composer after the resize
    const b = await boxes(page);
    if (!b.comp) throw new Error(`[${label} ${w}] the companion is not drawn on the composer — nothing proven`);
    if (!b.last) throw new Error(`[${label} ${w}] no bubble found`);
    if (touches(b.comp, b.last)) {
      throw new Error(`[${label} ${w}] the companion ${JSON.stringify(b.comp)} is on the last bubble ${JSON.stringify(b.last)}`);
    }
    if (b.delivery && touches(b.comp, b.delivery)) {
      throw new Error(`[${label} ${w}] the companion covers the delivery line ${JSON.stringify(b.delivery)}`);
    }
    console.log(`[${label}] OK ${w}×${h}: companion clear of the last bubble (gap ${Math.round(b.comp.y - (b.last.y + b.last.h))} px)`);
  }

  await fetch(`${API}/conversations/${convo}/end`, { method: 'POST', headers: { Authorization: `Bearer ${member}` } });
  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await run(browser, false)), ...(await run(browser, true))];
  await browser.close();
  resetEnv();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nCHAT COMPANION ROOM E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  try {
    resetEnv();
  } catch {}
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
