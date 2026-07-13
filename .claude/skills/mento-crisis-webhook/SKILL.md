---
name: mento-crisis-webhook
description: Use when live-testing crisis-scan enforcement, Stream webhooks, or safety-flag behavior against the local Mento API.
---

# Crisis webhook — live test ritual

Unit tests (`tests/test_stream_webhook.py`) run hermetically. **Live** enforcement needs Stream to reach your local API through a tunnel.

## Steps

1. Stack up per **mento-stack** (real Stream creds in `services/api/.env`).
2. Tunnel: `cloudflared tunnel --url http://localhost:8000` → copy the `trycloudflare.com` URL. (Ephemeral — reconfigure every session; staging needs a stable URL, tracked in backlog.)
3. Point Stream at it: `.\.venv\Scripts\python.exe -m scripts.configure_stream https://<tunnel>`
4. **The proof that matters:** send a crisis-phrased message **straight through the Stream server API, bypassing the app UI**. Expect: a `SafetyFlag` row (signal only — never the body) AND the message augmented with a `crisis` payload. A benign message must produce neither. This proves enforcement is on the message path, not in the client.
5. Check the async safety net: the retried `message.new` webhook re-scans; both hooks dedupe on `safety_flags.stream_message_id`.

## Invariants you must not "fix"

- **Fail-open is deliberate.** API unreachable ⇒ message delivers unscanned (never hard-block a support chat); the retry hook catches it. Fail-open, never silent.
- The webhook signature check is **gzip-aware** — Stream signs the *decompressed* body. Don't simplify it.
- Helplines (Tele-MANAS 14416 / KIRAN 1800-599-0019) must be re-verified before launch — don't copy them into new surfaces without checking that task's status.

Output: flag + augmentation observed for the bypass message, benign pass-through confirmed, tunnel URL used (remind: it dies with the session).
