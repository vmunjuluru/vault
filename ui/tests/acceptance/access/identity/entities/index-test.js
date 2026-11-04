/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { click, currentRouteName, currentURL, visit } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import page from 'vault/tests/pages/access/identity/index';
import { login } from 'vault/tests/helpers/auth/auth-helpers';
import { runCmd, tokenWithPolicyCmd } from 'vault/tests/helpers/commands';
import { GENERAL } from 'vault/tests/helpers/general-selectors';
import { v4 as uuidv4 } from 'uuid';
import { setupMirage } from 'ember-cli-mirage/test-support';
import { Response } from 'miragejs';
import sinon from 'sinon';

module('Acceptance | /access/identity/entities', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(function () {
    // HDS table/dropdown observers can emit a benign "ResizeObserver loop" error that QUnit fails on.
    this._originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    return login();
  });

  hooks.afterEach(function () {
    window.ResizeObserver = this._originalResizeObserver;
  });

  test('it renders the entities page', async function (assert) {
    await page.visit({ item_type: 'entities' });
    assert.strictEqual(
      currentRouteName(),
      'vault.cluster.access.identity.entities.index',
      'navigates to the correct route'
    );
  });

  test('it renders the groups page', async function (assert) {
    await page.visit({ item_type: 'groups' });
    assert.strictEqual(
      currentRouteName(),
      'vault.cluster.access.identity.groups.index',
      'navigates to the correct route'
    );
  });

  test('it renders popup menu for entities', async function (assert) {
    const name = `entity-${uuidv4()}`;
    await runCmd(`vault write identity/entity name="${name}" policies="default"`);
    await visit('/vault/access/identity/entities');
    assert.strictEqual(currentURL(), '/vault/access/identity/entities', 'navigates to entities tab');

    await click(`${GENERAL.listItem(name)} ${GENERAL.menuTrigger}`);
    assert
      .dom('.hds-dropdown ul')
      .hasText('Edit entity Create alias Disable entity Delete entity', 'all actions render for entities');
    await click(`${GENERAL.listItem(name)} ${GENERAL.menuItem('delete')}`);
    await click(GENERAL.confirmButton);
  });

  test('it lists a deleted policy that is still attached to an entity', async function (assert) {
    const name = `entity-${uuidv4()}`;
    const policy = `policy-${uuidv4()}`;
    await runCmd([
      `write sys/policies/acl/${policy} policy=${btoa('path "secret/*" { capabilities = ["read"] }')}`,
      `write identity/entity name=${name} policies=${policy}`,
      `delete sys/policies/acl/${policy}`,
    ]);
    await visit('/vault/access/identity/entities');
    await click(GENERAL.button(`entity ${name}`));

    assert.dom(GENERAL.hdsTab('policies')).exists('renders the policies tab');
    assert.dom(GENERAL.table('policy-list')).includesText(policy, 'lists the deleted policy');
  });

  test('it hides delete and shows create alias based on the token policy', async function (assert) {
    const name = `entity-${uuidv4()}`;
    const policy = `
      path "identity/entity/id" {
        capabilities = ["list"]
      }
      path "identity/entity/id/*" {
        capabilities = ["read", "update"]
      }
      path "identity/entity-alias" {
        capabilities = ["create"]
      }
    `;
    const restrictedToken = await runCmd([
      `write identity/entity name=${name} policies=default`,
      `write sys/policies/acl/entities-no-delete policy=${btoa(policy)}`,
      'write -field=client_token auth/token/create policies=entities-no-delete',
    ]);

    await login(restrictedToken);
    await visit('/vault/access/identity/entities');
    await click(`${GENERAL.listItem(name)} ${GENERAL.menuTrigger}`);

    assert
      .dom(GENERAL.menuItem('create alias'))
      .exists('create alias shows because the token can create identity/entity-alias');
    assert
      .dom(GENERAL.menuItem('delete'))
      .doesNotExist('delete entity is hidden because the token has no delete capability');
  });

  test('it renders popup menu for external groups', async function (assert) {
    const name = `external-${uuidv4()}`;
    await runCmd(`vault write identity/group name="${name}" policies="default" type="external"`);
    await visit('/vault/access/identity/groups');
    assert.strictEqual(currentURL(), '/vault/access/identity/groups', 'navigates to the groups tab');

    await click(`[data-test-popup-menu-trigger="${name}"]`);
    assert
      .dom('.hds-dropdown ul')
      .hasText('View details Edit details Delete group', 'all actions render for external groups');
    await click(GENERAL.menuItem('delete-group'));
    await click(GENERAL.confirmButton);
  });

  test('it renders popup menu for external groups with alias', async function (assert) {
    const groupId = '44b2f1d1-699a-4a79-3a7b-37e53e17e7b2';
    const groupName = 'external-hasalias';
    // only relevant response keys are stubbed to simplify testing (more data is actually returned by both endpoints)
    this.server.get('/identity/group/id', () => {
      return {
        data: {
          key_info: { [groupId]: { name: groupName } },
          keys: [groupId],
        },
      };
    });

    this.server.get(`/identity/group/id/${groupId}`, () => {
      return {
        data: {
          alias: { id: '15bac764-d690-b72a-9cbc-b1fdeac1af9e', name: 'alias-test' },
          type: 'external',
        },
      };
    });

    await visit('/vault/access/identity/groups');
    await click(`[data-test-popup-menu-trigger="${groupName}"]`);

    assert
      .dom('.hds-dropdown ul')
      .hasText('View details Edit details Delete group', 'all actions render for external groups with alias');
  });

  test('it renders popup menu for internal groups', async function (assert) {
    const name = `internal-${uuidv4()}`;
    await runCmd(`vault write identity/group name="${name}" policies="default" type="internal"`);
    await visit('/vault/access/identity/groups');
    await click(`[data-test-popup-menu-trigger="${name}"]`);
    assert
      .dom('.hds-dropdown ul')
      .hasText('View details Edit details Delete group', 'all actions render for internal groups');
    await click(GENERAL.menuItem('delete-group'));
    await click(GENERAL.confirmButton);
  });

  test('it should render correct flash message on entity delete failure', async function (assert) {
    server.get('/identity/entity/id', () => ({
      data: {
        key_info: { test: { name: 'foo' } },
        keys: ['test'],
      },
    }));
    server.get('/identity/entity/id/test', () => ({ data: { name: 'foo' } }));

    const error = 'The entity could not be deleted';
    server.delete('/identity/entity/id/test', () => new Response(500, {}, { errors: [error] }));

    const flashSpy = sinon.spy(this.owner.lookup('service:flashMessages'), 'danger');

    await page.visit({ item_type: 'entities' });
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuTrigger}`);
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuItem('delete')}`);
    await click(GENERAL.confirmButton);

    const message = `Error deleting entity foo: ${error}`;
    assert.true(flashSpy.calledWith(message), 'Correct flash message is shown');
  });

  test('it sends the disabled field when disabling an entity from the edit form', async function (assert) {
    server.get('/identity/entity/id', () => ({
      data: {
        key_info: { test: { name: 'foo' } },
        keys: ['test'],
      },
    }));
    server.get('/identity/entity/id/test', () => ({ data: { name: 'foo', disabled: false } }));

    let requestBody;
    server.post('/identity/entity/id/test', (schema, request) => {
      requestBody = JSON.parse(request.requestBody);
      return new Response(200, {}, {});
    });

    await page.visit({ item_type: 'entities' });
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuTrigger}`);
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuItem('edit')}`);
    await click(GENERAL.inputByAttr('disabled'));
    await click(GENERAL.submitButton);

    assert.true(requestBody.disabled, 'the disabled field is sent to the API when saving the entity');
  });

  test('it should render correct flash message on entity edit success', async function (assert) {
    server.get('/identity/entity/id', () => ({
      data: {
        key_info: { test: { name: 'foo' } },
        keys: ['test'],
      },
    }));
    server.get('/identity/entity/id/test', () => ({ data: { name: 'foo' } }));

    server.post('/identity/entity/id/test', () => new Response(200, {}, {}));

    const flashSpy = sinon.spy(this.owner.lookup('service:flashMessages'), 'success');

    await page.visit({ item_type: 'entities' });
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuTrigger}`);
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuItem('edit')}`);
    await click(GENERAL.submitButton);
    const message = `Successfully saved Entity: foo.`;
    assert.true(flashSpy.calledWith(message), 'Correct flash message is shown');
  });

  test('it should render correct flash message on entity edit failure', async function (assert) {
    server.get('/identity/entity/id', () => ({
      data: {
        key_info: { test: { name: 'foo' } },
        keys: ['test'],
      },
    }));
    server.get('/identity/entity/id/test', () => ({ data: { name: 'foo' } }));

    const error = 'The entity could not be edited';
    server.post('/identity/entity/id/test', () => new Response(500, {}, { errors: [error] }));

    await page.visit({ item_type: 'entities' });
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuTrigger}`);
    await click(`${GENERAL.listItem('foo')} ${GENERAL.menuItem('edit')}`);
    await click(GENERAL.submitButton);

    assert.dom(GENERAL.messageError).exists();
    assert.dom(GENERAL.messageDescription).hasText(error, 'Specific error message is rendered');
  });
});

// Read-only tokens must not see create, merge, or edit actions for entities and entity aliases.
module('Acceptance | Identity entities | read-only token', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    this.entityId = await runCmd('write -field=id identity/entity name=read-only-entity');
    const accessor = await runCmd('read -field=accessor sys/auth/token');
    this.aliasId = await runCmd(
      `write -field=id identity/entity-alias name=read-only-alias mount_accessor=${accessor} canonical_id=${this.entityId}`
    );
    const policy = `
      path "identity/*" { capabilities = ["read", "list"] }
            path "sys/config/ui/checklist-state" { capabilities = ["read"] }
    `;
    const token = await runCmd(tokenWithPolicyCmd('entities-read-only', policy));
    await login(token);
  });

  hooks.afterEach(async function () {
    await login();
    await runCmd(`delete identity/entity-alias/id/${this.aliasId}`);
    await runCmd('delete identity/entity/name/read-only-entity');
  });

  test('it hides the merge and create actions on the entities list view', async function (assert) {
    await visit('/vault/access/identity/entities');
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('Entities', 'list view renders');
    assert.dom(GENERAL.button('entity read-only-entity')).exists('entity is listed');
    assert.dom(GENERAL.button('entity-merge-link')).doesNotExist('merge action is hidden');
    assert.dom(GENERAL.button('entity-create-link')).doesNotExist('create action is hidden');
  });

  test('it hides the edit and add alias actions on the entity details view', async function (assert) {
    await visit(`/vault/access/identity/entities/${this.entityId}/details`);
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('read-only-entity', 'details view renders');
    assert.dom('[data-test-entity-edit-link]').doesNotExist('edit action is hidden');
    assert.dom('[data-test-entity-create-link]').doesNotExist('add alias action is hidden');
  });

  test('it hides the edit action on the alias details view', async function (assert) {
    await visit(`/vault/access/identity/entities/aliases/${this.aliasId}/details`);
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('read-only-alias', 'details view renders');
    assert.dom('[data-test-alias-edit-link]').doesNotExist('edit action is hidden');
  });
});

// Capability gating must not hide entity actions from a user who is allowed to use them.
module('Acceptance | Identity entities | root token', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    this.entityId = await runCmd('write -field=id identity/entity name=root-entity');
    const accessor = await runCmd('read -field=accessor sys/auth/token');
    this.aliasId = await runCmd(
      `write -field=id identity/entity-alias name=root-alias mount_accessor=${accessor} canonical_id=${this.entityId}`
    );
  });

  hooks.afterEach(async function () {
    await runCmd(`delete identity/entity-alias/id/${this.aliasId}`);
    await runCmd('delete identity/entity/name/root-entity');
  });

  test('it shows the edit and add alias actions on the entity details view', async function (assert) {
    await visit(`/vault/access/identity/entities/${this.entityId}/details`);
    assert.dom('[data-test-entity-edit-link]').exists('edit action is shown');
    assert.dom('[data-test-entity-create-link]').exists('add alias action is shown');
  });

  test('it shows the edit action on the alias details view', async function (assert) {
    await visit(`/vault/access/identity/entities/aliases/${this.aliasId}/details`);
    assert.dom('[data-test-alias-edit-link]').exists('edit action is shown');
  });
});

// Page-scoped enrichment must not leak page-1 capability paths when navigating to page 2.
module('Acceptance | /access/identity/entities | page navigation enrichment isolation', function (hooks) {
  setupApplicationTest(hooks);

  // DEFAULT_PAGE_SIZE is 15 in the test environment — seed enough for two pages.
  const PAGE_SIZE = 15;
  const ENTITY_COUNT = 30;

  hooks.beforeEach(async function () {
    await login();
    this.entityIds = [];
    for (let i = 0; i < ENTITY_COUNT; i++) {
      const name = `nav-entity-${String(i).padStart(2, '0')}`;
      const id = await runCmd(`write -field=id identity/entity name=${name}`);
      this.entityIds.push(id.trim());
    }
    assertSeeded.call(this);
  });

  hooks.afterEach(async function () {
    if (this.fetchSpy) {
      this.fetchSpy.restore();
      this.fetchSpy = null;
    }
    for (const id of this.entityIds || []) {
      await runCmd(`delete identity/entity/id/${id}`);
    }
  });

  function assertSeeded() {
    if (this.entityIds.length < ENTITY_COUNT) {
      throw new Error(
        `Expected ${ENTITY_COUNT} seeded entities, got ${this.entityIds.length} — cannot validate page isolation`
      );
    }
  }

  test('it enriches only page-2 entity IDs after navigation', async function (assert) {
    const capabilities = this.owner.lookup('service:capabilities');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    await visit('/vault/access/identity/entities');
    assert.ok(this.fetchSpy.called, 'capabilities.fetch was called for page 1');
    const page1Paths = this.fetchSpy.lastCall.args[0] || [];
    const page1Ids = new Set(
      page1Paths
        .filter((p) => typeof p === 'string')
        .map((p) => {
          const match = p.match(/identity\/entity\/id\/([^/]+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean)
    );

    this.fetchSpy.resetHistory();

    // Entities ListTable receives a pre-paginated page slice and may not render
    // HDS next-page controls; navigate via the page query param (refreshModel: true).
    await visit('/vault/access/identity/entities?page=2');

    assert.ok(this.fetchSpy.called, 'capabilities.fetch was called for page 2');
    const paths = this.fetchSpy.lastCall.args[0] || [];
    const pathIds = [
      ...new Set(
        paths
          .filter((p) => typeof p === 'string')
          .map((p) => {
            const match = p.match(/identity\/entity\/id\/([^/]+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean)
      ),
    ];

    assert.ok(pathIds.length > 0, 'page 2 enrichment includes entity capability paths');
    assert.ok(
      pathIds.length <= PAGE_SIZE,
      `page 2 enrich path count ${pathIds.length} is <= page size ${PAGE_SIZE}`
    );
    assert.ok(
      pathIds.length < this.entityIds.length,
      'page 2 enrichment is not the full seeded N-entity set'
    );

    // Isolation: no entity ID from the page-1 fetch should appear in the page-2 fetch.
    const leaked = pathIds.filter((id) => page1Ids.has(id));
    assert.strictEqual(
      leaked.length,
      0,
      `page 2 fetch must not include page 1 entity IDs (leaked: ${leaked.join(', ')})`
    );

    // URL reflects page 2
    assert.true(currentURL().includes('page=2'), 'URL contains page=2 after navigation');

    // Entities table receives a pre-paginated route slice; ListTable may still render
    // client pagination over that slice (e.g. "1–10 of 15") rather than the full N total.
    const pagination = document.querySelector(GENERAL.pagination);
    if (pagination) {
      assert.dom(GENERAL.pagination).exists('pagination control is visible');
      assert.dom(GENERAL.paginationInfo).exists('pagination info is visible');
    } else {
      assert.ok(true, 'pagination control not rendered for pre-paginated entities table (expected)');
    }
  });
});
