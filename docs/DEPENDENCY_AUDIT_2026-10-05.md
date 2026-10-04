# Dependency audit — 5 October 2026

Read-only `npm audit --omit=dev --json` against the SDK 55 lockfile at `7b6ad0e`
reported 32 affected packages: 22 high, 10 moderate, no critical. These are four
underlying advisories plus dependency propagation, not 32 independent flaws.
The raw report remains in ignored `.local/npm-audit-20261005.json`. No dependency
was installed, upgraded or downgraded by this audit. It is not a clean security
assessment, reachability proof, or production acceptance.

| Advisory | Observed path | Treatment required |
|---|---|---|
| [braces recursion exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces@3.0.3`, through glob/build tooling | Advisory lists no patched version. Verify all input sources and isolate build tooling; track upstream fix. Do not claim this harmless solely because the primary observed path is tooling. |
| [decode-uri-component decoding exhaustion](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Expo Router → `query-string@7.1.3` → `decode-uri-component@0.2.2` | Runtime URL parsing needs priority review. Fixed 0.5.0 is ESM, while this consumer is CommonJS; a blind override is not compatibility evidence. Validate supported router/consumer upgrade or a reviewed backport with malformed URL regressions on web and native. |
| [node-forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI and code-signing certificates → `node-forge@1.4.0` | Advisory lists no patched version. Installed Expo signing code calls the affected verification API; assess signed-update/build trust paths before enabling or claiming signing acceptance. Do not weaken verification to silence the finding. |
| [uuid output-buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Xcode project tooling → `uuid@7.0.3` | Observed `xcode` call uses `v4()` without an output buffer; the advisory targets v3/v5/v6 buffer writes. This is a limited source observation, not a complete transitive audit. Patched 11.1.1 supplies CommonJS exports but requires tested tooling compatibility before an override. |

The registry's automatic remediation proposes an Expo downgrade to 44.0.6 for
some propagated findings and a React Native jump for others. Neither is an
approved remediation. Keep Expo/React Native/Reanimated/worklets coordinated and
prove fixes locally before GitHub checks and staging. The nine existing dependency
PRs are still open for compatibility review; their existence does not establish
remediation of these four advisories.

CI currently lacks an enforced dependency/image/secret scanning policy. Add
reproducible scans with a reviewed, dated disposition for each existing finding;
do not silently suppress this baseline or represent a successful build as a clean
scan. API and container dependencies still require their own audit. Re-run the
registry audit at the eventual release candidate because advisory data changes.
