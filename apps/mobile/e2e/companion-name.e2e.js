/**
 * The companion's name (founder ruling 2026-09-19): "add an input box for the name of their
 * companion on companion pick."
 *
 * Proves, once normally and once under reducedMotion (0 page errors in both):
 *  - Companion pick: the resting screen has no field (board A03); once an animal and a colour
 *    are chosen the optional field arrives with a placeholder for that animal ("Maybe Miso"
 *    for the Cat); an email in it shows the calm line and holds Continue back; clearing it
 *    frees Continue again (skipping is always fine).
 *  - Ready shows "Sage Cat · Miso".
 *  - Profile's companion card shows the name; Rename → an email shows the calm line, Save stays
 *    off and nothing is saved (GET /me still says Miso); a real rename saves (GET /me); Remove
 *    name clears it (GET /me → null) and the card says "No name yet".
 *  - Privacy: the name never leaves the app except to our own API's /onboarding/start and
 *    /me/companion — no request to Stream, analytics or anywhere else carries it.
 *
 * Env: MENTO_WEB, MENTO_API. `SHOTS=<dir>` writes screenshots.
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const SHOTS = process.env.SHOTS || '';
const NAME = 'Miso';
const RENAME = 'Pebble Paws';
const EMAIL = 'miso@example.com';

async function serverMe(token) {
  const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /me → ${res.status}`);
  return res.json();
}

async function waitForServerName(token, expected, label) {
  let me = await serverMe(token);
  for (let i = 0; i < 20 && (me.companion_name ?? null) !== expected; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    me = await serverMe(token);
  }
  if ((me.companion_name ?? null) !== expected) {
    throw new Error(`[${label}] server holds companion_name=${JSON.stringify(me.companion_name)}, expected ${JSON.stringify(expected)}`);
  }
  return me;
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const leaks = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  // Every outgoing request that carries a name we typed, anywhere but our own two endpoints.
  page.on('request', (req) => {
    const body = req.postData() || '';
    const url = req.url();
    const carries = [NAME, RENAME, EMAIL].some((n) => body.includes(n) || decodeURIComponent(url).includes(n));
    const allowed = url.startsWith(`${API}/onboarding/start`) || url.startsWith(`${API}/me/companion`);
    if (carries && !allowed) leaks.push(`${req.method()} ${url}`);
  });
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const shot = async (name) => {
    if (SHOTS && !reduced) await page.screenshot({ path: `${SHOTS}/companion-name-${name}.png` });
  };
  const enabled = async (id) =>
    page.evaluate((i) => {
      const el = document.querySelector(`[data-testid="${i}"]`);
      return Boolean(el) && el.getAttribute('aria-disabled') !== 'true';
    }, id);

  // --- Companion pick ---------------------------------------------------------------------
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  if ((await tid('companion-name-input').count()) !== 0) {
    throw new Error(`[${label}] the name field is on the resting screen (board A03 has none)`);
  }
  await tid('animal-cat').click();
  await tid('colour-sage').click();
  await tid('companion-name-input').waitFor({ timeout: 10000 });
  const placeholder = await tid('companion-name-input').getAttribute('placeholder');
  if (placeholder !== 'Maybe Miso') throw new Error(`[${label}] Cat placeholder is ${JSON.stringify(placeholder)}`);
  await page.waitForSelector('text=Name your companion', { timeout: 5000 });
  console.log(`[${label}] OK the field arrives after the pick, labelled, placeholder "${placeholder}"`);

  await tid('companion-name-input').fill(EMAIL);
  await tid('companion-name-invalid').waitFor({ timeout: 5000 });
  if (await enabled('continue')) throw new Error(`[${label}] Continue is live with an email as the name`);
  await shot('pick-invalid');
  await tid('companion-name-input').fill('');
  await page.waitForFunction(() => !document.querySelector('[data-testid="companion-name-invalid"]'), null, { timeout: 5000 });
  if (!(await enabled('continue'))) throw new Error(`[${label}] an empty name blocks Continue`);
  console.log(`[${label}] OK an email shows the calm line and holds Continue; empty frees it`);

  await tid('companion-name-input').fill(`  ${NAME} `);
  await shot('pick-typed');
  await tid('continue').click();

  // --- Ready ------------------------------------------------------------------------------
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  const pill = await tid('ready-companion-name').innerText();
  if (!pill.includes(NAME)) throw new Error(`[${label}] Ready pill says ${JSON.stringify(pill)}`);
  await page.waitForSelector('text=Sage Cat', { timeout: 5000 });
  await shot('ready');
  console.log(`[${label}] OK Ready: "Sage Cat${pill}"`);
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });

  const token = await page.evaluate(() => globalThis.localStorage.getItem('mento.session_token'));
  if (!token) throw new Error(`[${label}] no session token after onboarding`);
  await waitForServerName(token, NAME, label);
  console.log(`[${label}] OK the account holds the name (GET /me → ${NAME}, trimmed)`);

  // --- Profile ----------------------------------------------------------------------------
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(
    (n) => document.querySelector('[data-testid="profile-companion-name"]')?.textContent?.includes(n),
    NAME,
    { timeout: 30000 },
  );
  await shot('profile');
  console.log(`[${label}] OK Profile's companion card shows ${NAME}`);

  await tid('profile-companion-name-edit').click();
  await tid('profile-companion-name-input').waitFor({ timeout: 5000 });
  await tid('profile-companion-name-input').fill(EMAIL);
  await tid('profile-companion-name-invalid').waitFor({ timeout: 5000 });
  if (await enabled('profile-companion-name-save')) throw new Error(`[${label}] Save is live with an email`);
  await shot('profile-invalid');
  await tid('profile-companion-name-input').press('Enter');
  await page.waitForTimeout(600);
  await waitForServerName(token, NAME, label);
  console.log(`[${label}] OK an email on Profile shows the calm line and saves nothing`);

  await tid('profile-companion-name-input').fill(RENAME);
  await tid('profile-companion-name-save').click();
  await page.waitForFunction(
    (n) => document.querySelector('[data-testid="profile-companion-name"]')?.textContent?.includes(n),
    RENAME,
    { timeout: 10000 },
  );
  await waitForServerName(token, RENAME, label);
  await shot('profile-renamed');
  console.log(`[${label}] OK renamed on Profile → GET /me says ${RENAME}`);

  // It survives a reload (it lives on the account, not the screen).
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    (n) => document.querySelector('[data-testid="profile-companion-name"]')?.textContent?.includes(n),
    RENAME,
    { timeout: 30000 },
  );

  await tid('profile-companion-name-edit').click();
  await tid('profile-companion-name-remove').click();
  await page.waitForSelector('text=No name yet', { timeout: 10000 });
  await waitForServerName(token, null, label);
  console.log(`[${label}] OK Remove name → GET /me null, the card says "No name yet"`);

  await ctx.close();
  if (leaks.length) throw new Error(`[${label}] the name left for somewhere else:\n${leaks.join('\n')}`);
  console.log(`[${label}] OK the name only ever went to /onboarding/start and /me/companion`);
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('companion-name: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
