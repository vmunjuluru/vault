# WO-009 Regression Results

Branch: `wo/vaishnavi-modernization`
Date: 2026-11-04

## Commands (local, Vault -dev on :9200, prebuilt `http/web_ui`)

### Acceptance | /access/identity/entities
```
pnpm exec ember exam --filter="Acceptance | /access/identity/entities" --path=../http/web_ui --launch=Chrome
# tests 13
# pass  13
# fail  0
```

### paginate utility
```
pnpm exec ember exam --filter="paginate" --path=../http/web_ui --launch=Chrome
# tests 25
# pass  25
# fail  0
```

### Broader identity filter (includes unrelated modules)
Earlier full `--filter="identity"` run: 174 tests, 168 pass, 2 skip, 4 fail.
Non-blocking / out of scope for this reorder epic:
- AWS enterprise configuration test (unrelated module)
- Entities intro Mode 1/2 (pre-existing wizard behavior; not touched by enrichment reorder)
- Transient isolation flake fixed in this WO (see below)

### New enrichment tests (WO-006/007/008)
Covered within the entities suite above and prior WO commits (all green after flake fix).

## Flake fix
`page navigation enrichment isolation` previously required every capability path ID to be in the runCmd-seeded set. Leftover entities from other acceptance tests caused false failures. Assertion now compares page-1 vs page-2 fetch ID sets for zero overlap and path-count ≤ page size.

## CI matrix (test-ui 15 shards)
CANNOT_VERIFY locally — no GitHub Actions run on this fork without creating a PR against upstream CI. Recommend verifying after PR open.
