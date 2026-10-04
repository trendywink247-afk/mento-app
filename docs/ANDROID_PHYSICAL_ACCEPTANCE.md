# Android physical-device acceptance

The founder has an Android phone. No authorized device was detected by the
read-only `adb devices -l` check on 2026-10-05. This is preparation, not a device
pass. iOS physical-device, signing and TestFlight acceptance remain pending.

Run this after the current screens and local browser acceptance pass, using a
reviewed APK built from the exact candidate commit under `H:\Mento gpt\Mento`.
Do not use the Desktop checkout, rebuild an accepted staging artifact during
promotion, publish an OTA, enable push, or change production release settings.

## Candidate and device prerequisites

1. Enable USB debugging on the test phone, connect its USB cable and approve the
   workstation's debugging prompt. Read-only discovery is `adb devices -l`.
   Require exactly one authorized target and use `adb -d` for that USB device.
   Keep serial numbers and account/device credentials out of committed evidence.
2. Record the full source SHA, APK SHA-256, build variant, embedded API origin,
   application ID, version/build number, update channel/runtime and signing
   certificate fingerprint. Use the APK's embedded configuration as evidence;
   a source `.env` file or successful browser run does not prove the binary.
3. Development, preview, staging and production currently share `com.mento.app`.
   Installing a test binary can replace an existing installation. Use a dedicated
   test installation with synthetic data. Before replacing an existing Mento
   installation, confirm its recovery route works and review this consequence.
   Never uninstall, clear app data or run a Maestro `clearState` flow on a real
   member's installation as a diagnostic shortcut.
4. Confirm the selected API is isolated local development or restricted staging.
   For local API access, use `scripts/local/workspace.ps1` and
   `scripts/local/api.py`; USB reverse forwarding may be configured only for the
   reviewed candidate's expected port. Never point the phone at production for
   synthetic acceptance. Staging phone requests need permitted operator-network
   access; a workstation's existing access does not establish phone access.
5. Do not reuse staging's Stream project concurrently for local live-chat testing.
   Use an explicitly separate development provider project or conduct the test
   entirely against the accepted staging environment with synthetic participants.
6. Install and launch only after candidate provenance and installation impact
   are reviewed. Keep automatic/manual OTA behavior visible: record whether the
   running app is the embedded binary bundle or a downloaded update. An unknown
   OTA revision invalidates exact-candidate acceptance. Do not shake/check for
   updates to repair a failing candidate.

## Manual acceptance matrix

Record Android version/model (no device serial), candidate SHA/hash, API origin,
runtime/channel and pass/fail evidence for each row. Use synthetic text and mask
credentials, recovery codes, tokens and private content in screenshots/logs.

| Area | Physical-device check | Required evidence |
|---|---|---|
| Cold start and onboarding | Release build launches without a development launcher; role fork, server age refusal, companion and terms flow work | Actual launch/onboarding result, no UI freeze or crash |
| Two-party chat | Synthetic member sends; synthetic mentor receives and replies | Both actual server acknowledgements and visible messages; no timeout inferred as delivery |
| Keyboard | Open/close keyboard; type/send on small screen; rotate only if supported | Input/send remain above keyboard, thread resizes, last message visible |
| Safety | Send the approved synthetic crisis phrase through the normal send path | Server signal and helpline card on both participants; no extra push/content telemetry |
| Reconnect | Disable/re-enable connectivity; background/resume; reload | Missed messages repaired once, no duplicate sends or cross-account transcript |
| Account controls | Suspend/revoke synthetic access, then exercise old credentials | Refusal before history/send; own-chat socket closure; account-status explanation remains accessible |
| Recovery and erasure | Recover a synthetic identity, wipe its chat and erase that synthetic account | Previous credentials/recovery reuse refused and deleted content absent; no real account involved |
| Accessibility | Device font scaling, TalkBack, reduced motion | Controls readable/reachable; labels/focus sensible; motion preference honored |
| Performance | Measure cold start, message round trip and repeated navigation on the phone | Recorded timings and device/network context; emulator/browser timing is not a substitute |
| Push | Leave pending while staging push is disabled | Separate reviewed provider/device test required for foreground/background delivery, permission refusal, quiet/snooze and token revocation |

Transport ownership matters: Stream remains the default. Mark own-chat native
acceptance pending until the native member and mentor screens actually use the
persisted own transport and pass this matrix. A native Stream pass or successful
own-chat browser test does not establish native own-chat parity.

## Store and iOS boundaries

`preview` is an internal-distribution profile; it is not TestFlight. The prepared
`staging` profile uses store distribution with preview environment/channel and
the existing app IDs. It defines a future build target, not signed/uploaded
artifacts, account ownership, reviewer access or accepted build numbers.

For iOS device builds, establish Apple Developer membership, matching identifier
ownership, signing/provisioning, and an iPhone; internal ad-hoc distribution also
requires registered device identifiers. TestFlight needs the App Store Connect
app record and authorized upload access. Simulator builds can be prepared without
an Apple Developer account but require a macOS simulator environment and do not
establish physical-device acceptance. See Expo's [internal distribution](https://docs.expo.dev/build/internal-distribution/),
[TestFlight](https://docs.expo.dev/submit/testflight/) and [simulator](https://docs.expo.dev/build-reference/simulators/) guidance.

Apple's upload requirement in effect since April 28, 2026 is Xcode 26 or later
with the iOS 26 SDK or later. Verify the actual build toolchain at build time;
configuration resolution does not prove it. [Apple SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).

Environment/channel selection is not installed-app isolation: the profiles still
share native identifiers, and Expo development clients can load updates from any
channel. Separate native identifiers need matching Firebase/APNs and provisioning
configuration before being adopted. [Expo profile configuration](https://docs.expo.dev/eas/json/),
[app variants](https://docs.expo.dev/build-reference/variants/).

## Handoff

Keep private device diagnostics in ignored `.local/physical-acceptance/<SHA>/`.
Commit only a sanitized evidence summary after completing the relevant matrix.
Any failed/unrun check stays explicit; no production or iOS acceptance follows
from this runbook. Resume with `Set-Location 'H:\Mento gpt\Mento'; adb devices -l`,
then review the candidate manifest and await the screen/browser acceptance gate.
