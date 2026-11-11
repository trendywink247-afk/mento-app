# Production and Play Console: the steps only the founder can do

Written 2026-11-10. Plain steps for the items that need an account, a key or a decision that the assistant does not have.
Nothing here is run by an agent. Never paste a key, a token or a decrypted env anywhere: refer to them by name.

## 1. The production message limit (do this first)

`ALLOWANCE_IN_A_ROW` defaults to 10 in code. The production secrets file may still set it, and a set value wins.

1. On a machine that holds the age key, from the repo root: `sops decrypt deploy/secrets/prod.env.sops.yaml | grep ALLOWANCE`. Look only at the numbers.
2. If `ALLOWANCE_IN_A_ROW` says 3, run `sops deploy/secrets/prod.env.sops.yaml`, change it to 10 (or delete the line), save, and commit.
3. `ALLOWANCE_ENFORCED` decides whether the cap is applied at all (QA has it off). Production needs it on if the cap should bind.

## 2. The four things production needs

| What | In plain words | Where it goes |
|---|---|---|
| The production address | The web address people reach the app at (for example `api.<your domain>`), and the host that serves it | `APP_BASE_URL`, `ADMIN_BASE_URL`, the Caddy site block, and `deploy/domains.env` |
| A server | The machine the app runs on. QA is `129.121.171.140` and is not production | `deploy/` holds the compose files and `deploy.sh`; the release workflows run them. Never run `deploy.sh` locally |
| The notification key | A Google service-account JSON that lets the server send push notifications | Mount the file on the server and set `FCM_SERVICE_ACCOUNT_FILE` to its path. Get it from Firebase Console: Project settings, Service accounts, Generate new private key. Do not commit it |
| The chat encryption key | Encrypts every chat message in the database | `MESSAGE_KEY` in the production SOPS env. Make one with `cd services/api && .venv/bin/python -m app.services.message_crypto k1`, copy the output into SOPS, never into a file or a message. **Without it own chat refuses to store messages.** Keep a safe copy: losing it makes old messages unreadable |

Order that works: address and server, then the two keys into SOPS, then a staging release, then check `/api/v1/health/ready`, then production. Both release workflows are started by hand (Actions tab) and no agent starts them.

## 3. Play Console (play.google.com/console, open the app)

Policy and programs, App content. Answers to give:

**Data safety**
- Data collected: none that identifies a person by name. Collected: date of birth (used once to check 18+, then only an age), optional email (recovery), messages (the chat itself), a random install id, push token, optional app-diagnostics.
- Mentors only: a document they choose to upload (ID card, posting letter, exam result) for verification. Shared with: nobody outside the team. Deleted: when the team decides, or after 30 days if unread.
- Notifications: the words of a message appear in a notification only if the person turns on "Show message text". Off by default. They then pass through Google's push service.
- Encrypted in transit: yes. Encrypted at rest: chat messages yes (AES-256-GCM).
- Users can ask for deletion: yes, in the app (Profile, Start fresh) and it is real deletion.
- Not sold, not used for ads.

**Target audience:** 18 and over only. **Content rating:** it deals with emotional support and crisis; answer the questionnaire honestly (no violence, no sexual content, user-generated chat).
**Health apps / sensitive:** declare it as a peer-support app, not a medical or therapy app ("mentors, not therapists" is already in the app). Point to the helplines.
**Privacy policy:** needs a public web page with the text of `docs/PRIVACY.md` after legal sign-off; paste its address into the Console.
**Account deletion:** the Console asks for a web address that explains how to delete an account. Use a page that says: open the app, Profile, Start fresh.
**Internal testing:** add testers' Google accounts under Testing, Internal testing, Testers; a tester who is not on the list sees "App not available".

## 4. Still open, not mine to do

- Legal and DPDP sign-off of `docs/PRIVACY.md` (document upload, "Show message text", the blocked-install row).
- Trademark check on the name and logo.
- Run the Rollback Rehearsal (Actions, "Isolated Rollback Rehearsal", branch `main`, stack `all`) before relying on the release path.
- Remove `native-gate` from the required checks on `main`.
- Revoke the "Founder QA" admin once testing is over.
- With the production age key open (same sitting as `MESSAGE_KEY`): `sops unset deploy/secrets/prod.env.sops.yaml '["GLITCHTIP_SECRET_KEY"]'` (unused since GlitchTip was removed 2026-11-11; harmless until then).
