/** Real localhost-only member/mentor browser acceptance. No Stream credentials.
 * Seed: services/api/.venv/Scripts/python.exe scripts/local/api.py own-fixture
 * Serve: scripts/local/workspace.ps1 api|web -OwnChatAcceptance
 * Run with isolated NODE_PATH/PLAYWRIGHT_BROWSERS_PATH (see e2e/README.md).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.local/own-chat-fixture.json'), 'utf8'));
if (manifest.api !== 'http://localhost:18000/api/v1' || manifest.web !== 'http://localhost:18081') {
  throw new Error('Own-chat browser acceptance is restricted to the isolated localhost workspace');
}
async function poll(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function context(browser, fixture, role, errors, external) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
    reducedMotion: fixture.motion === 'reduced' ? 'reduce' : 'no-preference' });
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    // The established ambient background loads CanvasKit lazily. Exercise its
    // offline fallback while still rejecting every external provider request.
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/canvaskit-wasm@')) return route.abort();
    external.push(`${url.protocol}//${url.host}`);
    return route.abort();
  });
  await ctx.addInitScript(({ fixture, role }) => {
    if (role === 'member') {
      localStorage.setItem('mento.session_token', fixture.member.token);
      localStorage.setItem('mento.persona', JSON.stringify({ id: fixture.member.id,
        persona_name: fixture.member.persona_name, persona_avatar: fixture.member.persona_avatar }));
      localStorage.setItem('mento.companion_animal', 'Cat');
      localStorage.setItem('mento.companion_colour', 'sage');
      localStorage.setItem('mento.role', 'mentee');
    } else localStorage.setItem('mento.listener.session_token', fixture.mentor.token);
    window.__ownTestSockets = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url, protocols) {
        super(url, protocols);
        if (String(url).includes('/chat/ws/')) {
          window.__ownTestSockets.push(this);
          this.__syntheticTerminalClose = () => {
            this.dispatchEvent(new CloseEvent('close', { code: 4403, reason: 'synthetic terminal authorization' }));
            this.close();
          };
        }
      }
    };
  }, { fixture, role });
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { ctx, page };
}
async function run(browser, fixture) {
  const errors = [], external = [];
  const member = await context(browser, fixture, 'member', errors, external);
  const mentor = await context(browser, fixture, 'mentor', errors, external);
  const m = member.page, l = mentor.page;
  const mtid = id => m.getByTestId(id), ltid = id => l.getByTestId(id);
  const api = async (suffix, method = 'GET', body) => {
    const response = await fetch(`${manifest.api}${suffix}`, {
      method, headers: { Authorization: `Bearer ${fixture.member.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.ok, true, `Local API ${suffix}: ${response.status}`);
    return response.json();
  };
  async function send(page, prefix, text) {
    const field = page.getByTestId(`${prefix}-input`);
    await field.fill(text); await field.press('Enter');
    await poll(async () => await field.inputValue() === '', 'Acknowledged composer did not clear');
  }
  try {
    await Promise.all([
      m.goto(`${manifest.web}/chat/${fixture.conversationId}?listener=Synthetic%20River`, { timeout: 180000 }),
      l.goto(`${manifest.web}/listener/chat/${fixture.conversationId}?member=Synthetic%20Cove`, { timeout: 180000 }),
    ]);
    await mtid('chat-ready').waitFor({ timeout: 180000 });
    await ltid('listener-chat-ready').waitFor({ timeout: 180000 });
    const first = `Synthetic hello ${fixture.motion}`;
    await send(m, 'composer', first);
    await l.getByText(first, { exact: true }).waitFor();
    await poll(async () => (await mtid('chat-delivery').textContent()).includes('Read'), 'Peer read sequence did not reach member UI');
    const reply = `Synthetic reply ${fixture.motion}`;
    await send(l, 'listener-composer', reply);
    await m.getByText(reply, { exact: true }).waitFor();
    const beforeReload = await api(`/chat/${fixture.conversationId}/messages?after=0`);
    const mentorMessage = beforeReload.messages.find(message => message.text === reply);
    await mtid(`save-card-${mentorMessage.id}`).click();
    await mtid(`saved-${mentorMessage.id}`).waitFor();
    await m.reload();
    await mtid('chat-ready').waitFor({ timeout: 60000 });
    await m.getByText(first, { exact: true }).waitFor();
    assert.equal(await m.getByText(first, { exact: true }).count(), 1);
    const beforeTerminal = await m.evaluate(() => window.__ownTestSockets.length);
    await m.evaluate(() => window.__ownTestSockets.at(-1).__syntheticTerminalClose());
    await mtid('own-chat-retry').waitFor();
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(await m.evaluate(() => window.__ownTestSockets.length), beforeTerminal,
      'Terminal authorization must never silently reconnect');
    await mtid('own-chat-retry').click();
    await mtid('chat-ready').waitFor();
    await m.getByText(first, { exact: true }).waitFor();
    assert.ok(await m.evaluate(() => window.__ownTestSockets.length) > beforeTerminal);
    const sockets = await m.evaluate(() => window.__ownTestSockets.length);
    await m.evaluate(() => window.__ownTestSockets.at(-1).close(1000, 'synthetic reconnect'));
    await poll(() => m.evaluate(count => window.__ownTestSockets.length > count &&
      window.__ownTestSockets.at(-1).readyState === WebSocket.OPEN, sockets), 'Socket did not reconnect');
    await mtid('chat-ready').waitFor();
    const after = `Synthetic after reconnect ${fixture.motion}`;
    await send(m, 'composer', after);
    await l.getByText(after, { exact: true }).waitFor();
    await send(l, 'listener-composer', `Synthetic reassurance ${fixture.motion}`);
    await send(m, 'composer', 'i want to kill myself');
    await mtid('crisis-card').waitFor();
    await ltid('crisis-card').waitFor();
    for (const card of [mtid('crisis-card'), ltid('crisis-card')]) {
      const resources = await card.innerText();
      assert.match(resources, /14416/);
      assert.match(resources, /1800-89-14416/);
      assert.doesNotMatch(resources, /1800-599-0019|KIRAN/i);
    }
    assert.equal(await l.locator('[data-testid^="self-mentor-"]').count(), 0);
    assert.equal(await mtid('typing-indicator').count(), 0);
    assert.equal(await ltid('listener-typing-indicator').count(), 0);
    const history = await api(`/chat/${fixture.conversationId}/messages?after=0`);
    assert.equal(history.messages.length, 5);
    assert.equal(history.messages.filter(message => message.text === first).length, 1);
    assert.equal(history.messages.at(-1).crisis.signal, 'suicidal');
    const accepted = path.join(root, '.local/own-chat-browser');
    fs.mkdirSync(accepted, { recursive: true });
    await m.screenshot({ path: path.join(accepted, `${fixture.motion}-member-crisis.png`) });
    await l.screenshot({ path: path.join(accepted, `${fixture.motion}-mentor-crisis.png`) });
    await mtid('open-options').click();
    await mtid('opt-end-wipe').click();
    await mtid('opt-confirm').click();
    await poll(async () => await m.getByText(first, { exact: true }).count() === 0 &&
      await l.getByText(first, { exact: true }).count() === 0, 'Wipe did not clear both active transcripts');
    const state = await api(`/conversations/${fixture.conversationId}/state`);
    assert.equal(state.status, 'wiped');
    const wipedHistory = await api(`/chat/${fixture.conversationId}/messages`);
    assert.deepEqual(wipedHistory.messages, []);
    assert.equal(wipedHistory.last_seq, 0);
    const notes = await api('/journals/mentor-notes');
    assert.ok(notes.some(note => note.body === reply), 'Explicitly saved notes must retain honest independent retention');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`PASS own-chat real browser ${fixture.motion}: two-party, read, save, reload, terminal/retry, reconnect, current crisis resources, UI wipe; zero page errors/external provider requests`);
  } catch (error) {
    const directory = path.join(root, '.local/own-chat-browser');
    fs.mkdirSync(directory, { recursive: true });
    await m.screenshot({ path: path.join(directory, `${fixture.motion}-member.png`) }).catch(() => {});
    await l.screenshot({ path: path.join(directory, `${fixture.motion}-mentor.png`) }).catch(() => {});
    console.error({ errors, external });
    throw error;
  } finally { await member.ctx.close(); await mentor.ctx.close(); }
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try { for (const fixture of manifest.fixtures) await run(browser, fixture); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
