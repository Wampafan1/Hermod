# Next.js Security Hardening Audit

## Current Version

- `package.json` range:
  - `next`: `^14.2.0`
  - `react`: `^18.3.0`
  - `react-dom`: `^18.3.0`
  - `next-auth`: `^4.24.0`
  - `eslint-config-next`: `^14.2.35`
- `package-lock.json` resolved version:
  - `next`: `14.2.35`
  - `react`: `18.3.1`
  - `react-dom`: `18.3.1`
  - `next-auth`: `4.24.13`
  - `eslint-config-next`: `14.2.35`
- `node_modules` installed version:
  - `next`: `14.2.35`
  - `react`: `18.3.1`
  - `react-dom`: `18.3.1`
  - `next-auth`: `4.24.13`
  - `eslint-config-next`: `14.2.35`
- `npm view next@14 version --json` shows `14.2.35` as the newest published Next 14 release.
- `npm view eslint-config-next@14 version --json` shows `14.2.35` as the newest published ESLint config for Next 14.
- `npm outdated next react react-dom next-auth` reports:
  - `next`: current `14.2.35`, wanted `14.2.35`, latest `16.2.4`
  - `react`: current `18.3.1`, wanted `18.3.1`, latest `19.2.5`
  - `react-dom`: current `18.3.1`, wanted `18.3.1`, latest `19.2.5`
  - `next-auth`: current `4.24.13`, wanted `4.24.14`, latest `4.24.14`

Conclusion: Hermod is not pinned to an older available Next 14 patch. The lockfile and installed package are already on the newest available Next 14 patch, `14.2.35`.

## npm audit Results

`npm audit --omit=dev` exits nonzero with 37 production dependency findings: 2 low, 31 moderate, and 4 high.

Relevant production findings:

- `next 9.3.4-canary.0 - 16.3.0-canary.5`
  - Severity: high
  - Advisories reported by npm:
    - `GHSA-9g9p-9gw9-jx7f`: self-hosted applications vulnerable to DoS via Image Optimizer `remotePatterns` configuration.
    - `GHSA-h25m-26qc-wcjf`: HTTP request deserialization can lead to DoS when using insecure React Server Components.
    - `GHSA-ggv3-7p47-pfv8`: HTTP request smuggling in rewrites.
    - `GHSA-3x4c-7xq6-9pq8`: unbounded `next/image` disk cache growth can exhaust storage.
    - `GHSA-q4gf-8mx6-v5v3`: Denial of Service with Server Components.
  - `npm audit` offers only `npm audit fix --force`, which would install `next@16.2.4`. That is a breaking major upgrade and is outside this pass.
- `postcss <8.5.10`
  - Severity: moderate
  - Reported both as a direct dependency and under `next/node_modules/postcss`.
  - The Next-associated remediation again points to `next@16.2.4`.
- `nodemailer <=8.0.4`
  - Severity: moderate
  - SMTP command injection advisories.
  - Fix is available via `npm audit fix`, but it is outside the requested Next-only package scope.
- `next-auth <=4.24.14`
  - Reported through vulnerable `uuid` transitive dependency.
  - `npm outdated` says `4.24.14` is available, but this pass only permits changing Next, `eslint-config-next`, and related lockfile entries.
- Other production findings include `@tootallnate/once`, `brace-expansion`, `lodash-es`, `minimatch`, `picomatch`, and `uuid` transitive advisories.

## Patch Action Taken

- Packages updated: none.
- Old versions: not applicable.
- New versions: not applicable.
- Why this was safe:
  - `next` is already resolved and installed at `14.2.35`, the newest published `14.x` patch.
  - `eslint-config-next` is already resolved and installed at `14.2.35`, matching the newest published `14.x` patch.
  - Updating to the npm-audit-remediated Next version would require a major jump to `16.2.4`, which this pass explicitly forbids.
  - React stayed on `18.3.1`; no React major upgrade was performed.

## Validation Results

- `npm ls next`: passed.
  - Root uses `next@14.2.35`.
  - `next-auth@4.24.13` also resolves to deduped `next@14.2.35`.
- `npm audit --omit=dev`: failed with known production dependency findings.
  - The relevant Next remediation requires a breaking major upgrade to `next@16.2.4`.
  - No package update was applied because there is no newer Next 14 patch to install.
- `npm outdated next react react-dom next-auth`: failed as expected because newer majors exist.
  - `next` current/wanted is `14.2.35`; latest is `16.2.4`.
  - `react` and `react-dom` current/wanted are `18.3.1`; latest is `19.2.5`.
  - `next-auth` current is `4.24.13`; wanted/latest is `4.24.14`.
- `npx prisma validate`: passed.
- `npx prisma generate`: initially failed with the known Windows Prisma locked-DLL `EPERM` rename issue.
  - Applied the documented local workaround by moving `node_modules/.prisma` aside inside the workspace.
  - Re-run passed and generated Prisma Client successfully.
- `npm run test`: passed.
  - 76 test files passed.
  - 1101 tests passed.
- `npm run build`: passed.
  - Next compiled successfully, type checking passed, and 107 static pages generated.
  - Existing lint warnings were emitted during build.
- `npm run lint`: passed with existing warnings.
  - Warning categories include font loading, `<img>` usage, and React hook dependency warnings.

## Remaining Risk

- A Next major upgrade is recommended, but it should be handled as a planned migration rather than hidden inside this patch-hardening pass.
- Current npm audit output still reports Next advisories against `14.2.35`; npm's available fix path is `next@16.2.4`.
- Before a Next 15/16 migration, test these areas explicitly:
  - `middleware`
  - auth routes
  - App Router API routes
  - server components
  - image/font usage
  - worker build/runtime
- Additional production dependency risk remains outside this pass:
  - `nodemailer` advisories should be handled in a focused mail-delivery dependency pass.
  - `next-auth` can move from `4.24.13` to `4.24.14`, but npm still reports the `uuid` advisory in that range.
  - Google Cloud, Univer, ExcelJS, pg-boss, glob, and utility transitive advisories need their own compatibility review.

## Recommendation

Safe on patched Next 14 for now.

Hermod is already on the newest published Next 14 patch, so there is no safe patch-only Next update to apply. The right next step is a dedicated Next major upgrade plan with browser/API/worker validation, because npm audit's Next remediation path is now a breaking major upgrade rather than a 14.x patch.
