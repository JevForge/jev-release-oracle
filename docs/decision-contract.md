# Decision contract

Public decision shape validated by Zod (`src/schemas/oracle.ts`).

## Decision enum

| Value | Meaning | Default job effect |
| --- | --- | --- |
| `proceed` | Release risk is acceptable | Continue |
| `warn` | Elevated risk; continue unless `fail_on_warn` | Continue (or fail if configured) |
| `review` | Human review required | Fail unless `review_mode=continue` |
| `hold` | Do not ship | Always fail |

Rank (escalate-only): `proceed` < `warn` < `review` < `hold`.

## Required fields

| Field | Rules |
| --- | --- |
| `decision` | One of the enum values above |
| `confidence` | Number in `[0, 1]` |
| `reason_codes` | Non-empty array of known reason codes when decision is `hold` |
| `recommended_checks` | Subset of the allowlist in `src/schemas/enums.ts` |
| `held` | `true` iff `decision === 'hold'` |
| `jev_status` | `evaluated` \| `unavailable` \| `schema_rejected` |
| `policy_floor` | Deterministic floor before Jev escalation |

## Rejected examples

* `decision: "approve"` or `"block"` (wrong product enums)
* `recommended_checks: ["rm -rf /"]` (not allowlisted)
* `confidence: 1.5`
* Treating `explanation` as an executable command

Signal inputs: [signal-schema.md](signal-schema.md).
