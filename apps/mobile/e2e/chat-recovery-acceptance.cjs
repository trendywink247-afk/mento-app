// Staging-only extension; every identity/conversation is created by its caller.
const { randomBytes } = require('node:crypto');
const marker = () => Array.from(randomBytes(12), n => String.fromCharCode(97 + n % 26)).join('');

async function checkRecovered({ offline, recipient, sender, input, send, received }) {
  // Numeric timestamps are intentionally redacted by the server's PII scan.
  const message = `Synthetic reconnect acceptance ${marker()}`;
  await offline.setOffline(true);
  await recipient.waitForFunction(() => !navigator.onLine);
  await input.fill(message);
  await send.click();
  await sender.waitForFunction(element => element.value === '', await input.elementHandle());
  await sender.waitForSelector(`text=${message}`, { timeout: 20000 });
  await offline.setOffline(false);
  await received(message).waitFor({ timeout: 45000 });
  await recipient.reload({ waitUntil: 'domcontentloaded' });
  await received(message).waitFor({ timeout: 60000 });
}

async function acceptRecovery({ web, api, memberContext, member, mentorContext, mentor, conversationId }) {
  if (web !== 'https://staging.mento.chat' || api !== `${web}/api/v1`) {
    throw new Error('Extended destructive acceptance is isolated-staging only');
  }
  await checkRecovered({ offline: memberContext, recipient: member, sender: mentor,
    input: mentor.getByTestId('listener-composer-input'), send: mentor.getByTestId('listener-composer-send'),
    received: message => member.locator('[data-testid^="msg-"]').filter({ hasText: message }).first() });
  console.log('OK offline member reconnect and reload preserve delivered history');
  await checkRecovered({ offline: mentorContext, recipient: mentor, sender: member,
    input: member.getByTestId('composer-input'), send: member.getByTestId('composer-send'),
    received: message => mentor.getByText(message, { exact: true }).first() });
  console.log('OK offline mentor reconnect and reload preserve delivered history');

  const token = await member.evaluate(() => localStorage.getItem('mento.session_token'));
  if (!token) throw new Error('Synthetic member token missing');
  const headers = { Authorization: `Bearer ${token}` };
  const wipe = await member.request.post(`${api}/conversations/${conversationId}/wipe`, { headers });
  if (wipe.status() !== 200 || !(await wipe.json()).deleted_from.includes('servers')) {
    throw new Error('Synthetic chat wipe failed');
  }
  const erased = await member.request.delete(`${api}/me`, { headers });
  if (erased.status() !== 200 || (await erased.json()).status !== 'erased') {
    throw new Error('Synthetic account erasure failed');
  }
  if ((await member.request.get(`${api}/me`, { headers })).status() !== 401) {
    throw new Error('Erased member still authorized');
  }
  console.log('OK synthetic chat wiped, account erased and previous access refused');
}

module.exports = { acceptRecovery };
