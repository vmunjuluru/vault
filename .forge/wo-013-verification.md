# WO-013 — Full UI test suite verification (Handlebars 4.7.10)

## Environment
- Branch: `wo/vaishnavi-modernization`
- Handlebars: **4.7.10** (`ui/package.json` dependency + `pnpm.overrides`)
- Vault: `vault server -dev` on `127.0.0.1:9200`

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Template compile (`ember build --environment=test`) | **PASS** | `Built project successfully. Stored in "../http/web_ui".` |
| Residual handlebars 4.7.9 | **PASS** | `pnpm why handlebars` resolves only 4.7.10 |
| Identity acceptance (`ember exam --filter="access/identity"`) | **PASS** | **24 pass / 0 fail** |
| Test files modified by this story | **PASS** | Verification-only — no `ui/tests/**` edits in this WO |
| CI 15-way `test-ui` matrix | **DEFERRED** | Requires GitHub Actions on a PR; local build + identity suite green |

## Commands
```bash
cd ui
pnpm exec ember build --environment=test
CI=true VAULT_ADDR=http://127.0.0.1:9200 \
  pnpm exec ember exam --filter="access/identity" --path=../http/web_ui --launch=Chrome
```

## Notes
- Full 14-shard OSS matrix is intended to run via `.github/workflows/test-ui.yml` once a PR is opened.
- Pre-existing flaky failures should be compared against base-branch CI if any shard fails after PR open.
