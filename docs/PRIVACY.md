# Mento — Privacy Policy (engineering draft)

> **Status: draft, not published.** Written from the actual data flows in the codebase
> (`CLAUDE.md`, `docs/DECISIONS.md`, `services/api`) so it matches reality, not marketing
> copy. Needs founder review and a legal pass (India — DPDP Act 2023 — before this is the
> policy shown in-app or on any public page) before publication. Update this file in the
> same commit as any change to what data Mento collects or who can see it.

**Last reconciled against the codebase:** 2026-09-04 (session 29).

---

## 1. What Mento is, in privacy terms

Mento is an anonymous emotional-support chat app. You are never asked for your name,
a photo, or a phone number to use the core product. Everyone in a conversation — the
person seeking support and the listener — appears only as an auto-assigned persona
(e.g. "Purple Valley"). Real identity is never shown to the other party in a chat.

## 2. What we collect

- **Date of birth** — collected once at onboarding, solely to compute your age and
  enforce the 18+ minimum-age gate server-side. We do not retain or display your DOB
  or exact age anywhere else in the product.
- **Email — optional, and truly skippable.** Used only for account recovery / PIN
  reset if you choose to provide it. Never required to use Mento.
- **Chat messages** — stored by our real-time messaging provider (Stream Chat) to
  deliver the conversation to both participants, show typing/read state, and allow
  reconnection after a dropped connection. Deleting a conversation ("Panda Wipe")
  hard-deletes the channel and its messages from Stream's servers, not just your
  device — see §5.
- **Path (community/journey-stage) preference** — which community lens you've chosen
  (e.g. UPSC, NEET, "life") and where you are in that journey. This is deliberately
  **coarse** (a handful of categories, not free text), **optional**, and **clearable**
  at any time from your profile. It is used only as a soft signal to the matcher — it
  never blocks or delays being matched with a listener — picking a rare or no
  community never leaves you unmatched.
- **Journals** — mood, finance, gratitude entries, and mentor notes you save are
  stored so you can read them back. They are private to you; no one else, including
  listeners or admins, can read your journal.
- **Listener applications** (if you apply to become a listener) — motivation,
  community interests, availability, and optional email. Stored, not sent anywhere,
  until an admin reviews the application.
- **Device/technical data for error reporting** — if Sentry is configured, JS-level
  crash/error reports are captured with request bodies stripped. No message content
  or chat identifiers are included.
- **Anonymous product analytics** — if PostHog is configured, we record anonymized
  usage events (e.g. "reached chat screen," "opened Path tab") from a closed,
  allow-listed event list. **We never send message content, journal content, or any
  personally identifying field to analytics. Crisis-flagged sessions are excluded
  from all analytics/retention reporting.**

## 3. What we deliberately do NOT collect

No name, no photo, no government ID, no precise location, no contacts, no phone
number in the core user flow (phone verification via MSG91 is reserved for a future,
separate mentor-verification flow and does not apply to people seeking support).

## 4. Who can see what

- **Other users** see only your persona and, if you've set one, your growth-companion
  theme — never your identity, age, or contact details.
- **Listeners** (the people you're matched with) see your persona only. They do not
  see your age, email, or any identifying information, and they are not clinicians —
  Mento states this explicitly in onboarding and listener-facing copy. Listeners
  can **report** a conversation from their console; a report records only the
  conversation, a reason category and an optional short note — no new data about
  you is collected, and the report goes to the same human review as member reports.
- **Safety-review staff (admins)** can, through an audited, read-only admin tool,
  view the live content of a conversation **specifically when reviewing a
  crisis-safety flag or a user report/moderation case.** This access is logged in an
  audit trail (who viewed what, when). This is the one deliberate exception to
  "no one reads your chat," and it exists to keep people safe during a crisis or
  policy violation — not for general monitoring.
- **AI processing (opt-in only):** if you turn on AI journal note-sorting, your
  journal text is sent to a third-party AI model (Google Gemini) to organize it —
  this is off by default and only runs on journals, never on live chat messages.
  Separately, an automated (non-human) local filter scans outgoing chat messages to
  redact likely personal information (phone numbers, emails, etc.) before they're
  sent, as a safety measure — this filter runs locally in our backend, is not human
  review, and does not store the unredacted text.
- **Crisis-signal scanning** — every message is automatically scanned server-side
  for crisis-risk language as it's sent. If a message matches, the sender is shown
  verified India crisis helpline resources and the conversation is flagged for human
  safety review (see above). This scan cannot be bypassed by either party since it
  runs server-to-server before the message is delivered.

## 5. Deletion — "Panda Wipe"

Ending a conversation with Panda Wipe permanently deletes that conversation's
messages and channel from our servers (via Stream Chat's API), not just from your
device. This is a real, verified server-side delete — we do not claim on-device-only
deletion anywhere, because that would not be true while messages are also stored on
our messaging provider during an active conversation.

You can also clear your Path community/stage preference at any time; doing so
removes that soft-matching signal going forward.

## 6. Crisis support

If a message you send is flagged by our automated crisis-signal scan, you'll be shown
these India helplines (re-verified 2026-09-04):

- **Tele-MANAS — 14416** (or 1-800-891-4416), Ministry of Health & Family Welfare,
  24/7, free. [telemanas.mohfw.gov.in](https://telemanas.mohfw.gov.in/)
- **KIRAN — 1800-599-0019**, Ministry of Social Justice & Empowerment, 24/7, free,
  13 languages.

Being flagged for a crisis signal is designed to help you leave the conversation with
real support, not to retain you in the app — and these sessions are excluded from our
engagement/retention metrics.

## 7. Age

Mento is intended for users 18 and older. Date of birth is checked server-side at
onboarding to enforce this.

## 8. Payments

Contributions ("support the team") are optional, never required to use Mento, never
solicited inside an active conversation, and processed by Razorpay. This supports the
team/platform generally — it is not a fee for the person you spoke with and does not
unlock any feature.

## 9. Changes to this policy

Because Mento's data practices are defined by the code (redaction, crisis-scan,
analytics allow-lists, deletion), this document is kept in the same repository and
updated in the same change as any data-handling change described above.

## 10. Open items before this can be published

- Founder + legal (India, DPDP Act 2023) sign-off.
- A real user-facing surface (in-app screen + link) that displays this policy —
  not yet built.
- A named contact/grievance-officer point, required for DPDP compliance — not yet
  decided.
