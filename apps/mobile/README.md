# Mento mobile (apps/mobile)

Expo SDK 52 (React Native, TypeScript) + Expo Router. v1 slice: onboarding → anonymous match → chat shell with the crisis scan wired in.

## Run
```bash
cd apps/mobile
cp .env.example .env          # point EXPO_PUBLIC_API_URL at the backend
npm install
npx expo start                # press i / a, or scan the QR in Expo Go
```
Run the backend first (see `services/api/README.md`) and seed listeners so matching succeeds.

## Layout
```
app/                      Expo Router routes
  _layout.tsx             root stack
  index.tsx               landing
  onboarding/age.tsx      DOB + client-side age hint (server enforces the gate)
  onboarding/email.tsx    optional email (skippable)
  onboarding/companion.tsx growth companion (animal + colour)
  onboarding/connecting.tsx  calls /onboarding/start then /match
  chat/[id].tsx           chat shell + crisis-scan + helpline card
components/                PrimaryButton, Screen
lib/                       api client, secure session, onboarding draft
theme/tokens.ts            design tokens (consume these, never raw hex)
```

## Status — built, not yet run/verified
Authoring machine has no Expo runtime set up, so this has **not been `npm install`ed, typechecked, or launched**. Review and run before trusting. Known next steps:
- **Chat is a local shell.** Replace local message state with the Stream Chat channel (`stream-chat-expo`) using the stored `stream_token` + `match.stream_channel_id` for real-time delivery/typing/read-state.
- Wire conversation options (lock/status/pause/end/wipe/report) to the existing backend endpoints.
- Calibrate token hex against the mockups; add the panda/scenic illustrations.
