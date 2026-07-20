# Mento hero-shot prompt pack — 6-screen premium mockup set

> Generation-ready prompts for a consistent set of phone-mockup hero images of the **built** app
> (pitch decks, founder sharing, store-listing drafts). Written for **Higgsfield → Google Nano Banana 2**
> (the model that produced the companion set, session 13) but portable to any strong image model.
>
> **These are concept renders, not UI truth.** The app is the truth; renders must be reviewed against
> the live app before external use. Higgsfield free-plan **commercial-use terms are still unverified**
> (open decision, session 13) — internal/pitch use is fine, store-listing use needs that check first.

---

## Workflow (read first — CREDITS: **0** on the free plan, live-checked 2026-07-20; Nano Banana 2 costs 1.5/image, so any generation needs a **top-up first** — ~10 credits covers the 6-image set plus one regenerated style lock)

1. **Generate Screen 1 (landing) first** and attach `docs/hero-refs/landing-ref.png` as the image
   reference — it is a pixel-true capture of the live landing at 390×844. This render is the
   **style lock** for the whole set.
2. Review the style lock against the reference: cream must stay warm (not grey), indigo controlled
   (not neon), serif headline intact, text crisp and readable. Regenerate if any of those miss —
   don't carry a drifted style lock into five more renders.
3. Generate Screens 2–6 **each with the approved Screen-1 render attached as image reference**
   (style chaining — the same trick that locked the 6-animal companion set). Optionally also attach
   a live capture of that specific screen (see "More references" below).
4. Free-plan gotchas (session 13): **max 4 concurrent jobs**; Recraft is plan-gated — stay on
   Nano Banana 2 at **1.5 credits per image** ⇒ the 6-image set costs ~9 credits (+1/image for any
   background removal). Budget a couple of extra credits for regenerating a weak style lock.
5. Keep full-res originals + job IDs in `docs/hero-shots/` with a README, mirroring
   `docs/mascot-candidates/`.

**More references (free, exact):** open the app at 390×844 and screenshot any screen the same way
the landing was captured — onboarding steps are at `/onboarding`, tabs at `/chats` `/path`
`/journals`, chat via a dev match. A real capture attached alongside the style lock materially
improves fidelity for that screen.

---

## Design bible (locked — identical across all 6 prompts)

| Axis | Locked choice |
|---|---|
| Platform mode | Cross-platform premium, iOS-leaning presentation |
| Device frame | Slim modern iPhone-style mockup, thin matte charcoal bezel, portrait, one device per image, centered, even canvas margins on all four sides, soft indigo-tinted drop shadow |
| Canvas | 4:5 portrait, warm neutral studio backdrop `#F4EFEA` with ultra-subtle grain — the phone never touches the canvas edge |
| Palette | Warm cream `#FDF8F5` base · deep ink navy `#1D2142` text · indigo `#5847D6` accent · soft lavender `#8177C9` accent words · pale lavender washes `#F6F2FA`/`#ECE6F8` · white `#FFFFFF` cards. This indigo/lavender palette is the ratified brand — keep it, but keep saturation gentle, never neon |
| Typography | Headlines: literary serif (Lora-like), medium weight. UI/body: rounded humanist sans (Nunito-like). Text is ALWAYS crisp, dark-on-light, comfortably large. Never blurry, never decorative-tiny |
| Illustration | Flat vector illustration with soft shading, indigo-and-lavender figures with ink outlines (see reference image) — cute-but-dignified, never childish |
| Atmosphere | Soft aurora-like lavender gradient sky, faint drifting light motes, layered pastel mountain waves at screen bottoms — calm, breathing, Calm/Headspace register |
| Mood | Warm, safe, quiet, premium wellness. NO neon, NO glassmorphism, NO dark mode, NO charts, NO stat cards, NO badges/pills spam, NO glossy 3D |

---

## Screen 1 — Landing (STYLE LOCK — generate first, attach `hero-refs/landing-ref.png`)

> Premium mobile app hero mockup, 4:5 portrait canvas, warm neutral studio backdrop #F4EFEA with
> ultra-subtle film grain, one slim modern iPhone with thin matte charcoal bezel centered with even
> margins, soft indigo-tinted shadow. On screen, faithfully recreate the attached reference: a calm
> wellness app landing on warm cream #FDF8F5 under a soft lavender aurora wash. Top: small indigo
> speech-bubble logo containing a white heart, beside the lowercase serif wordmark "mento" in ink
> navy #1D2142. Middle: flat vector illustration of two people talking at a small table, indigo
> #5847D6 clothing, ink outlines, small plants, soft shading. Below, serif headline in ink navy,
> three lines: "A place to talk / with a peer who / understands." — the word "understands." in soft
> lavender #8177C9. Two small grey-lavender caption lines: "Anonymous. Judgment-free." and "Real
> conversations. When you need it most." Bottom: one full-width pill button in deep ink navy with
> white rounded-sans label "Start a Conversation" and a small chat-bubble icon; beneath it, layered
> pastel lavender mountain waves fill the bottom edge. Typography crisp and readable, generous
> whitespace, calm premium wellness register. No neon, no glassmorphism, no gradients on cards, no
> extra UI chrome, no dark mode.

## Screen 2 — Companion picker (attach approved Screen-1 render as reference)

> Same app, same device mockup, same canvas treatment as the reference image. Screen: a gentle
> "choose your growth companion" ritual on pale lavender #F6F2FA under the same aurora wash. Serif
> headline in ink navy near the top: "Choose your companion". Below, a 2×3 grid of soft white
> rounded cards, each holding one cute-but-dignified animal illustration with soft shading and a
> small indigo scarf: panda, fox, owl, turtle, deer, and a sixth gentle animal — natural fur
> colours, consistent style, ink-navy eyes, calm expressions. The panda card is gently highlighted
> with a pale indigo #ECE6F8 ring. One caption line in muted grey-lavender: "They'll grow with
> you." Bottom: ink-navy pill button "Continue". Generous spacing, crisp readable text, calm
> premium wellness register, no badges, no stats, no clutter.

## Screen 3 — Connecting (the wait as a story)

> Same app, same device mockup, same canvas treatment as the reference image. Screen: a quiet
> "finding someone for you" moment on warm cream #FDF8F5 under the deepest version of the lavender
> aurora sky, faint light motes drifting. Center: a minimal constellation — one small glowing
> indigo #5847D6 orb lower-left and one warm gold #F2A65A orb upper-right, joined by a thin
> luminous thread that visibly hasn't finished connecting, a few faint dotted arc accents around
> them. Serif headline in ink navy: "Finding someone who gets it". Beneath, one soft white rounded
> card with a small breathing-circle glyph and the sans caption "Breathe with me — in… and out."
> and three small pagination dots. Bottom caption in muted grey-lavender: "Usually under 30
> seconds." No spinner, no progress bar, no percentage — stillness and two orbs about to meet.
> Crisp readable text, vast calm whitespace, premium wellness register.

## Screen 4 — Live chat (the hero moment)

> Same app, same device mockup, same canvas treatment as the reference image. Screen: an anonymous
> 1:1 support chat on warm cream #FDF8F5. Top bar: small round avatar medallion with a soft indigo
> gradient and leaf motif, serif name "Steady Willow", tiny sans caption "Listener · online", all
> on a white header with a soft bottom shadow. Messages: left-aligned white rounded bubble with
> soft shadow "I'm here. What's been weighing on you today?"; right-aligned pale indigo #ECE6F8
> bubble "Honestly… the exam pressure is a lot right now."; another white bubble "That's real.
> Let's take it one piece at a time."; below it a subtle "Steady Willow is typing…" caption. All
> bubble text in the rounded humanist sans, ink navy, comfortably large. Bottom: white pill
> composer "Write what's on your mind…" with a round indigo #5847D6 send button holding a white
> paper-plane icon. No timestamps clutter, no read-receipt noise, no ads, calm generous spacing.

## Screen 5 — Path (community lens)

> Same app, same device mockup, same canvas treatment as the reference image. Screen: a gentle
> guidance tab on warm cream #FDF8F5 under a soft aurora wash. Serif headline top-left: "Your
> path". Below: one white rounded hero card with a small deer companion illustration (indigo
> scarf), serif card title "UPSC · The prelims wait", sans caption "The quiet stretch before
> results — we're with you." Then a row of two soft tappable prompt cards in pale lavender
> #F6F2FA with short sans lines: "I can't focus lately" and "The waiting is the hardest part".
> Beneath, a full-width ink-navy pill button "Talk to someone now" and a quiet text link "Browse
> listeners". Bottom: minimal tab bar on white with four simple line icons — chat bubble, a
> trail/signpost (highlighted indigo), journal, person — evenly spaced with tiny labels. Crisp
> readable text, calm rhythm, no badges, no streaks, no gamification.

## Screen 6 — Journals (quiet reflection)

> Same app, same device mockup, same canvas treatment as the reference image. Screen: a private
> journals hub on warm cream #FDF8F5. Serif headline top-left: "My journals". Below: a 2×2 grid of
> soft white rounded cards, each with a small flat illustration and serif label: "Mood" (small sun
> and cloud), "Gratitude" (open journal with a sprout), "Finance" (piggy bank with one gold coin),
> "Mentor notes" (journal with a chat bubble). Beneath the grid: one wider pale-lavender #F6F2FA
> card with a small notebook-and-pen illustration and two sans lines: "Journal Assistant" /
> "Turn tonight's thoughts into three kind words." Bottom: the same minimal white tab bar with the
> journal icon highlighted indigo. Generous spacing, crisp readable text, soft shadows only, no
> charts, no numbers, no streaks — a calm, private space.

---

## Post-generation review gate (before any external use)

- Text in renders is readable and typo-free (regenerate on any garbled type — never ship AI-mangled words).
- Palette held: warm cream (not grey/white), controlled indigo (not neon/purple-blue AI gradient).
- All six read as ONE product: same bezel, same scale, same margins, same light.
- Companion style matches `assets/companions/generated/` (dignified, scarf, natural colours).
- Nothing contradicts the real app in a way that overpromises (no invented features in frame).
- Log credits spent + job IDs in `docs/hero-shots/README.md`; carry the licence check as an open decision.
