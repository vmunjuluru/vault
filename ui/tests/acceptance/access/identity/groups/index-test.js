/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import { click, fillIn, currentURL, visit, waitFor, settled } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import { setupMirage } from 'ember-cli-mirage/test-support';
import { login } from 'vault/tests/helpers/auth/auth-helpers';
import { GENERAL } from 'vault/tests/helpers/general-selectors';
import { runCmd, tokenWithPolicyCmd } from 'vault/tests/helpers/commands';
import { WIZARD_ID_MAP } from 'vault/utils/constants/wizard';
import sinon from 'sinon';

const GROUP_ID_1 = '66638b30-a05e-560b-18cc-f43af766ce73';
const GROUP_ID_2 = '78938b30-a85e-535b-14ac-f43af766ce73';

const STUB_GROUPS = [
  { id: GROUP_ID_1, name: 'Kochi_design' },
  { id: GROUP_ID_2, name: 'Florida_design' },
];

function groupListResponse(groups) {
  const key_info = {};
  const keys = [];
  for (const g of groups) {
    key_info[g.id] = { name: g.name };
    keys.push(g.id);
  }
  return { data: { key_info, keys }, request_id: 'test' };
}

module('Acceptance | Identity groups list view', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function () {
    await login();
    this.server.get('/identity/group/id', () => groupListResponse(STUB_GROUPS));
    this.server.get('/identity/group/id/:id', (_, req) => {
      const group = STUB_GROUPS.find((g) => g.id === req.params.id) ?? STUB_GROUPS[0];
      return {
        data: { id: group.id, name: group.name, type: 'internal', alias: null, policies: [] },
        request_id: 'test',
      };
    });
    // Empty capabilities data causes all permission checks to default to allowed.
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  // ── Page structure ──────────────────────────────────────────────────────

  test('it renders the page title', async function (assert) {
    await visit('/vault/access/identity/groups');
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('Groups');
  });

  test('it renders breadcrumbs', async function (assert) {
    await visit('/vault/access/identity/groups');
    assert.dom(GENERAL.breadcrumbLink('Vault')).exists('first breadcrumb links to Vault dashboard');
    assert.dom(GENERAL.currentBreadcrumb('Groups')).exists('last breadcrumb is current page');
  });

  test('it renders the Create group primary action button', async function (assert) {
    await visit('/vault/access/identity/groups');
    assert.dom(GENERAL.button('Create group')).exists();
  });

  test('it disables the group type field when editing a group', async function (assert) {
    await visit(`/vault/access/identity/groups/edit/${GROUP_ID_1}`);

    assert.dom(GENERAL.inputByAttr('type')).isDisabled('group type cannot be changed after creation');
    assert.dom(GENERAL.inputByAttr('type')).hasValue('internal', 'existing group type is displayed');
  });

  // ── Table columns ────────────────────────────────────────────────────────

  test('it renders the Group name and Group ID column headers', async function (assert) {
    await visit('/vault/access/identity/groups');
    assert.dom(GENERAL.tableColumnHeader(1, { isAdvanced: true })).includesText('Group name');
    assert.dom(GENERAL.tableColumnHeader(2, { isAdvanced: true })).includesText('Group ID');
  });

  // ── Filter ───────────────────────────────────────────────────────────────

  test('it shows the filtered empty state when no groups match the filter', async function (assert) {
    await visit('/vault/access/identity/groups');
    await fillIn(GENERAL.filterInput, 'nonexistent-group-xyz');
    assert.dom(GENERAL.emptyStateTitle).includesText('No results for');
  });

  test('it filters groups by full or partial group ID', async function (assert) {
    await visit('/vault/access/identity/groups');
    await fillIn(GENERAL.filterInput, GROUP_ID_2);
    assert.dom(GENERAL.tableRow()).exists({ count: 1 }, 'only the matching group renders');
    assert.dom('[data-test-identity-link="Florida_design"]').exists('group matching the full ID renders');

    await fillIn(GENERAL.filterInput, GROUP_ID_1.slice(0, 8));
    assert.dom(GENERAL.tableRow()).exists({ count: 1 }, 'only the matching group renders');
    assert.dom('[data-test-identity-link="Kochi_design"]').exists('group matching the partial ID renders');
  });

  test('it filters groups by name', async function (assert) {
    await visit('/vault/access/identity/groups');
    await fillIn(GENERAL.filterInput, 'kochi');
    assert.dom(GENERAL.tableRow()).exists({ count: 1 }, 'only the matching group renders');
    assert.dom('[data-test-identity-link="Kochi_design"]').exists();
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  test('it shows the empty state when there are no groups', async function (assert) {
    this.server.get('/identity/group/id', () => ({
      data: { key_info: {}, keys: [] },
      request_id: 'test',
    }));
    this.owner.lookup('service:wizard').dismiss(WIZARD_ID_MAP.identityGroups);

    await visit('/vault/access/identity/groups');
    assert.dom(GENERAL.emptyStateTitle).hasText('No groups yet');
  });

  // ── Row actions ──────────────────────────────────────────────────────────

  test('it renders popup menu actions for a group', async function (assert) {
    await visit('/vault/access/identity/groups');
    await click(GENERAL.menuTrigger);
    assert.dom(GENERAL.menuItem('view-details')).exists('View details action exists');
    assert.dom(GENERAL.menuItem('edit-details')).exists('Edit details action exists');
    assert.dom(GENERAL.menuItem('delete-group')).exists('Delete group action exists');
  });

  // ── Delete modal ─────────────────────────────────────────────────────────

  test('it shows a confirmation modal when Delete group is clicked', async function (assert) {
    await visit('/vault/access/identity/groups');
    await click(GENERAL.menuTrigger);
    await click(GENERAL.menuItem('delete-group'));
    assert.dom(GENERAL.confirmTitle).hasText('Delete this group?');
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  test('it advances the page query param when the next-page button is clicked', async function (assert) {
    const manyGroups = Array.from({ length: 20 }, (_, i) => ({
      id: `group-id-${i}`,
      name: `group-${i}`,
    }));
    this.server.get('/identity/group/id', () => groupListResponse(manyGroups));
    this.server.get('/identity/group/id/:id', (_, req) => ({
      data: {
        id: req.params.id,
        name: `group-${req.params.id}`,
        type: 'internal',
        alias: null,
        policies: [],
      },
      request_id: 'test',
    }));
    await visit('/vault/access/identity/groups');
    await click(GENERAL.nextPage);
    assert.true(currentURL().includes('page=2'), 'URL contains page=2 after clicking next');
  });

  test('it resets the page query param to 1 on navigation away', async function (assert) {
    await visit('/vault/access/identity/groups?page=3');
    await visit('/vault/dashboard');
    await visit('/vault/access/identity/groups');
    assert.false(currentURL().includes('page=3'), 'page param was reset after navigation');
  });

  test('different pages display different groups', async function (assert) {
    const manyGroups = Array.from({ length: 20 }, (_, i) => ({
      id: `group-id-${i}`,
      name: `group-${i}`,
    }));
    this.server.get('/identity/group/id', () => groupListResponse(manyGroups));
    this.server.get('/identity/group/id/:id', (_, req) => ({
      data: {
        id: req.params.id,
        name: `group-${req.params.id}`,
        type: 'internal',
        alias: null,
        policies: [],
      },
      request_id: 'test',
    }));

    await visit('/vault/access/identity/groups');

    assert.dom('[data-test-identity-link="group-0"]').exists('group-0 is visible on page 1');
    assert.dom('[data-test-identity-link="group-15"]').doesNotExist('group-15 is not visible on page 1');

    await click(GENERAL.nextPage);

    assert.dom('[data-test-identity-link="group-15"]').exists('group-15 is visible on page 2');
    assert.dom('[data-test-identity-link="group-0"]').doesNotExist('group-0 is not visible on page 2');
  });

  // ── Sorting ──────────────────────────────────────────────────────────────

  test('sorting by name applies to the full dataset before pagination', async function (assert) {
    // 20 groups named group-00..group-19; ascending sort should put group-00 on page 1.
    // Descending sort should push group-19 to page 1 and group-00 off it.
    const manyGroups = Array.from({ length: 20 }, (_, i) => ({
      id: `group-id-${i}`,
      name: `group-${String(i).padStart(2, '0')}`,
    }));
    this.server.get('/identity/group/id', () => groupListResponse(manyGroups));
    this.server.get('/identity/group/id/:id', (_, req) => ({
      data: {
        id: req.params.id,
        name: `group-${req.params.id}`,
        type: 'internal',
        alias: null,
        policies: [],
      },
      request_id: 'test',
    }));

    await visit('/vault/access/identity/groups');

    // Click the Group name sort button (column 1) once → ascending
    await click(GENERAL.tableColumnHeaderSortButton(1, { isAdvanced: true }));
    await waitFor('[data-test-identity-link]');

    assert.dom('[data-test-identity-link="group-00"]').exists('group-00 is on page 1 after ascending sort');
    assert
      .dom('[data-test-identity-link="group-19"]')
      .doesNotExist('group-19 is not on page 1 after ascending sort');

    // Click again → descending; group-19 should now be on page 1
    await click(GENERAL.tableColumnHeaderSortButton(1, { isAdvanced: true }));
    await waitFor('[data-test-identity-link]');

    assert.dom('[data-test-identity-link="group-19"]').exists('group-19 is on page 1 after descending sort');
    assert
      .dom('[data-test-identity-link="group-00"]')
      .doesNotExist('group-00 is not on page 1 after descending sort');
  });

  test('sort query params persist when navigating to a different page', async function (assert) {
    // After sorting then changing page, sortBy and sortOrder must remain in the URL.
    const manyGroups = Array.from({ length: 20 }, (_, i) => ({
      id: `group-id-${i}`,
      name: `group-${String(i).padStart(2, '0')}`,
    }));
    this.server.get('/identity/group/id', () => groupListResponse(manyGroups));
    this.server.get('/identity/group/id/:id', (_, req) => ({
      data: {
        id: req.params.id,
        name: `group-${req.params.id}`,
        type: 'internal',
        alias: null,
        policies: [],
      },
      request_id: 'test',
    }));

    await visit('/vault/access/identity/groups');
    await click(GENERAL.tableColumnHeaderSortButton(1, { isAdvanced: true }));
    await click(GENERAL.nextPage);

    const url = currentURL();
    assert.true(url.includes('sortBy=name'), 'sortBy=name persists after page change');
    assert.true(url.includes('sortOrder=asc'), 'sortOrder=asc persists after page change');
    assert.true(url.includes('page=2'), 'page=2 is set');
  });

  test('sort query params reset when navigating away from the page', async function (assert) {
    await visit('/vault/access/identity/groups?sortBy=name&sortOrder=asc');
    await visit('/vault/dashboard');
    await visit('/vault/access/identity/groups');

    const url = currentURL();
    assert.false(url.includes('sortBy='), 'sortBy param is cleared after navigation away');
    assert.false(url.includes('sortOrder='), 'sortOrder param is cleared after navigation away');
  });
});

// Read-only tokens must not see create or edit actions for groups.
module('Acceptance | Identity groups list view | read-only token', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    // External, so the details view would otherwise offer "Add alias".
    this.groupId = await runCmd('write -field=id identity/group name=read-only-group type=external');
    const token = await runCmd(
      tokenWithPolicyCmd('groups-read-only', 'path "identity/*" { capabilities = ["read", "list"] }')
    );
    await login(token);
  });

  hooks.afterEach(async function () {
    await login();
    await runCmd('delete identity/group/name/read-only-group');
  });

  test('it hides the create action on the list view', async function (assert) {
    await visit('/vault/access/identity/groups');
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('Groups', 'list view renders');
    assert.dom('[data-test-identity-link="read-only-group"]').exists('group is listed');
    assert.dom(GENERAL.button('Create group')).doesNotExist('create action is hidden');
  });

  test('it hides the edit and add alias actions on the group details view', async function (assert) {
    await visit(`/vault/access/identity/groups/${this.groupId}/details`);
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('read-only-group', 'details view renders');
    assert.dom('[data-test-entity-edit-link]').doesNotExist('edit action is hidden');
    assert.dom('[data-test-entity-create-link]').doesNotExist('add alias action is hidden');
  });
});

// Capability gating must not hide group details actions from a user who is allowed to use them.
module('Acceptance | Identity group details | root token', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    this.groupId = await runCmd('write -field=id identity/group name=root-external-group type=external');
  });

  hooks.afterEach(async function () {
    await runCmd('delete identity/group/name/root-external-group');
  });

  test('it shows the edit and add alias actions on the group details view', async function (assert) {
    await visit(`/vault/access/identity/groups/${this.groupId}/details`);
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('root-external-group', 'details view renders');
    assert.dom('[data-test-entity-edit-link]').exists('edit action is shown');
    assert.dom('[data-test-entity-create-link]').exists('add alias action is shown');
  });
});

// Page-scoped enrichment for default name sort (WO-015)
module('Acceptance | Identity groups | page-scoped enrichment', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  const GROUP_COUNT = 30;
  // Groups route defaults pageSize to 10 (see groups/index.ts)
  const PAGE_SIZE = 10;

  function buildGroups(count) {
    return Array.from({ length: count }, (_, i) => ({
      id: `group-id-${String(i).padStart(2, '0')}`,
      name: `group-${String(i).padStart(2, '0')}`,
    }));
  }

  hooks.beforeEach(async function () {
    await login();
    this.groups = buildGroups(GROUP_COUNT);
    this.groupReadIds = [];
    this.capabilityPathBatches = [];

    this.server.get('/identity/group/id', () => groupListResponse(this.groups));
    this.server.get('/identity/group/id/:id', (_, req) => {
      this.groupReadIds.push(req.params.id);
      const group = this.groups.find((g) => g.id === req.params.id) ?? this.groups[0];
      return {
        data: { id: group.id, name: group.name, type: 'internal', alias: null, policies: [] },
        request_id: 'test',
      };
    });
    this.server.post('/sys/capabilities-self', (_, request) => {
      const body = JSON.parse(request.requestBody || '{}');
      this.capabilityPathBatches.push(body.paths || []);
      const paths = body.paths || [];
      const data = {};
      paths.forEach((p) => {
        data[p] = ['root'];
      });
      return { data, request_id: 'test' };
    });
  });

  function latestGroupCapPaths(batches) {
    for (let i = batches.length - 1; i >= 0; i--) {
      const paths = batches[i] || [];
      if (paths.some((p) => /identity\/group\/id\//.test(p))) {
        return paths;
      }
    }
    return [];
  }

  test('default sort enriches only the current page of groups', async function (assert) {
    this.groupReadIds = [];
    this.capabilityPathBatches = [];

    await visit('/vault/access/identity/groups');

    assert.strictEqual(
      this.groupReadIds.length,
      PAGE_SIZE,
      `groupReadById called exactly ${PAGE_SIZE} times for page 1`
    );
    assert.ok(
      this.groupReadIds.every((id) => id.startsWith('group-id-0')),
      'page 1 groupReadById ids are from the first page slice'
    );

    const capPaths = latestGroupCapPaths(this.capabilityPathBatches);
    const groupCapPaths = capPaths.filter((p) => /identity\/group\/id\//.test(p));
    assert.strictEqual(
      groupCapPaths.length,
      PAGE_SIZE,
      `capabilities.fetch includes paths for exactly ${PAGE_SIZE} groups`
    );

    assert.dom(GENERAL.pagination).exists('pagination control is visible');
    assert.dom(GENERAL.paginationInfo).includesText(String(GROUP_COUNT), 'pagination total is N');
  });

  test('page 2 enrichment uses a different page slice', async function (assert) {
    await visit('/vault/access/identity/groups');

    this.groupReadIds = [];
    this.capabilityPathBatches = [];

    await click(GENERAL.nextPage);

    assert.true(currentURL().includes('page=2'), 'navigated to page 2');
    assert.strictEqual(
      this.groupReadIds.length,
      PAGE_SIZE,
      `groupReadById called ${PAGE_SIZE} times for page 2`
    );
    assert.ok(
      this.groupReadIds.includes('group-id-10'),
      'page 2 enrichment includes first id of page 2'
    );
    assert.notOk(
      this.groupReadIds.includes('group-id-00'),
      'page 2 enrichment excludes page 1 ids'
    );

    const capPaths = latestGroupCapPaths(this.capabilityPathBatches);
    const groupCapPaths = capPaths.filter((p) => /identity\/group\/id\//.test(p));
    assert.strictEqual(groupCapPaths.length, PAGE_SIZE, 'page 2 capabilities scoped to P groups');
  });
});

// Page-navigation enrichment isolation (WO-016)
module('Acceptance | /access/identity/groups | page navigation enrichment isolation', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  const PAGE_SIZE = 10;
  // 15 groups → page 2 has exactly 5 items under default pageSize
  const GROUP_COUNT = 15;

  hooks.beforeEach(async function () {
    await login();

    this.groups = Array.from({ length: GROUP_COUNT }, (_, i) => ({
      id: `nav-group-id-${String(i).padStart(2, '0')}`,
      name: `nav-group-${String(i).padStart(2, '0')}`,
    }));

    this.server.get('/identity/group/id', () => groupListResponse(this.groups));
    this.server.get('/identity/group/id/:id', (_, req) => {
      const group = this.groups.find((g) => g.id === req.params.id) ?? this.groups[0];
      return {
        data: { id: group.id, name: group.name, type: 'internal', alias: null, policies: [] },
        request_id: 'test',
      };
    });
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  hooks.afterEach(function () {
    this.readSpy?.restore();
    this.fetchSpy?.restore();
  });

  test('it enriches only page-2 group IDs after navigation', async function (assert) {
    const api = this.owner.lookup('service:api');
    const capabilities = this.owner.lookup('service:capabilities');
    this.readSpy = sinon.spy(api.identity, 'groupReadById');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    await visit('/vault/access/identity/groups');
    await settled();

    const page1Ids = new Set(this.readSpy.getCalls().map((c) => c.args[0]));
    assert.strictEqual(page1Ids.size, PAGE_SIZE, `page 1 reads exactly ${PAGE_SIZE} groups`);

    this.readSpy.resetHistory();
    this.fetchSpy.resetHistory();

    await click(GENERAL.nextPage);
    await settled();

    assert.true(currentURL().includes('page=2'), 'URL contains page=2');

    const page2Ids = this.readSpy.getCalls().map((c) => c.args[0]);
    const expectedPage2Count = GROUP_COUNT - PAGE_SIZE; // 5
    assert.strictEqual(
      page2Ids.length,
      expectedPage2Count,
      `groupReadById called exactly ${expectedPage2Count} times on page 2`
    );
    assert.ok(
      page2Ids.includes('nav-group-id-10'),
      'page 2 includes first remaining group id'
    );
    assert.notOk(
      page2Ids.some((id) => page1Ids.has(id)),
      'page 2 groupReadById ids do not overlap page 1'
    );

    assert.ok(this.fetchSpy.called, 'capabilities.fetch called on page 2');
    const paths = this.fetchSpy.lastCall.args[0] || [];
    const groupPaths = paths.filter((p) => typeof p === 'string' && p.includes('identity/group/id/'));
    const pathIds = groupPaths.map((p) => {
      const m = p.match(/identity\/group\/id\/([^/]+)/);
      return m ? m[1] : null;
    }).filter(Boolean);

    assert.strictEqual(pathIds.length, expectedPage2Count, 'capabilities paths scoped to page-2 count');
    assert.notOk(
      pathIds.some((id) => page1Ids.has(id)),
      'capabilities.fetch paths contain zero page-1 group IDs'
    );
  });
});

// Capability-gated controls with page-scoped enrichment (WO-017)
module('Acceptance | /access/identity/groups | capability-gated controls for unenriched items', function (
  hooks
) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  const PAGE_SIZE = 10;
  const GROUP_COUNT = 15;

  hooks.beforeEach(async function () {
    await login();
    this.groups = Array.from({ length: GROUP_COUNT }, (_, i) => ({
      id: `cap-group-id-${String(i).padStart(2, '0')}`,
      name: `cap-group-${String(i).padStart(2, '0')}`,
    }));
    this.server.get('/identity/group/id', () => groupListResponse(this.groups));
    this.server.get('/identity/group/id/:id', (_, req) => {
      const group = this.groups.find((g) => g.id === req.params.id) ?? this.groups[0];
      return {
        data: { id: group.id, name: group.name, type: 'internal', alias: null, policies: [] },
        request_id: 'test',
      };
    });
    // Missing path keys → capabilities service defaults to true (root-like)
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  test('it shows correct actions for enriched page-1 items with root token', async function (assert) {
    await visit('/vault/access/identity/groups');

    const page1 = this.groups.slice(0, PAGE_SIZE);
    assert.strictEqual(page1.length, PAGE_SIZE, `page 1 renders ${PAGE_SIZE} groups`);

    for (const group of page1) {
      await click(`[data-test-popup-menu-trigger="${group.name}"]`);
      assert.dom(GENERAL.menuItem('view-details')).exists(`${group.name}: View details available`);
      assert.dom(GENERAL.menuItem('edit-details')).exists(`${group.name}: Edit details for enriched item`);
      assert.dom(GENERAL.menuItem('delete-group')).exists(`${group.name}: Delete group for enriched item`);
      // Close dropdown before opening the next row's menu
      await click(`[data-test-popup-menu-trigger="${group.name}"]`);
    }
  });

  test('it shows correct actions for page-2 items after navigation', async function (assert) {
    await visit('/vault/access/identity/groups');
    await click(GENERAL.nextPage);
    assert.true(currentURL().includes('page=2'), 'navigated to page 2');

    const page2 = this.groups.slice(PAGE_SIZE);
    assert.strictEqual(page2.length, GROUP_COUNT - PAGE_SIZE, 'page 2 has remaining groups');

    for (const group of page2) {
      await click(`[data-test-popup-menu-trigger="${group.name}"]`);
      assert.dom(GENERAL.menuItem('edit-details')).exists(`${group.name}: Edit details on page 2`);
      assert.dom(GENERAL.menuItem('delete-group')).exists(`${group.name}: Delete group on page 2`);
      await click(`[data-test-popup-menu-trigger="${group.name}"]`);
    }
  });

  test('it hides edit and delete actions with restricted token', async function (assert) {
    // Explicit read/list only — missing keys would fail-open to true in capabilities service.
    // Mirrors tokenWithPolicyCmd('identity-read-only', 'path "identity/group/*" { capabilities = ["read", "list"] }').
    this.server.post('/sys/capabilities-self', (_, request) => {
      const { paths = [] } = JSON.parse(request.requestBody || '{}');
      const data = {};
      paths.forEach((p) => {
        if (p.includes('identity/group')) {
          data[p] = ['read', 'list'];
        } else {
          data[p] = ['root'];
        }
      });
      return { data, request_id: 'test' };
    });

    await visit('/vault/access/identity/groups');
    await click(`[data-test-popup-menu-trigger="${this.groups[0].name}"]`);
    assert.dom(GENERAL.menuItem('view-details')).exists('View details remains available');
    assert.dom(GENERAL.menuItem('edit-details')).doesNotExist('Edit hidden without update capability');
    assert.dom(GENERAL.menuItem('delete-group')).doesNotExist('Delete hidden without delete capability');
  });
});

// Restricted-token capability gating against a live Vault (WO-017 AC: tokenWithPolicyCmd)
module('Acceptance | /access/identity/groups | capability-gated controls | restricted policy token', function (
  hooks
) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    this.groupName = `cap-ro-group-${Date.now()}`;
    this.groupId = await runCmd(
      `write -field=id identity/group name=${this.groupName} type=internal`
    );
    const token = await runCmd(
      tokenWithPolicyCmd(
        'identity-group-read-only',
        'path "identity/group/*" { capabilities = ["read", "list"] }\npath "identity/group/id" { capabilities = ["list"] }\npath "identity/group/id/*" { capabilities = ["read", "list"] }'
      )
    );
    await login(token);
  });

  hooks.afterEach(async function () {
    await login();
    if (this.groupName) {
      await runCmd(`delete identity/group/name/${this.groupName}`);
    }
  });

  test('it hides edit and delete for groups when token lacks update/delete', async function (assert) {
    await visit('/vault/access/identity/groups');
    assert.dom(`[data-test-identity-link="${this.groupName}"]`).exists('restricted token can list group');

    const trigger = `[data-test-popup-menu-trigger="${this.groupName}"]`;
    // View details is always rendered, so the menu trigger should exist; edit/delete stay hidden.
    assert.dom(trigger).exists('menu trigger present because View details is always available');
    await click(trigger);
    assert.dom(GENERAL.menuItem('view-details')).exists('View details remains available');
    assert.dom(GENERAL.menuItem('edit-details')).doesNotExist('Edit hidden for read-only policy');
    assert.dom(GENERAL.menuItem('delete-group')).doesNotExist('Delete hidden for read-only policy');
  });
});

// Filtering must still operate on the full dataset; enrichment stays page-scoped (WO-018)
module('Acceptance | /access/identity/groups | filtering with page-scoped enrichment', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  const PAGE_SIZE = 10;
  const GAMMA_COUNT = 10;
  const DELTA_COUNT = 10;

  hooks.beforeEach(async function () {
    await login();

    // alpha-sorting: gamma-* before delta-* would put delta first; use aaa-/zzz- prefixes
    // so the matching set occupies the first page and enrichment IDs align with the filter.
    this.gamma = [];
    this.delta = [];
    for (let i = 1; i <= GAMMA_COUNT; i++) {
      this.gamma.push({
        id: `gamma-grp-id-${String(i).padStart(2, '0')}`,
        name: `aaa-gamma-${String(i).padStart(2, '0')}`,
      });
    }
    for (let i = 1; i <= DELTA_COUNT; i++) {
      this.delta.push({
        id: `delta-grp-id-${String(i).padStart(2, '0')}`,
        name: `zzz-delta-${String(i).padStart(2, '0')}`,
      });
    }
    this.groups = [...this.gamma, ...this.delta];

    this.server.get('/identity/group/id', () => groupListResponse(this.groups));
    this.server.get('/identity/group/id/:id', (_, req) => {
      const group = this.groups.find((g) => g.id === req.params.id) ?? this.groups[0];
      return {
        data: { id: group.id, name: group.name, type: 'internal', alias: null, policies: [] },
        request_id: 'test',
      };
    });
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  hooks.afterEach(function () {
    this.readSpy?.restore();
    this.fetchSpy?.restore();
  });

  test('it filters to gamma groups and enriches only the filtered visible page', async function (assert) {
    const api = this.owner.lookup('service:api');
    const capabilities = this.owner.lookup('service:capabilities');
    this.readSpy = sinon.spy(api.identity, 'groupReadById');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    const gammaIds = new Set(this.gamma.map((g) => g.id));
    const deltaIds = new Set(this.delta.map((g) => g.id));

    await visit('/vault/access/identity/groups');
    await settled();

    // Initial page-scoped enrichment (name-sorted first PAGE_SIZE = all aaa-gamma-*)
    const readIds = this.readSpy.getCalls().map((c) => c.args[0]);
    assert.strictEqual(
      readIds.length,
      PAGE_SIZE,
      `groupReadById called ${PAGE_SIZE} times on page 1, not all ${this.groups.length}`
    );
    assert.ok(
      readIds.every((id) => gammaIds.has(id)),
      'groupReadById only for gamma (aaa-gamma) group IDs on page 1'
    );
    assert.notOk(
      readIds.some((id) => deltaIds.has(id)),
      'groupReadById not called for delta group IDs'
    );

    assert.ok(this.fetchSpy.called, 'capabilities.fetch called');
    const paths = this.fetchSpy.lastCall.args[0] || [];
    const pathIds = paths
      .filter((p) => typeof p === 'string' && p.includes('identity/group/id/'))
      .map((p) => {
        const m = p.match(/identity\/group\/id\/([^/]+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean);

    assert.ok(
      pathIds.every((id) => gammaIds.has(id)),
      'capabilities paths contain only gamma group IDs'
    );
    assert.notOk(
      pathIds.some((id) => deltaIds.has(id)),
      'capabilities paths contain zero delta group IDs'
    );

    this.readSpy.resetHistory();

    await fillIn(GENERAL.filterInput, 'gamma');
    await settled();

    assert.dom(GENERAL.tableRow()).exists({ count: GAMMA_COUNT }, 'filter shows exactly gamma matches');
    for (const { name } of this.gamma) {
      assert.dom(`[data-test-identity-link="${name}"]`).exists(`${name} visible`);
    }
    for (const { name } of this.delta) {
      assert.dom(`[data-test-identity-link="${name}"]`).doesNotExist(`${name} hidden`);
    }

    assert.dom(GENERAL.paginationInfo).exists('pagination info present for filtered set');
    const nextBtn = document.querySelector(GENERAL.nextPage);
    if (nextBtn) {
      assert.true(
        nextBtn.hasAttribute('disabled') || nextBtn.getAttribute('aria-disabled') === 'true',
        'next page control disabled when filtered count equals page size'
      );
    } else {
      assert.ok(true, 'next page control absent when filtered count equals page size');
    }

    // Client-side filter does not re-hit the API; enrichment stays the page-1 gamma slice
    assert.strictEqual(this.readSpy.callCount, 0, 'filter does not re-fetch group details');

    // Clearing the filter restores the unfiltered first page
    await fillIn(GENERAL.filterInput, '');
    await settled();
    assert.dom(GENERAL.tableRow()).exists({ count: PAGE_SIZE }, 'cleared filter shows page-size rows');
    assert.dom(`[data-test-identity-link="${this.gamma[0].name}"]`).exists('gamma still visible after clear');
  });
});

// Full-detail fallback when sorting by type (WO-022)
module('Acceptance | /access/identity/groups | sort-by-type full-detail fallback', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  const PAGE_SIZE = 10;
  const EXTERNAL_COUNT = 15;
  const INTERNAL_COUNT = 14;

  hooks.beforeEach(async function () {
    await login();

    this.external = Array.from({ length: EXTERNAL_COUNT }, (_, i) => ({
      id: `ext-grp-id-${String(i).padStart(2, '0')}`,
      name: `ext-group-${String(i).padStart(2, '0')}`,
      type: 'external',
    }));
    this.internal = Array.from({ length: INTERNAL_COUNT }, (_, i) => ({
      id: `int-grp-id-${String(i).padStart(2, '0')}`,
      name: `int-group-${String(i).padStart(2, '0')}`,
      type: 'internal',
    }));
    // null type sorts last (ListView null-last behavior)
    this.nullType = {
      id: 'null-grp-id-00',
      name: 'zzz-null-type-group',
      type: null,
    };
    this.groups = [...this.external, ...this.internal, this.nullType];
    this.byId = Object.fromEntries(this.groups.map((g) => [g.id, g]));

    this.server.get('/identity/group/id', () => groupListResponse(this.groups));
    this.server.get('/identity/group/id/:id', (_, req) => {
      const group = this.byId[req.params.id] ?? this.groups[0];
      return {
        data: {
          id: group.id,
          name: group.name,
          type: group.type,
          alias: null,
          policies: [],
        },
        request_id: 'test',
      };
    });
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  hooks.afterEach(function () {
    this.readSpy?.restore();
    this.fetchSpy?.restore();
  });

  function groupIdsFromCapPaths(paths) {
    return [
      ...new Set(
        (paths || [])
          .filter((p) => typeof p === 'string' && p.includes('identity/group/id/'))
          .map((p) => {
            const m = p.match(/identity\/group\/id\/([^/]+)/);
            return m ? m[1] : null;
          })
          .filter(Boolean)
      ),
    ];
  }

  function visibleGroupNames() {
    return [...document.querySelectorAll('[data-test-identity-link]')].map((el) =>
      el.getAttribute('data-test-identity-link')
    );
  }

  test('it fetches all N details and scopes capabilities to P when sorting by type', async function (assert) {
    const api = this.owner.lookup('service:api');
    const capabilities = this.owner.lookup('service:capabilities');
    this.readSpy = sinon.spy(api.identity, 'groupReadById');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    await visit('/vault/access/identity/groups');
    await settled();

    // Initial default load is page-scoped (not under test here)
    this.readSpy.resetHistory();
    this.fetchSpy.resetHistory();

    // No type column in ListView config — drive sort via query params (refreshModel: true)
    await visit('/vault/access/identity/groups?sortBy=type&sortOrder=asc');
    await settled();

    assert.true(currentURL().includes('sortBy=type'), 'URL carries sortBy=type');
    assert.strictEqual(
      this.readSpy.callCount,
      this.groups.length,
      `groupReadById called N=${this.groups.length} times for full-detail type sort`
    );

    assert.ok(this.fetchSpy.called, 'capabilities.fetch called after type sort');
    const capIds = groupIdsFromCapPaths(this.fetchSpy.lastCall.args[0]);
    assert.strictEqual(capIds.length, PAGE_SIZE, `capabilities scoped to P=${PAGE_SIZE}, not N`);

    // Ascending type: external < internal < null → page 1 is all external
    const page1Names = visibleGroupNames();
    assert.strictEqual(page1Names.length, PAGE_SIZE, 'page 1 renders P rows');
    assert.ok(
      page1Names.every((n) => n.startsWith('ext-group-')),
      'page 1 rows are all external after ascending type sort'
    );
    assert.dom(`[data-test-identity-link="${this.nullType.name}"]`).doesNotExist('null-type not on page 1');

    // Page 2 continues global sort: remaining external then internal
    this.readSpy.resetHistory();
    this.fetchSpy.resetHistory();
    await click(GENERAL.nextPage);
    await settled();

    assert.true(currentURL().includes('page=2'), 'navigated to page 2');
    assert.strictEqual(
      this.readSpy.callCount,
      this.groups.length,
      'page 2 type-sort still fetches all N details'
    );
    const page2CapIds = groupIdsFromCapPaths(this.fetchSpy.lastCall.args[0]);
    assert.strictEqual(page2CapIds.length, PAGE_SIZE, 'page 2 capabilities still scoped to P');

    const page2Names = visibleGroupNames();
    const expectedPage2 = [
      ...this.external.slice(PAGE_SIZE).map((g) => g.name), // 5 remaining external
      ...this.internal.slice(0, 5).map((g) => g.name), // 5 internal
    ];
    assert.deepEqual(page2Names, expectedPage2, 'page 2 continues global type sort order');

    // Descending type reverses order — internal first (null still last among typed? null last always)
    this.readSpy.resetHistory();
    await visit('/vault/access/identity/groups?sortBy=type&sortOrder=desc');
    await settled();

    assert.strictEqual(this.readSpy.callCount, this.groups.length, 'desc type sort still fetches all N');
    const descNames = visibleGroupNames();
    assert.ok(
      descNames.every((n) => n.startsWith('int-group-')),
      'page 1 after descending type sort shows internal groups first'
    );
    assert.dom(`[data-test-identity-link="${this.nullType.name}"]`).doesNotExist('null-type still not on page 1 when desc');
  });
});
