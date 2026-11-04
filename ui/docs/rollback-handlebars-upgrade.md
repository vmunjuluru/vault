# Rollback: Handlebars 4.7.10 → 4.7.9

Runbook for reverting the Handlebars CVE remediation upgrade (4.7.9 → 4.7.10) if a template-compilation or UI regression is discovered after merge.

This procedure touches only the UI dependency pin and lockfile. It does **not** require backend or Go code changes.

## Prerequisites

- **Node** `24` (see `ui/package.json` `engines` / `devEngines`)
- **pnpm** `10.22.0` (project-standard package manager for `ui/`)
- Git access to the Vault repository (or your working fork)
- Ability to push a branch and observe `.github/workflows/test-ui.yml`

## Scope

Revert **only** Handlebars-related fields in `ui/package.json` and regenerate `ui/pnpm-lock.yaml`.

Do **not** revert unrelated dependency changes that may have landed in the same PR or afterward.

## Step 1 — Edit `ui/package.json`

1. Change the direct dependency:

   - `dependencies.handlebars`: `4.7.10` → `4.7.9`

2. Remove the override entry entirely (it did not exist in the pre-upgrade baseline):

   - Delete `pnpm.overrides.handlebars` (the `"handlebars": "4.7.10"` line under `pnpm.overrides`)

3. Leave all other `pnpm.overrides` entries untouched:

   - `@babel/runtime`
   - `ansi-html`
   - `braces`
   - `clean-css`
   - `kind-of`
   - `markdown-it`
   - `micromatch`
   - `rollup`
   - `tmp`
   - `ws`

## Step 2 — Regenerate the lockfile

From the repository root:

```bash
cd ui && pnpm install
```

Verify Handlebars resolutions:

```bash
# Expect 0 — no residual 4.7.10 pins
grep -c 4.7.10 pnpm-lock.yaml

# Expect a positive count — 4.7.9 is the sole Handlebars resolution
grep -c 4.7.9 pnpm-lock.yaml
```

If `grep -c 4.7.10` is not `0`, re-check Step 1 (especially that `pnpm.overrides.handlebars` was removed) and re-run `pnpm install`.

> **Note:** The regenerated lockfile may differ from the original pre-upgrade lockfile if other dependencies changed in the interim. That is expected. The gate is that **handlebars@4.7.10 does not appear** anywhere in `ui/pnpm-lock.yaml`.

## Step 3 — CI verification

1. Commit the `ui/package.json` + `ui/pnpm-lock.yaml` revert and push the branch.
2. Confirm `.github/workflows/test-ui.yml` is green for all jobs:
   - Matrix `ci-index` `0`–`14` (15 jobs total: lint + 14 test partitions)
   - The lint job (`ci-index` 0) runs `pnpm audit` among other checks
3. After rollback, `pnpm audit` is expected to report the three Handlebars CVEs again (CVE-2026-106446, CVE-2026-33937, CVE-2026-33938). That is the known pre-upgrade state — treat a green test matrix as the functional verification gate, not a clean audit.

## Known state after rollback

Once the direct pin is `4.7.9` and the `pnpm.overrides.handlebars` entry is removed:

- `ember-cli@5.8.1` and `ember-cli-dependency-checker@3.3.3` re-resolve to **handlebars@4.7.9** transitively
- That matches the expected pre-upgrade baseline (direct + transitive resolutions at 4.7.9)

## Optional: git-based revert

If the upgrade landed as a dedicated commit (or a small contiguous set of commits) that only changed Handlebars-related files, you may prefer:

```bash
git revert <handlebars-upgrade-commit-sha>
```

Then still run Step 2 verification greps and Step 3 CI. Prefer the field-level edits above when the upgrade commit also contains unrelated changes.
