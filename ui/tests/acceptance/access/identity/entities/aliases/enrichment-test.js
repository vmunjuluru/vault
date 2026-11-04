/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import { settled, visit } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import { setupMirage } from 'ember-cli-mirage/test-support';
import { login } from 'vault/tests/helpers/auth/auth-helpers';
import { allowAllCapabilitiesStub } from 'vault/tests/helpers/stubs';

const ALIAS_COUNT = 30;
const PAGE_SIZE = 15; // matches ENV.APP.DEFAULT_PAGE_SIZE in test environment

function buildAliasListPayload(count) {
  const keys = [];
  const key_info = {};
  for (let i = 0; i < count; i++) {
    const id = `alias-${String(i).padStart(2, '0')}`;
    keys.push(id);
    key_info[id] = {
      name: `alias-name-${String(i).padStart(2, '0')}`,
      mount_path: 'auth/userpass/',
      mount_type: 'userpass',
      mount_accessor: `auth_userpass_${i}`,
      canonical_id: `entity-${String(i).padStart(2, '0')}`,
    };
  }
  return { data: { keys, key_info } };
}

function aliasPathsIn(paths) {
  // attachAliasCapabilities uses identityCapabilities with identityType + alias id
  return paths.filter((p) => /identity\/(?:entity|entity-alias)\/id\/alias-\d+/.test(p));
}

module('Acceptance | identity/entities/aliases | page-scoped enrichment', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function () {
    this._originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    await login();

    this.server.get('/identity/entity-alias/id', () => buildAliasListPayload(ALIAS_COUNT));

    this.capturedPathBatches = [];
    this.server.post('/sys/capabilities-self', (_, request) => {
      const body = JSON.parse(request.requestBody);
      this.capturedPathBatches.push(body.paths || []);
      return allowAllCapabilitiesStub(['root'])(_, request);
    });
  });

  hooks.afterEach(function () {
    window.ResizeObserver = this._originalResizeObserver;
  });

  function latestEnrichmentPaths(batches) {
    for (let i = batches.length - 1; i >= 0; i--) {
      const paths = batches[i];
      if (aliasPathsIn(paths).length > 0) {
        return paths;
      }
    }
    return [];
  }

  test('page 1 capabilities-self paths are scoped to the current page, not all N aliases', async function (assert) {
    this.capturedPathBatches = [];

    await visit('/vault/access/identity/entities/aliases');
    await settled();

    const paths = latestEnrichmentPaths(this.capturedPathBatches);
    const aliasPaths = aliasPathsIn(paths);

    assert.ok(paths.length > 0, 'capabilities-self was called with enrichment paths');
    assert.ok(
      paths.length <= PAGE_SIZE + 2,
      `path count ${paths.length} is page-scoped (<= ${PAGE_SIZE + 2}), not full dataset`
    );
    assert.ok(
      paths.length < ALIAS_COUNT,
      `path count ${paths.length} is less than full N enrichment (${ALIAS_COUNT})`
    );

    assert.ok(
      aliasPaths.some((p) => p.includes('alias-00')),
      'page 1 enrichment includes first alias id'
    );
    assert.ok(
      aliasPaths.some((p) => p.includes('alias-14')),
      'page 1 enrichment includes last alias id on page 1'
    );
    assert.notOk(
      aliasPaths.some((p) => p.includes('alias-15')),
      'page 1 enrichment does not include page 2 alias ids'
    );
  });

  test('page 2 capabilities-self paths cover page 2 aliases and exclude page 1', async function (assert) {
    await visit('/vault/access/identity/entities/aliases');
    await settled();

    this.capturedPathBatches = [];

    await visit('/vault/access/identity/entities/aliases?page=2');
    await settled();

    const paths = latestEnrichmentPaths(this.capturedPathBatches);
    const aliasPaths = aliasPathsIn(paths);

    assert.ok(paths.length > 0, 'capabilities-self was called after navigating to page 2');
    assert.ok(paths.length <= PAGE_SIZE + 2, `page 2 path count ${paths.length} is page-scoped`);

    assert.ok(
      aliasPaths.some((p) => p.includes('alias-15')),
      'page 2 enrichment includes first alias id of page 2'
    );
    assert.ok(
      aliasPaths.some((p) => p.includes('alias-29')),
      'page 2 enrichment includes last alias id of page 2'
    );
    assert.notOk(
      aliasPaths.some((p) => p.includes('alias-00')),
      'page 2 enrichment does not include page 1 alias ids'
    );
    assert.notOk(
      aliasPaths.some((p) => p.includes('alias-14')),
      'page 2 enrichment does not include last page 1 alias id'
    );
  });
});
