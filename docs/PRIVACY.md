# Mento — Privacy Policy (engineering draft)

> **Status: draft, not published.** Written from the actual data flows in the codebase
> (`CLAUDE.md`, `docs/DECISIONS.md`, `services/api`) so it matches reality, not marketing
> copy. Needs founder review and a legal pass (India — DPDP Act 2023 — before this is the
> policy shown in-app or on any public page) before publication. Update this file in the
> same commit as any change to what data Mento collects or who can see it.

**Latest scoped reconciliation:** 2026-10-04 — deletion, retained safety records,
backup content and recovery-receipt preparation (§2 journals, §5 and §10).
Other sections have not been fully re-audited in this update. Source behavior is
not proof that a change is deployed; the operational distinctions in §5 must be
verified again before publication.

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
  reconnection after a dropped connection. Deleting a conversation ("Clean Wipe")
  hard-deletes the channel and its messages from Stream's servers, not just your
  device — see §5.
- **Path (community/journey-stage) preference** — which community lens you've chosen
  (e.g. UPSC, NEET, "life") and where you are in that journey. This is deliberately
  **coarse** (a handful of categories, not free text), **optional**, and **clearable**
  at any time from your profile. It is used only as a soft signal to the matcher — it
  never blocks or delays being matched with a listener — picking a rare or no
  community never leaves you unmatched.
- **Your companion's name — optional.** If you name your growth companion (when you
  pick it, or later in Profile), we store that short name so the app can show it back
  to you. Only you ever see it: it is never shown to mentors or other members, never
  sent to our messaging provider or to analytics, and not shown to safety staff. It
  cannot hold links, email addresses or phone numbers. You can change or remove it
  in Profile, and Start fresh erases it with the rest of your account.
- **Journals** — mood, finance, gratitude entries, and mentor notes you save are
  stored so you can read them back. The journal feature is restricted to your
  account; mentors and admins do not have a journal-reading feature. Start fresh
  deletes your journal entries from active application storage. Recovery archives
  can contain saved entries; their treatment is described in §5.
- **Sign-in sessions** — the app refreshes its sign-in every few minutes; we keep a
  record of each sign-in session (which device session it is, when it started and
  ends) as a one-way hash, never the token itself. Start fresh deletes them.
- **An install label** — a random id the app makes on first open (not a hardware or
  advertising id). We keep only a one-way hash of it, for two safety signals: an
  age-gate refusal is remembered for a day, and a new account from the install of a
  suspended or banned member is flagged for the team to look at. It is never shown to
  anyone and never sent to analytics. Uninstalling the app resets it.
- **Your standing** — if the team suspends or bans an account for breaking the house
  rules, we keep that status, why, and until when.
- **Terms acceptance** — when you agreed to Mento's house rules, and which version.
- **Recovery code — optional.** If you make one in Profile, we keep a lookup part and
  a one-way (argon2id) hash of the rest — never the code itself. It can bring your
  account back on a new phone; Mento will never ask you for it.
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
- **Push notifications** show the other person's persona name and the kind of
  event (a request, an acceptance, a new message) — **never message content**. You can
  turn them off any time in your phone's system settings; nothing else changes.
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

## 5. Deletion — "Clean Wipe"

Clean Wipe ends the conversation and requests deletion of its messages and channel
from Stream Chat, the messaging provider used by the current client. The server
also deletes any own-chat message rows for that conversation from the active
application database. Own chat remains a separate, unfinished replacement; this
draft does not describe it as the deployed client transport.

Clean Wipe does not delete a journal note you separately saved from the chat or a
report narrative kept for safety review. Those records can contain quotations from
the conversation. Deletion from active storage also does not rewrite an existing
recovery archive; the backup and recovery boundary is described below.

You can also clear your Path community/stage preference at any time; doing so
removes that soft-matching signal going forward.

### Erasing everything — "Start fresh"

When Start fresh completes, it removes your Mento account and its associated
records listed below from active application storage, deletes its Stream account
and conversations, and clears the account from the app. You begin again with a new
account. It does not promise that every previously made backup has been rewritten
or that retained safety records have become anonymous.

**Deleted from active application storage:** your account record (your persona
name, date of birth, optional email, companion and its colour, and your Path
choice); every journal entry, including
Mentor Notes you saved from a chat; your saved mentors and any "stay in touch"
links (the mentor sees the link end); requests you sent to a mentor; your
notification registration; the daily message counts; your end-of-chat reflections;
any mentor application that did not become an active mentor role; and every
conversation — each open one is ended, and its messages and channel are
hard-deleted from our messaging provider (Stream Chat) exactly as Clean Wipe does,
together with your account there.

**Retained records:**

- **Crisis-safety flags** retain the signal category, detection source, risk score
  where supplied, timestamps and review information. The current signal-writing
  path stores the signal label, not the message body or the words that matched.
  Erasure removes the member-account link; conversation and message identifiers
  can remain to group and deduplicate safety records.
- **Reports** remain for safety review. Erasure clears the deleted member's
  reporter/subject account reference, but keeps the narrative and conversation
  reference. A narrative may contain quotations or identifying details supplied
  by its author; removing the account reference does not anonymize that text.
- **Audit records.** Existing staff audit records remain. Erasure adds an event
  recording counts of removed records, without the member's identifier in that
  new event.
- **Deletion receipts in the prepared recovery system** are described below.
  Their production activation is not established by this draft.

If our messaging provider cannot confirm a deletion at that moment, the
app says so and asks you to try again; it never tells you something was deleted when
it was not. Your open chats are ended either way.

**If you are also a mentor on Mento**, Start fresh cannot erase your account from the
app while your mentor role is active — doing so would leave the people you support
mid-conversation. Ask the Mento team to close your mentor side first; after that,
Start fresh erases everything as above.

### Backups and deletion receipts — activation still pending

**Engineering deployment note, not a live guarantee:** the latest recorded
operational evidence describes daily SQL backup copies. The prepared encrypted,
content-filtered six-hour backup flow has not been activated. The independent
deletion-receipt receiver has local synthetic test evidence, but is not deployed;
the required remote-acknowledgement gate remains disabled. Recheck the live state
before publishing this section as a statement of current practice.

The approved content policy for the new encrypted recovery archives retains
user-saved journal notes and moderation report narratives, while excluding chat
history itself. Saved notes and reports can contain quoted chat text, so excluding
the chat-history tables does not make an archive free of message-derived content.
This selection policy does not establish the contents of older backup copies.

Deleting an account from the active database does not edit every older archive.
Before a restored database can serve users, the recovery procedure must apply
deletion requests made after that snapshot and review restored background jobs
with outbound delivery disabled. Complete deletion coverage, independent receipt
recovery and the activation boundary still need operational acceptance; a restored
snapshot must stay closed to traffic while those checks are incomplete.

The prepared application code retains a one-way digest of the random account
identifier and a timestamp after erasure. The separate receiver is designed to
hold the corresponding deletion intent outside the primary database. These
receipts contain no name, email, persona, chat body, journal text or report
narrative, but can be matched to an account in a backup. They are pseudonymous
records, not anonymous statistics.

When the receiver gate is enabled, account deletion can finish only after the
receiver confirms durable storage. A failed acknowledgement keeps the account
available for retry and returns the incomplete-deletion response. A receipt may
already be stored even if the response is lost or a later account-deletion step
fails; it records the request, not proof that every deletion step completed.

The prepared receipt store has no automatic pruning. Receipts must be preserved
while a recoverable backup could reintroduce the account. This draft makes no new
promise about a fixed backup expiry period or immediate erasure from all archives.
Verified retention, archive access, recovery-key custody and provider-specific
deletion boundaries remain publication and activation checks.

## 6. Crisis support

If a message you send is flagged by our automated crisis-signal scan, you'll be shown
Tele-MANAS, India's 24/7 toll-free mental health support service (numbers re-verified
2026-10-05): **14416** or the alternate number **1800-89-14416**. Both numbers
reach the same service, not two independent providers.
[DGHS, Ministry of Health & Family Welfare](https://dghs.mohfw.gov.in/national-mental-health-programme.php)
lists both current numbers. The former KIRAN helpline was merged into Tele-MANAS
and scheduled for phase-out in 2024.
[Ministry announcement, 15 February 2024](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2006265&lang=2&reg=48)

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
- Reconfirm the deployed application and backup behavior before turning §5's
  preparation notes into public promises. Verify the backup inventory, retention
  and access rules, recoverable external keys, deletion-receipt coverage and
  primary-loss recovery. Keep the distinction between active deletion and archive
  expiry explicit. See [backup content and recovery policy](BACKUP_CONTENT_POLICY.md).
- Re-audit the rest of this draft against current source and deployed behavior;
  the 4 October update covers only the scoped items noted at the top.
- The install label, standing, terms acceptance and recovery-code bullets in §2
  (added with WS3, 2026-09-27) need the same sign-off; the full terms the house
  rules point to do not exist yet (T10.5).
- A real user-facing surface (in-app screen + link) that displays this policy —
  not yet built.
- A named contact/grievance-officer point, required for DPDP compliance — not yet
  decided.
