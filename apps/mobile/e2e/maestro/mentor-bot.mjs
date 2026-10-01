// mentor-bot.mjs — answers as a seeded mentor, through the API, while a Maestro
// flow drives the MEMBER side on an emulator (T6.1). Maestro only automates a
// single native app instance, so a two-party conversation needs a second
// participant that isn't a second phone: this script is that participant.
//
// It does NOT reimplement chat transport. Pre-WS5 (own chat), sending a message
// as a mentor happens over Stream, exactly like the real mentor console does —
// this script authenticates via the Mento API (same as the console) and then
// uses the SAME stream-chat client package the app itself depends on
// (apps/mobile/package.json already has it; nothing new to install).
//
// Usage:
//   node mentor-bot.mjs --token <listener-console-token> [--api http://localhost:8000/api/v1]
//                        [--stream-key <key>] [--reply "text"] [--timeout 60]
//
// The listener token is minted the same way a human mentor gets one — there is
// no bot-only auth path:
//   python -m scripts.seed_listeners                                  # from services/api
//   python -m scripts.issue_listener_token --name "<seeded persona>"  # prints #token=...
// Pull the token out of that link's #token= fragment and pass it with --token.
//
// What it does, in order:
//   1. GET /listener/me with the token — confirms the listener is real and
//      approved, gets its id, persona name and a Stream token.
//   2. Poll GET /listener/me/conversations until an ACTIVE one with a
//      stream_channel_id appears (a General match assigns one with no accept
//      step; a Personal request still needs POST .../accept — this script
//      accepts the oldest pending one automatically so either path works).
//   3. Connect to Stream as that listener, watch the channel, wait for a
//      message from the member side (anything not sent by this listener).
//   4. Send --reply (default: a short, in-character line) as one message.
//   5. Print MENTOR_BOT_OK and exit 0. Exits 1 with a clear reason on timeout
//      or any step failing — Maestro flows should treat a non-zero exit as a
//      failed flow, not hang waiting for a reply that will never come.
//
// Never message content the app wouldn't actually send: no real names, no
// "therapist" language, nothing that looks like real personal data. This is a
// test fixture, treated with the same care as a fixture in pytest.

import { StreamChat } from 'stream-chat';

function parseArgs(argv) {
  const out = { api: 'http://localhost:8000/api/v1', timeout: 60, reply: "I'm here — tell me more when you're ready." };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--token') out.token = argv[++i];
    else if (a === '--api') out.api = argv[++i];
    else if (a === '--stream-key') out.streamKey = argv[++i];
    else if (a === '--reply') out.reply = argv[++i];
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--accept-only') out.acceptOnly = true;
  }
  return out;
}

function fail(msg) {
  console.error(`MENTOR_BOT_FAIL: ${msg}`);
  process.exit(1);
}

async function api(base, path, token, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(fn, timeoutMs, label, intervalMs = 1000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token) fail('--token is required (mint one with scripts.issue_listener_token)');
  const streamKey = args.streamKey || process.env.EXPO_PUBLIC_STREAM_API_KEY;
  if (!streamKey) fail('--stream-key or EXPO_PUBLIC_STREAM_API_KEY is required');
  const timeoutMs = args.timeout * 1000;

  console.log(`mentor-bot: connecting to ${args.api}`);
  const me = await api(args.api, '/listener/me', args.token);
  console.log(`mentor-bot: authenticated as ${me.persona_name} (${me.id})`);

  // A Personal request needs an explicit accept; General matching already
  // assigned a live conversation with no accept step. Try both paths — accept
  // whatever is pending, so this script works for either flow without the
  // caller needing to know which kind of match it is.
  const pending = await api(args.api, '/listener/me/requests', args.token);
  const oldest = [...pending].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (oldest) {
    console.log(`mentor-bot: accepting pending request ${oldest.id}`);
    await api(args.api, `/listener/me/requests/${oldest.id}/accept`, args.token, { method: 'POST' });
  }

  // Only a conversation that did NOT exist when this script started counts. Earlier
  // flows in the same CI run leave their own conversations active (each flow onboards a
  // fresh member); without this the bot latched onto flow 1's chat, found flow 1's
  // message already there, replied into it, and exited 0 — while flow 2's member waited
  // forever in a different channel (T6.1 run 22: API log shows the listener calls landing
  // ~50s BEFORE flow 2 even onboarded).
  const before = await api(args.api, '/listener/me/conversations', args.token);
  const stale = new Set(before.map((c) => c.id));
  console.log(`mentor-bot: ignoring ${stale.size} conversation(s) that predate this run`);

  const convo = await waitFor(
    async () => {
      const rows = await api(args.api, '/listener/me/conversations', args.token);
      return rows.find((c) => !stale.has(c.id) && c.status === 'active' && c.stream_channel_id);
    },
    timeoutMs,
    'an active conversation with a Stream channel',
  );
  console.log(`mentor-bot: active conversation ${convo.id}, channel ${convo.stream_channel_id}`);

  if (args.acceptOnly) {
    console.log('MENTOR_BOT_OK (accept-only, no reply sent)');
    return;
  }

  // allowServerSideConnect: this script runs in Node, not a browser or app —
  // Stream's client otherwise warns/blocks connectUser outside a real client
  // runtime. The real app never sets this; only this test helper does.
  const client = new StreamChat(streamKey, { allowServerSideConnect: true });
  // A hung WebSocket handshake otherwise never rejects — this script would sit
  // silent until Maestro's own assertion timeout fires with no diagnosis at all
  // (seen once: the log just stopped right after "active conversation", nothing
  // after). Bound it so a real failure here is loud, not silent.
  console.log('mentor-bot: connecting to Stream');
  await withTimeout(
    client.connectUser({ id: me.id, name: me.persona_name }, me.stream_token),
    Math.min(timeoutMs, 30000),
    'Stream connectUser',
  );
  console.log('mentor-bot: connected, watching channel');
  const channel = client.channel('messaging', convo.stream_channel_id);
  await withTimeout(channel.watch(), Math.min(timeoutMs, 30000), 'channel.watch');

  await waitFor(
    async () => {
      const state = channel.state.messages;
      return state.some((m) => m.user?.id !== me.id) || null;
    },
    timeoutMs,
    "a message from the member",
  );
  console.log('mentor-bot: member message seen, replying');

  // The before-send hook can answer with a `type: 'error'` message instead of throwing
  // (allowance hold, moderation) — Stream then never saves it. Log and fail loudly rather
  // than reporting OK for a reply the member will never see (T6.1 flow 2 diagnosis).
  const sent = await channel.sendMessage({ text: args.reply });
  const m = sent.message;
  console.log(`mentor-bot: sendMessage -> id=${m?.id} type=${m?.type} status=${m?.status} text=${JSON.stringify(m?.text)}`);
  if (m?.type === 'error') fail(`reply was not kept by Stream (type=error, text=${JSON.stringify(m.text)})`);
  await client.disconnectUser();
  console.log('MENTOR_BOT_OK');
}

main().catch((err) => fail(err.message || String(err)));
