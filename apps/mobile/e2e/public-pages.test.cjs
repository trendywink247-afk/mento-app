// The public privacy and account-deletion pages the Play listing links to
// (app.mento.chat/privacy, /delete-account). Expo copies apps/mobile/public/ into the web
// export as is. They must stay static (the web CSP allows no inline script), name a contact,
// and keep the promises docs/PRIVACY.md makes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(PUB, p, 'index.html'), 'utf8');

for (const page of ['privacy', 'delete-account']) {
  test(`${page}: static page with a contact and a link to the other page`, () => {
    const html = read(page);
    assert.match(html, /^<!DOCTYPE html>/);
    assert.doesNotMatch(html, /<script/i, 'no scripts: the web CSP would block them');
    assert.doesNotMatch(html, /https?:\/\/(?!app\.mento\.chat)[^"]*\.(css|js)/i, 'no outside stylesheets or scripts');
    assert.match(html, /mailto:geekspacetech02@gmail\.com/);
    assert.match(html, page === 'privacy' ? /href="\/delete-account"/ : /href="\/privacy"/);
  });
}

test('privacy: the promises that must stay true', () => {
  const html = read('privacy');
  assert.match(html, /18 or over/);
  assert.match(html, /never included in any backup/);
  assert.match(html, /Clean Wipe/);
  assert.match(html, /Start fresh/);
  assert.match(html, /14416/);
});

test('delete-account: in-app steps match the app', () => {
  const html = read('delete-account');
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
  assert.ok(html.includes(en.startFresh.confirm), 'the confirm button text the page quotes');
  assert.match(html, /Without the app/);
});
