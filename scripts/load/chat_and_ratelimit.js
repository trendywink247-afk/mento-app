// k6 load script: chat send over the WebSocket + the rate-limit paths.
// NEVER point this at a host you do not own or at production. It is for a throwaway local
// stack or QA, and only with the owner's go. It is not run by CI.
//
//   k6 run -e BASE_URL=http://127.0.0.1:8000 -e SCENARIO=ratelimit scripts/load/chat_and_ratelimit.js
//   k6 run -e BASE_URL=... -e TOKEN=<member access token> -e CONVO=<conversation id> -e SCENARIO=chat ...
//
// Secrets: TOKEN comes from your shell or .secrets/; never paste it into a file or a PR.
// SCENARIO: ratelimit (default) | chat | health | all
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8000';
const API = `${BASE}/api/v1`;
const WS = BASE.replace(/^http/, 'ws') + '/api/v1/chat/ws';
const TOKEN = __ENV.TOKEN || '';
const CONVO = __ENV.CONVO || '';
const which = __ENV.SCENARIO || 'ratelimit';

const limited = new Counter('ratelimited_429');
const unexpected5xx = new Rate('unexpected_5xx');
const chatHeld = new Counter('chat_held_frames');
const chatErrors = new Counter('chat_error_frames');

const all = {
  // Anonymous endpoint with a per-IP limit (auth refresh: 60 per 10 min). Expect 401 until
  // the budget is spent, then 429, and never a 5xx.
  ratelimit: {
    executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '1m',
    preAllocatedVUs: 10, maxVUs: 30, exec: 'rateLimit',
  },
  // Plain reads: baseline latency for the health probes the monitors hit.
  health: {
    executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '1m',
    preAllocatedVUs: 20, maxVUs: 60, exec: 'health',
  },
  // Chat: N sockets on one conversation, each sending a message every few seconds. Real
  // limits apply (40 frames per 10 s per user, the message allowance), so held/error
  // frames are counted, not failed.
  chat: {
    executor: 'ramping-vus', startVUs: 1,
    stages: [{ duration: '30s', target: 20 }, { duration: '1m', target: 20 }, { duration: '15s', target: 0 }],
    exec: 'chat',
  },
};

export const options = {
  scenarios: which === 'all' ? all : { [which]: all[which] },
  thresholds: {
    unexpected_5xx: ['rate<0.001'],
    http_req_duration: ['p(95)<500'],
    ws_connecting: ['p(95)<1000'],
  },
};

export function rateLimit() {
  const r = http.post(`${API}/auth/refresh`, JSON.stringify({ refresh_token: 'load-test-invalid' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_refresh' } });
  if (r.status === 429) limited.add(1);
  unexpected5xx.add(r.status >= 500);
  check(r, { '401 or 429': (x) => x.status === 401 || x.status === 429 });
}

export function health() {
  const r = http.get(`${API}/health`, { tags: { name: 'health' } });
  unexpected5xx.add(r.status >= 500);
  check(r, { 'health 200': (x) => x.status === 200 });
  sleep(0.1);
}

export function chat() {
  if (!TOKEN || !CONVO) {
    throw new Error('chat scenario needs -e TOKEN and -e CONVO');
  }
  const res = ws.connect(`${WS}/${CONVO}`, {}, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', token: TOKEN, after: 0 })));
    socket.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'held') chatHeld.add(1);
      if (m.t === 'error') chatErrors.add(1);
    });
    socket.setInterval(() => {
      socket.send(JSON.stringify({ t: 'send', client_id: `k6-${__VU}-${Date.now()}`, text: 'load test message' }));
    }, 3000);
    socket.setInterval(() => socket.send(JSON.stringify({ t: 'ping' })), 25000);
    socket.setTimeout(() => socket.close(), 60000);
  });
  check(res, { 'ws upgraded (101)': (r) => r && r.status === 101 });
}
