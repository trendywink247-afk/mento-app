// Desktop web frame proof (spec 2026-09-19-desktop-web-layout §9).
// Run:  MENTO_WEB=http://localhost:8082 NODE_PATH=<playwright>/node_modules node e2e/desktop-frame.e2e.js
// Read-only: never submits a form. Asserts, per viewport, normal + reduced motion:
//   - the app column's box (≤ columnMax, centered) — or the full window on phones and /admin
//   - the landing's Start key and an opened sheet sit inside the column
//   - landing → Start → role fork works; 0 page errors.
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const COLUMN_MAX = 480; // theme/layout.ts

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, column: 390 },
  { name: 'tablet', width: 768, height: 1024, column: COLUMN_MAX },
  { name: 'desktop', width: 1440, height: 900, column: COLUMN_MAX },
];

const near = (a, b) => Math.abs(a - b) <= 1;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures.push(label);
  };

  for (const vp of VIEWPORTS) {
    for (const motion of ['no-preference', 'reduce']) {
      const tag = `[${vp.name}${motion === 'reduce' ? ' reduced' : ''}]`;
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        reducedMotion: motion,
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const tid = (id) => page.locator(`[data-testid="${id}"]`);
      const inColumn = (box, col) => !!col && box.x >= col.x - 1 && box.x + box.width <= col.x + col.width + 1;
      const columnBox = async () => ((await tid('web-frame-column').count()) ? tid('web-frame-column').boundingBox() : null);

      await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
      await tid('start').waitFor({ state: 'visible', timeout: 60000 });
      const col = await columnBox();
      check(`${tag} column width ${vp.column}`, !!col && near(col.width, vp.column), JSON.stringify(col));
      check(`${tag} column centered`, !!col && near(col.x, (vp.width - vp.column) / 2), JSON.stringify(col));
      check(`${tag} column full height`, !!col && near(col.height, vp.height), JSON.stringify(col));
      const startBox = await tid('start').boundingBox();
      check(`${tag} Start key inside the column`, !!startBox && inColumn(startBox, col), JSON.stringify(startBox));

      await tid('start').click();
      await page.waitForURL(/\/onboarding/, { timeout: 30000 });
      await page.waitForTimeout(1500);
      const widest = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll('[role="button"], button')].map((el) => el.getBoundingClientRect().width), 0),
      );
      check(`${tag} role-fork doors no wider than the column`, widest > 0 && widest <= vp.column + 1, `widest=${widest}`);

      // A transparent-modal sheet must open inside the column, not across the window.
      await page.goto(`${WEB}/start-fresh`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(1200);
      const sheetRight = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll('[role="button"], button')].map((el) => el.getBoundingClientRect().right), 0),
      );
      const col2 = await columnBox();
      check(`${tag} sheet content inside the column`, !!col2 && sheetRight > 0 && sheetRight <= col2.x + col2.width + 1, `right=${sheetRight} col=${JSON.stringify(col2)}`);

      // /admin keeps its own wide layout.
      await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(800);
      const adminCol = await columnBox();
      check(`${tag} /admin is not framed`, !!adminCol && near(adminCol.width, vp.width), JSON.stringify(adminCol));

      check(`${tag} 0 page errors`, pageErrors.length === 0, pageErrors.join(' | '));
      await ctx.close();
    }
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
