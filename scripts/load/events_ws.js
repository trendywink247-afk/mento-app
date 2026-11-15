// Live events socket load test (docs/LIVE_EVENTS.md): N apps connect, authenticate and sit idle,
// the way foreground phones do. Measures connect time, auth success and events received; watch
// the API's memory and CPU (docker stats / top) while it holds.
//
// Never point this at a live host. Local or a throwaway stack only:
//   k6 run -e BASE=ws://127.0.0.1:18000 -e TOKENS=tokens.txt -e VUS=1000 -e HOLD=300 scripts/load/events_ws.js
// TOKENS: a file of "role token" lines (member|listener), one per virtual user, minted for
// seeded test accounts. A user beyond the file's length reuses tokens round-robin, which the
// server's 3-sockets-per-identity cap will then trim (expect 4409 closes in that case).
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE || 'ws://127.0.0.1:18000';
const HOLD = Number(__ENV.HOLD || 300); // seconds each socket stays open
const tokens = new SharedArray('tokens', () =>
  open(__ENV.TOKENS || 'tokens.txt')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 2),
);

const events = new Counter('events_received');
const helloMs = new Trend('hello_ms');
const closes = new Counter('server_closes');

export const options = {
  scenarios: {
    idle_apps: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '60s', target: Number(__ENV.VUS || 1000) },
        { duration: `${HOLD}s`, target: Number(__ENV.VUS || 1000) },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: { hello_ms: ['p(95)<1000'] },
};

export default function () {
  const [role, token] = tokens[(__VU - 1) % tokens.length];
  const started = Date.now();
  const res = ws.connect(`${BASE}/api/v1/events`, {}, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ t: 'auth', token, role })));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw);
      if (frame.t === 'hello') helloMs.add(Date.now() - started);
      else events.add(1);
    });
    socket.on('close', (code) => {
      if (code && code !== 1000) closes.add(1, { code: String(code) });
    });
    socket.setTimeout(() => {
      socket.send(JSON.stringify({ t: 'bye' }));
      socket.close();
    }, HOLD * 1000);
  });
  check(res, { 'upgraded (101)': (r) => r && r.status === 101 });
}
