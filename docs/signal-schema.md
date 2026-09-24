# Signal schema

Release Oracle accepts a JSON or YAML signals document via `signals` or `signals_path`.
Unknown fields are ignored. All strings are treated as untrusted data.

## Top-level fields

| Field | Type | Description |
| --- | --- | --- |
| `commits` | array | `{ sha, message, author?, breaking? }` |
| `prs` | array | `{ number, title, labels?, draft? }` |
| `checks` | object | `{ total, success, failure, pending, required_failed, conclusions[] }` |
| `deployments` | object | `{ total, success, failure, pending, latest_state }` |
| `changelog` | object | `{ present, breaking_mentioned, path? }` |
| `findings` | array | `{ id, severity, title, package?, cve? }` |
| `incidents` | array | `{ id, severity, title, status, opened_at? }` |
| `metrics` | array | `{ name, value, threshold?, breached, unit? }` |
| `breaking_change` | boolean | Hint that the changeset includes a breaking change |
| `tests_failed` | number | Count of failed tests to merge into check summary |
| `tests_pending` | boolean | Marks checks as pending |

## Severity enums

* Findings: `critical` | `high` | `medium` | `low` | `info` | `unknown`
* Incidents: `sev1` | `sev2` | `sev3` | `sev4` | `unknown`
* Incident status: `open` | `mitigated` | `resolved` | `unknown`
* Deploy state: `success` | `failure` | `pending` | `inactive` | `error` | `unknown`

## Recommended checks allowlist

`rerun-failed-tests`, `security-review`, `changelog-review`, `incident-review`, `slo-review`, `manual-qa`, `canary-first`, `rollback-plan`

See also [`examples/signals.json`](../examples/signals.json) and [`examples/metrics.json`](../examples/metrics.json).
