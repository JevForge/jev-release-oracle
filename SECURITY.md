# Security policy

## Reporting a vulnerability

Do **not** open a public issue that includes secrets, tokens, or customer findings.

Prefer GitHub private vulnerability reporting for this repository when available (**Security → Advisories / Report a vulnerability**). Otherwise contact the JevForge organization maintainers through a private channel.

**Never** paste API keys, tokens, credentials, or other secrets into issues, PRs, or advisories.

## Scope

JEV Release Oracle reads release signals and asks Jev for a gate decision (`proceed`, `warn`, `hold`, `review`). A deterministic policy computes a floor from evidence and refuses any Jev choice weaker than that floor.

The Action does **not**:

* Publish GitHub Releases
* Create or promote deployments
* Rewrite application code
* Run shell commands from model output

## Data handling

Sent to Jev (selected provider only):

* Environment, refs, policy floor, risk counts
* Check/deploy summaries and a bounded sample of evidence metadata

Not sent:

* Provider API keys (used only for auth to the selected endpoint)
* Arbitrary free-form instructions as executable commands

## Controls

* Paths must remain inside `GITHUB_WORKSPACE`
* Custom Jev endpoints must be HTTPS
* No silent fallback between Jev providers
* Explanation text is display-only
* Side effects are allowlisted (outputs, fail/warn, optional comment / Check Run / reviewers)
