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

const ENTITY_COUNT = 30;
const PAGE_SIZE = 15; // matches ENV.APP.DEFAULT_PAGE_SIZE in test environment

function buildEntityListPayload(count) {
  const keys = [];
  const key_info = {};
  for (let i = 0; i < count; i++) {
    const id = `entity-${String(i).padStart(2, '0')}`;
    const aliasId = `alias-${String(i).padStart(2, '0')}`;
    keys.push(id);
    key_info[id] = {
      name: `entity-name-${String(i).padStart(2, '0')}`,
      aliases: [{ id: aliasId, name: `alias-name-${String(i).padStart(2, '0')}` }],
    };
  }
  return { data: { keys, key_info } };
}

function entityPathsIn(paths) {
  return paths.filter((p) => /identity\/entity\/id\/entity-\d+/.test(p));
}

module('Acceptance | identity/entities | page-scoped enrichment', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function () {
    // HDS table/dropdown observers can emit a benign "ResizeObserver loop" error that QUnit fails on.
    this._originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    await login();

    this.server.get('/identity/entity/id', () => buildEntityListPayload(ENTITY_COUNT));

    // Capture every capabilities-self body after login so enrichment assertions are isolated.
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
    // Prefer the most recent batch that includes per-entity capability paths.
    for (let i = batches.length - 1; i >= 0; i--) {
      const paths = batches[i];
      if (entityPathsIn(paths).length > 0) {
        return paths;
      }
    }
    return [];
  }

  test('page 1 capabilities-self paths are scoped to the current page, not all N entities', async function (assert) {
    this.capturedPathBatches = [];

    await visit('/vault/access/identity/entities');
    await settled();

    const paths = latestEnrichmentPaths(this.capturedPathBatches);
    const entityPaths = entityPathsIn(paths);

    // Per page: entityAlias create + P entity paths + P alias paths (= 1 + 2P). Allow a small constant buffer.
    const maxExpected = PAGE_SIZE * 2 + 2;
    assert.ok(paths.length > 0, 'capabilities-self was called with enrichment paths');
    assert.ok(
      paths.length <= maxExpected,
      `path count ${paths.length} is page-scoped (<= ${maxExpected}), not full dataset`
    );
    assert.ok(
      paths.length < ENTITY_COUNT * 2,
      `path count ${paths.length} is less than full N enrichment (${ENTITY_COUNT * 2})`
    );

    // First page slice is entity-00 .. entity-14
    assert.ok(
      entityPaths.some((p) => p.includes('entity-00')),
      'page 1 enrichment includes first entity id'
    );
    assert.ok(
      entityPaths.some((p) => p.includes('entity-14')),
      'page 1 enrichment includes last entity id on page 1'
    );
    assert.notOk(
      entityPaths.some((p) => p.includes('entity-15')),
      'page 1 enrichment does not include page 2 entity ids'
    );
  });

  test('page 2 capabilities-self paths cover page 2 entities and exclude page 1', async function (assert) {
    // Seed page 1 first so mirage/auth state is warm, then navigate via query param
    // (entities ListTable pagination may not expose the same next-page control as ListView).
    await visit('/vault/access/identity/entities');
    await settled();

    this.capturedPathBatches = [];

    await visit('/vault/access/identity/entities?page=2');
    await settled();

    const paths = latestEnrichmentPaths(this.capturedPathBatches);
    const entityPaths = entityPathsIn(paths);

    assert.ok(paths.length > 0, 'capabilities-self was called after navigating to page 2');
    assert.ok(
      paths.length <= PAGE_SIZE * 2 + 2,
      `page 2 path count ${paths.length} is page-scoped`
    );

    assert.ok(
      entityPaths.some((p) => p.includes('entity-15')),
      'page 2 enrichment includes first entity id of page 2'
    );
    assert.ok(
      entityPaths.some((p) => p.includes('entity-29')),
      'page 2 enrichment includes last entity id of page 2'
    );
    assert.notOk(
      entityPaths.some((p) => p.includes('entity-00')),
      'page 2 enrichment does not include page 1 entity ids'
    );
    assert.notOk(
      entityPaths.some((p) => p.includes('entity-14')),
      'page 2 enrichment does not include last page 1 entity id'
    );
  });
});
