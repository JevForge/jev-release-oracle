# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-09-24

### Added

* Initial public release of JEV Release Oracle
* Decisions: `proceed` | `warn` | `hold` | `review` with escalate-only policy floor
* Collectors for signals, changelog, findings/SARIF, incidents, metrics, GitHub compare/checks/deployments
* Jev providers: `vercel-ai-gateway`, `typesafe-native`, `custom-compatible`
* Optional PR comment, Check Run, report artifacts, and reviewer requests
* Effects allowlisted only — never publish releases or deploy

## [Unreleased]

### Changed

* Professional README, examples, and GitHub community templates for Marketplace readiness
* `.jev/config.yml` is loaded as a real default layer; explicit workflow inputs win.
* Release baselines support `new_only` deltas, including previous stable release reports.
* Security Sentinel and Cloud Cost Guardian outputs can be passed directly to the final gate.
* Provider diagnostics classify missing secrets, authorization, rate limits, timeouts, HTTP/network failures, and schema rejection.
* SARIF findings preserve rule, CVE, fingerprint, path, and line metadata; Check Runs update idempotently on reruns.
