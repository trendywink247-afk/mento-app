# Maestro flows (T6.1)

Native (Android, real device/emulator) UI automation — a different tool from the
Playwright web e2e suite in `apps/mobile/e2e/*.e2e.js`, and testing a different
surface: those drive the web build, these drive the compiled native app.

**Why this exists:** the safety net for the Expo 52→57 upgrade (`T6.2` in
`docs/superpowers/plans/2026-09-20-mento-program-plan.md`). The plan's own
dependency rule: these three flows must pass on SDK 52 **before** the upgrade
starts, and are re-run after every one of the upgrade's five steps. If a step
breaks something, this is what catches it before the next step compounds it.

## The three flows

| File | What it proves |
|---|---|
| `onboarding-first-message.yaml` | Cold launch → role fork → age gate → companion pick → live chat → one message sent. The golden path every upgrade step re-checks. |
| `two-party-chat.yaml` | A member and a mentor in the same conversation, both directions. Needs `mentor-bot.mjs` running alongside it (below) — Maestro only drives one app instance. |
| `crisis-card.yaml` | A crisis-scan-triggering message ("I want to die" — this repo's own existing pytest fixture, not invented here) still sends, and the crisis card with helplines renders. Never held or blocked (T&S #1). |

All three reuse the same `testID`s the existing Playwright web specs already
select on (React Native Web converts `testID` → `data-testid` automatically),
so a regression here and a regression on the web side point at the same root
cause, not two unrelated ones.

## Prerequisites

- The API + Postgres + Redis running (`docs/CLAUDE.md` → "Commands" → "Run the
  stack"), with real Stream credentials configured — `chat-ready` never
  renders without them, and none of these three flows get past onboarding.
- Listeners seeded and online: `python -m scripts.seed_listeners` from
  `services/api`, then confirm at least one is online (the seed script sets
  this; re-run it if you've been testing and flipped statuses around).
- An Android emulator or device, with the app's debug build installed
  (`npx expo prebuild --platform android && cd android && ./gradlew
  assembleDebug`, per `docs/ANDROID_BUILD.md` — nothing new here, same build
  this project already documents).
- The Maestro CLI. **If you're on Windows:** the official installer
  (`curl -fsSL "https://get.maestro.mobile.dev" | bash`) does not produce a
  working `bin/maestro` on this platform as of CLI 2.10.0 — it downloads
  `lib/*.jar` correctly but the wrapper script and two JNA dependency jars
  (`jna` and `jna-platform`) are missing. Found and worked around getting this
  written (session 47/48):
  ```bash
  curl -fsSL -o ~/.maestro/lib/jna-5.14.0.jar \
    "https://repo1.maven.org/maven2/net/java/dev/jna/jna/5.14.0/jna-5.14.0.jar"
  curl -fsSL -o ~/.maestro/lib/jna-platform-5.14.0.jar \
    "https://repo1.maven.org/maven2/net/java/dev/jna/jna-platform/5.14.0/jna-platform-5.14.0.jar"
  # then invoke directly instead of via `maestro`:
  ( cd ~/.maestro/lib && java -cp "*" maestro.cli.AppKt "$@" )
  ```
  On macOS/Linux the official installer is expected to work as documented;
  this workaround is Windows-only.

## Running locally

```bash
# 1. Validate syntax without a device (fast, worth doing after any edit):
maestro check-syntax e2e/maestro/onboarding-first-message.yaml
maestro check-syntax e2e/maestro/two-party-chat.yaml
maestro check-syntax e2e/maestro/crisis-card.yaml

# 2. The golden path and the crisis card need nothing extra:
maestro test e2e/maestro/onboarding-first-message.yaml
maestro test e2e/maestro/crisis-card.yaml

# 3. two-party-chat.yaml needs mentor-bot.mjs running alongside it — start it
#    FIRST (it waits for the member's message), then run the flow:
cd services/api
.venv/Scripts/python.exe -m scripts.seed_listeners   # if not already done
.venv/Scripts/python.exe -m scripts.issue_listener_token --name "<a seeded persona>"
#   ^ copy the token out of the printed #token=... link

cd ../apps/mobile
node e2e/maestro/mentor-bot.mjs --token "<that token>" \
  --api http://localhost:8000/api/v1 --timeout 60 &

maestro test e2e/maestro/two-party-chat.yaml
wait   # check mentor-bot's exit code too — it prints MENTOR_BOT_OK or
       # MENTOR_BOT_FAIL with a reason
```

`mentor-bot.mjs` authenticates the same way the real mentor console does (a
console-link token, `scripts/issue_listener_token.py` — there's no bot-only
auth path) and sends its reply over Stream directly, using the `stream-chat`
package this repo already depends on. It does not reimplement chat transport;
pre-WS5 (own chat), Stream **is** the transport, exactly like the real
console.

## CI

`.github/workflows/maestro.yml` runs all three on
`reactivecircus/android-emulator-runner`, API level 33 (SDK 52's target — do
not bump this as an unrelated change; `T6.2` owns emulator-version bumps,
deliberately, one upgrade step at a time). Needs two repo secrets,
`STREAM_API_KEY` and `STREAM_API_SECRET` — the workflow fails fast with a
clear message if they're unset rather than silently skipping the flows that
need them.

## What's proven and what isn't (as of session 47/48)

- **Proven for real:** `mentor-bot.mjs` end to end, against a live local API +
  real Stream credentials — onboarded a member, matched a listener, minted a
  listener token, sent a member message, ran the bot, confirmed the reply
  actually landed in the channel (not just "no crash" — read the channel back
  and saw both messages). Also confirmed it fails cleanly (exit 1, clear
  reason) when no message ever arrives, rather than hanging.
- **Proven for real:** all three YAML flows' syntax, via `maestro
  check-syntax` against a real Maestro 2.10.0 install (not eyeballed).
- **Not proven:** the three flows have not run against a real emulator end to
  end. This machine's Android SDK has no AVD/system image set up, and
  provisioning one plus a full `expo prebuild` + Gradle build was out of scope
  for this pass. The CI workflow is believed correct (actionlint clean, each
  step's command verified independently — the build path matches
  `docs/ANDROID_BUILD.md`, the token-minting step tested standalone) but has
  never actually run. **Run it for real (locally or by pushing this branch)
  before trusting "the three flows pass on an emulator against SDK 52" as
  true** — that's the plan's own accept bar, and it isn't met yet.
