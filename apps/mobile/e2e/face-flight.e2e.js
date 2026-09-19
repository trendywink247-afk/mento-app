/**
 * "Things come from where you touched" (board T90 principle 3; T05 and T06):
 *
 *  1. T05 — opening a chat from its My Chats row: the mentor's face in the chat header
 *     starts at the row's face and settles into the card. One mover, transform only.
 *  2. T06 — opening the mentor's profile from the chat header: the profile's hero figure
 *     grows out of the header's avatar.
 *  3. Under reduced motion neither moves at all: both are simply where they belong.
 *  4. A cold arrival (the chat opened straight from its URL, with no tap behind it) never
 *     flies — there is nothing to fly from.
 *
 * The proof is geometric: the element's box is sampled every 30 ms for 700 ms and compared
 * with where it comes to rest. Plain Node, 390×844, 0 page errors.
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const DB = process.env.MENTO_DB || 'mento';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';

const sql = (q) => execSync(`docker exec mento-postgres psql -U mento -d ${DB} -c "${q}"`, { stdio: 'pipe' });
function resetEnv() {
  execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`, { stdio: 'pipe' });
  sql("UPDATE conversations SET status='ended', ended_at=now() WHERE status='active';");
  sql("UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;");
}

/**
 * Samples an element's box from the first frame it exists — the flight is over long before
 * a chat is "ready", so nothing may be awaited in between — and says how far it ever was
 * from where it came to rest.
 */
async function travelOf(page, testID) {
  const samples = await page.evaluate(
    async ([id, ms, every, waitMs]) => {
      const box = () => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width };
      };
      const appear = performance.now() + waitMs;
      while (!box() && performance.now() < appear) await new Promise((r) => setTimeout(r, 20));
      const out = [];
      const until = performance.now() + ms;
      while (performance.now() < until) {
        const b = box();
        if (b) out.push(b);
        await new Promise((r) => setTimeout(r, every));
      }
      return out;
    },
    [testID, 700, 25, 20000],
  );
  if (samples.length < 5) throw new Error(`${testID}: only ${samples.length} samples — was it ever drawn?`);
  const rest = samples[samples.length - 1];
  let moved = 0;
  let scaled = 0;
  for (const s of samples) {
    moved = Math.max(moved, Math.abs(s.x - rest.x) + Math.abs(s.y - rest.y));
    scaled = Math.max(scaled, Math.abs(s.w - rest.w));
  }
  return { moved, scaled, rest };
}

async function onboard(page, tid) {
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
}

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

  await onboard(page, tid);
  const conversationId = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];

  // A cold arrival: no tap behind it, so the header face must not travel.
  const cold = await travelOf(page, 'chat-header-face');
  if (cold.moved > 4 || cold.scaled > 4) {
    throw new Error(`[${label}] the header face flew with no origin behind it (${JSON.stringify(cold)})`);
  }
  console.log(`[${label}] OK a chat opened cold: the header face is simply there`);

  // --- T05: the row → the header ------------------------------------------------------
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  const row = tid(`convo-${conversationId}`);
  await row.waitFor({ timeout: 30000 });
  await page.waitForTimeout(700); // the list settles before anything is measured
  // No await between the tap and the sampler: the flight is finished within 350 ms, long
  // before the channel is watched and the thread says it is ready.
  await row.click();
  const flight = await travelOf(page, 'chat-header-face');
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  if (reduced) {
    if (flight.moved > 4 || flight.scaled > 4) {
      throw new Error(`[${label}] the header face moved under reduced motion (${JSON.stringify(flight)})`);
    }
    console.log(`[${label}] OK T05: nothing moves — the header face is simply there`);
  } else {
    if (flight.moved < 8) {
      throw new Error(`[${label}] the header face did not fly from the row (moved ${flight.moved})`);
    }
    console.log(`[${label}] OK T05: the face flew ${Math.round(flight.moved)}px from the row into the header`);
  }

  // --- T06: the header → the profile hero ---------------------------------------------
  await tid('mentor-header').click();
  const hero = await travelOf(page, 'mentor-hero-figure');
  if (reduced) {
    if (hero.moved > 4 || hero.scaled > 4) {
      throw new Error(`[${label}] the profile hero moved under reduced motion (${JSON.stringify(hero)})`);
    }
    console.log(`[${label}] OK T06: the hero is simply there`);
  } else {
    if (hero.moved < 8) throw new Error(`[${label}] the profile hero did not grow from the header (moved ${hero.moved})`);
    console.log(`[${label}] OK T06: the hero grew ${Math.round(hero.moved)}px out of the header's avatar`);
  }

  // Back to the chat: the header is whole, and nothing is left flying.
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failed = false;
  try {
    const errs = [...(await run(browser, false)), ...(await run(browser, true))];
    if (errs.length) {
      console.error('PAGE ERRORS:', errs);
      failed = true;
    } else {
      console.log('\nFACE FLIGHT E2E PASSED — T05 + T06 hand-overs, still under reduced motion, 0 page errors');
    }
  } catch (e) {
    console.error('FAILED', e.message);
    failed = true;
  } finally {
    resetEnv();
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})();
