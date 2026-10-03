# Architecture book alignment — 4 October 2026

Baseline: `H:\Mento gpt\Mento-Architecture-Book.html`, Edition 1, 20 September 2026, especially chapter 7.1. The original is preserved. This is an implementation crosswalk, not a replacement architecture or a claim that all book recommendations are complete.

**Yes: the Balanced design remains the baseline.** The founder's later direction adds local development plus VPS staging and production, uses both existing servers, and keeps one shared onboarding base. The enterprise growth diagram describes a later capacity stage; it must not silently replace the Balanced near-term plan with purchased managed services.

| Book decision | Verified implementation / gap | Next evidence required |
|---|---|---|
| 4 GB production host in India | A has about 4 GB; B about 2 GB. Physical region/residency is not proven by IP or capacity. | Verify provider region before making India-residency promises. No unapproved server purchase. |
| Caddy, local/production parity | Balanced Compose/Caddy files exist; serving hosts still use Nginx. H-workspace isolates data but is not full edge-stack parity. | Rehearse Balanced stack and HTTPS/WebSocket behavior before cutover. |
| Own chat, one write path, native thread | Backend work exists; live UI still uses Stream. | Client migration, safety/redaction/persistence/reconnect parity, deletion and load tests; planned single cutover with rollback. |
| Incremental Expo upgrades | Expo 54/55 PRs merged; source is SDK 55. Native correction and exact master Android run passed; full CI staging acceptance passed. | Fix reproducibility and verify native behavior; later SDK steps need compatibility evidence, not an automatic jump. |
| Keep Expo updates initially | EAS profiles and update config exist. | Audit effective production channel/runtime; keep self-hosted OTA as a later, measured decision. |
| Direct FCM; Apple push later | Push/worker code needs deployment and device proof; staging push is disabled. | Token scoping, quiet periods, revocation, background delivery and APNs acceptance. |
| Harden anonymous identity | Recovery and role-separated identity mechanisms exist; this is not proof of every chapter 7.1 hardening item. | Audit issuer/audience, rotation, device binding, abuse resistance and mentor one-time access against tests. |
| GlitchTip/Bugsink and own analytics | Not verified as deployed. | Licence/resource review, PII-safe events, symbolication and alert acceptance before installation. |
| Uptime/host/security monitoring | Kuma on B. Alert retry and semantic crisis-response fixes merged with simulated Linux tests; not installed on B. | Deploy script/helper together preserving destination/state; delivered alert proof, host saturation, backup failure and independent dead-man checks. |
| Encrypted off-site backups every 6 hours; exclude message bodies | Daily live copies remain unchanged. Encryption utilities, synthetic full-schema recovery and partition-exclusion drills passed. | Resolve saved-note/report policy, off-server key custody, deletion reconciliation and six-hour activation; see [content policy](BACKUP_CONTENT_POLICY.md). |
| Durable jobs, Valkey, tuned database | Staging runs worker/Postgres/Valkey. Production remains older API/Postgres/Redis with no running worker. | Worker health and retry/backlog tests, bounded aggregate DB pools and production acceptance. |
| GitHub Actions and blue/green | Full staging acceptance passed for 0882abe (run 37145025868), independently verified. Restricted production receiver/operator installed; promotion locked. Isolated Balanced and legacy rollback run 37136267615 passed. | Latest exact master checks → staging artifact → remaining production gates → controlled promotion. Isolated rollback evidence is not a live blue/green cutover. |
| Safety desk and assistive AI | Existing moderation/safety implementation is not the entire refined admin/AI plan. | Reconcile feature-by-feature with decisions; use evaluated human-assistive tools, never an AI substitute for the mentor. |
| Native/load/fuzz testing and store readiness | API/web and multiple real Android runs passed, including integrated tooling upgrades. Latest bd7856e Android run remains pending at this review. | Exact-head Android acceptance, capacity evidence, API fuzzing, iOS/device/signing and accurate policy/store disclosures. No user-capacity claim follows from deployment request drills. |

## Intentional changes since the book

- The old two-environment model becomes **local development → VPS B staging → VPS A production**. B also holds monitoring and backups, with explicit resource limits; it is not an automatic failover node.
- The 500–750 chat figure, latency targets, prices and time estimates in the book are historical targets/estimates, not verified capacity or current commercial facts.
- Retain shared onboarding for all communities and roles. Community direction includes UPSC, NEET and JEE; verified professional mentoring remains separately scoped.
- Keep provider replacement staged. Stream remains current until own-chat behavior, safety and recovery are proven; removing it early would violate the book's acceptance intent.

## Immediate order

1. Completed: fix the native layout regression; PR #13 and exact master Android checks passed.
2. Completed: PRs #13/#14/#18 and tooling upgrades #15–17 merged. Latest independently verified staging is 0882abe; consult PROGRESS for subsequent candidates.
3. Receiver/operator and isolated rollback are verified. Complete production worker execution, backup and safety/monitoring gates; keep promotion disabled.
4. Continue Balanced delivery and own-chat parity, then the remaining identity, telemetry, push, admin and store work in reviewable increments.
5. Move to the larger growth architecture only when measured capacity or availability requirements justify it.

Resume with [PROGRESS.md](../PROGRESS.md), current open PRs and exact-head workflow results. PR #13 is historical, not the current gate. Operational recipes: [cookbook](mento-cookbook.html). Broader sequencing: [enterprise plan](ENTERPRISE_PLATFORM_PLAN_2026-10-02.md).
