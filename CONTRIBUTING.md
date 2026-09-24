# Contributing

Thanks for helping improve JEV Release Oracle.

## Setup

```bash
git clone https://github.com/JevForge/jev-release-oracle.git
cd jev-release-oracle
npm ci
```

Requires **Node.js 24+**.

## Local checks

```bash
npm test
npm run typecheck
npm run build
# or
npm run all
```

## Guidelines

1. Keep the public decision schema backward compatible. Add reason codes; do not rename existing ones.
2. Keep Jev access behind `JevProvider`. Do not execute explanation text.
3. Recommended checks must stay inside the allowlist in `src/schemas/enums.ts`.
4. Rebuild and commit `dist/index.js` when the Action entrypoint changes (consumers do not run `npm install`).
5. Prefer small PRs with tests for schema, policy, and collector changes.

## Pull requests

Do not publish releases or Marketplace listings from a pull request.

## Issues

Never paste API keys, tokens, or secrets into issues.
