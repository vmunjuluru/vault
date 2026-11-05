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
import sinon from 'sinon';

const ALIAS_ID_1 = 'aaaabbbb-1d5-5a70-0f3c-4ec61f7b1111';
const ALIAS_ID_2 = 'ccccdddd-1d5-9b5c-0f3c-4ec61f7b2222';

const STUB_ALIASES = [
  {
    id: ALIAS_ID_1,
    name: 'Sample_1256',
    mount_type: 'approle',
    mount_accessor: 'auth_approle_427f93376',
  },
  {
    id: ALIAS_ID_2,
    name: 'test_155',
    mount_type: 'userrole',
    mount_accessor: 'auth_userrole_427f93376',
  },
];

function aliasListResponse(aliases) {
  const key_info = {};
  const keys = [];
  for (const a of aliases) {
    key_info[a.id] = {
      name: a.name,
      mount_type: a.mount_type,
      mount_accessor: a.mount_accessor,
    };
    keys.push(a.id);
  }
  return { data: { key_info, keys }, request_id: 'test' };
}

module('Acceptance | Identity group aliases list view', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function () {
    await login();
    this.server.get('/identity/group-alias/id', () => aliasListResponse(STUB_ALIASES));
    // Empty capabilities data causes all permission checks to default to allowed.
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  // ── Page structure ──────────────────────────────────────────────────────

  test('it renders the page title', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('Groups');
  });

  test('it renders breadcrumbs', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    assert.dom(GENERAL.breadcrumbLink('Vault')).exists('first breadcrumb links to Vault dashboard');
    assert.dom(GENERAL.currentBreadcrumb('Groups')).exists('last breadcrumb is current page');
  });

  test('it renders the Create group primary action button', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    assert.dom(GENERAL.button('Create group')).exists();
  });

  // ── Tab navigation ───────────────────────────────────────────────────────

  test('it renders Groups and Aliases tabs', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    assert.dom('[data-test-tab="Groups"]').exists('Groups tab exists');
    assert.dom('[data-test-tab="Aliases"]').exists('Aliases tab exists');
  });

  // ── Table columns ────────────────────────────────────────────────────────

  test('it renders the Aliases name, Aliases ID, and Mount type column headers', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    assert.dom(GENERAL.tableColumnHeader(1, { isAdvanced: true })).includesText('Aliases name');
    assert.dom(GENERAL.tableColumnHeader(2, { isAdvanced: true })).includesText('Aliases ID');
    assert.dom(GENERAL.tableColumnHeader(3, { isAdvanced: true })).includesText('Mount type');
  });

  // ── Filter ───────────────────────────────────────────────────────────────

  test('it shows the filtered empty state when no aliases match the filter', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    await fillIn(GENERAL.filterInput, 'nonexistent-alias-xyz');
    assert.dom(GENERAL.emptyStateTitle).includesText('No results for');
  });

  test('it filters aliases by full or partial alias ID', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    await fillIn(GENERAL.filterInput, ALIAS_ID_2);
    assert.dom(GENERAL.tableRow()).exists({ count: 1 }, 'only the matching alias renders');
    assert.dom(`[data-test-identity-link="${ALIAS_ID_2}"]`).exists('alias matching the full ID renders');

    await fillIn(GENERAL.filterInput, ALIAS_ID_1.slice(0, 8));
    assert.dom(GENERAL.tableRow()).exists({ count: 1 }, 'only the matching alias renders');
    assert.dom(`[data-test-identity-link="${ALIAS_ID_1}"]`).exists('alias matching the partial ID renders');
  });

  test('it filters aliases by name', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    await fillIn(GENERAL.filterInput, 'sample');
    assert.dom(GENERAL.tableRow()).exists({ count: 1 }, 'only the matching alias renders');
    assert.dom(`[data-test-identity-link="${ALIAS_ID_1}"]`).exists();
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  test('it shows the empty state when there are no group aliases', async function (assert) {
    this.server.get('/identity/group-alias/id', () => ({
      data: { key_info: {}, keys: [] },
      request_id: 'test',
    }));
    await visit('/vault/access/identity/groups/aliases');
    assert.dom(GENERAL.emptyStateTitle).hasText('No group aliases yet');
  });

  // ── Row actions ──────────────────────────────────────────────────────────

  test('it renders popup menu actions for an alias', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    await click(GENERAL.menuItem(STUB_ALIASES[0].name));
    assert.dom(GENERAL.menuItem('view-details')).exists('View details action exists');
    assert.dom(GENERAL.menuItem('edit-details')).exists('Edit details action exists');
    assert.dom(GENERAL.menuItem('delete')).exists('Remove alias action exists');
  });

  // ── Remove modal ─────────────────────────────────────────────────────────

  test('it shows a confirmation modal when Remove alias is clicked', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    await click(GENERAL.menuItem(STUB_ALIASES[0].name));
    await click(GENERAL.menuItem('delete'));
    assert.dom(GENERAL.confirmTitle).hasText('Remove this alias');
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  test('it advances the page query param when the next-page button is clicked', async function (assert) {
    const manyAliases = Array.from({ length: 20 }, (_, i) => ({
      id: `alias-id-${i}`,
      name: `alias-${i}`,
      mount_type: 'approle',
      mount_accessor: `auth_approle_${i}`,
    }));
    this.server.get('/identity/group-alias/id', () => aliasListResponse(manyAliases));
    await visit('/vault/access/identity/groups/aliases');
    await click(GENERAL.nextPage);
    assert.true(currentURL().includes('page=2'), 'URL contains page=2 after clicking next');
  });

  test('it resets the page query param to 1 on navigation away', async function (assert) {
    await visit('/vault/access/identity/groups/aliases?page=3');
    await visit('/vault/dashboard');
    await visit('/vault/access/identity/groups/aliases');
    assert.false(currentURL().includes('page=3'), 'page param was reset after navigation');
  });

  // ── Sorting ──────────────────────────────────────────────────────────────

  test('sorting by name applies to the full dataset before pagination', async function (assert) {
    // 20 aliases named alias-00..alias-19; ascending sort should keep alias-00 on page 1.
    // Descending sort should move alias-19 to page 1 and push alias-00 off.
    const manyAliases = Array.from({ length: 20 }, (_, i) => ({
      id: `alias-id-${i}`,
      name: `alias-${String(i).padStart(2, '0')}`,
      mount_type: 'approle',
      mount_accessor: `auth_approle_${i}`,
    }));
    this.server.get('/identity/group-alias/id', () => aliasListResponse(manyAliases));

    await visit('/vault/access/identity/groups/aliases');

    // Click the Aliases name sort button (column 1) once → ascending
    await click(GENERAL.tableColumnHeaderSortButton(1, { isAdvanced: true }));
    await waitFor(GENERAL.listItem('alias-00'));

    assert.dom(GENERAL.listItem('alias-00')).exists('alias-00 is on page 1 after ascending sort');
    assert.dom(GENERAL.listItem('alias-19')).doesNotExist('alias-19 is not on page 1 after ascending sort');

    // Click again → descending; alias-19 should now appear on page 1
    await click(GENERAL.tableColumnHeaderSortButton(1, { isAdvanced: true }));
    await waitFor(GENERAL.listItem('alias-19'));

    assert.dom(GENERAL.listItem('alias-19')).exists('alias-19 is on page 1 after descending sort');
    assert.dom(GENERAL.listItem('alias-00')).doesNotExist('alias-00 is not on page 1 after descending sort');
  });

  test('sort query params persist when navigating to a different page', async function (assert) {
    // After sorting then changing page, sortBy and sortOrder must remain in the URL.
    const manyAliases = Array.from({ length: 20 }, (_, i) => ({
      id: `alias-id-${i}`,
      name: `alias-${String(i).padStart(2, '0')}`,
      mount_type: 'approle',
      mount_accessor: `auth_approle_${i}`,
    }));
    this.server.get('/identity/group-alias/id', () => aliasListResponse(manyAliases));

    await visit('/vault/access/identity/groups/aliases');
    await click(GENERAL.tableColumnHeaderSortButton(1, { isAdvanced: true }));
    await click(GENERAL.nextPage);

    const url = currentURL();
    assert.true(url.includes('sortBy=name'), 'sortBy=name persists after page change');
    assert.true(url.includes('sortOrder=asc'), 'sortOrder=asc persists after page change');
    assert.true(url.includes('page=2'), 'page=2 is set');
  });

  test('sort query params reset when navigating away from the page', async function (assert) {
    await visit('/vault/access/identity/groups/aliases?sortBy=name&sortOrder=asc');
    await visit('/vault/dashboard');
    await visit('/vault/access/identity/groups/aliases');

    const url = currentURL();
    assert.false(url.includes('sortBy='), 'sortBy param is cleared after navigation away');
    assert.false(url.includes('sortOrder='), 'sortOrder param is cleared after navigation away');
  });
});

// Read-only tokens must not see create or edit actions for group aliases.
module('Acceptance | Identity group aliases list view | read-only token', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    const groupId = await runCmd(
      'write -field=id identity/group name=read-only-external-group type=external'
    );
    const accessor = await runCmd('read -field=accessor sys/auth/token');
    this.aliasId = await runCmd(
      `write -field=id identity/group-alias name=read-only-alias mount_accessor=${accessor} canonical_id=${groupId}`
    );
    const token = await runCmd(
      tokenWithPolicyCmd('group-aliases-read-only', 'path "identity/*" { capabilities = ["read", "list"] }')
    );
    await login(token);
  });

  hooks.afterEach(async function () {
    await login();
    await runCmd(`delete identity/group-alias/id/${this.aliasId}`);
    await runCmd('delete identity/group/name/read-only-external-group');
  });

  test('it hides the create action on the aliases list view', async function (assert) {
    await visit('/vault/access/identity/groups/aliases');
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('Groups', 'list view renders');
    assert.dom(GENERAL.tab('Aliases')).exists('aliases tab renders');
    assert.dom(GENERAL.button('Create group')).doesNotExist('create action is hidden');
  });

  test('it hides the edit action on the alias details view', async function (assert) {
    await visit(`/vault/access/identity/groups/aliases/${this.aliasId}/details`);
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('read-only-alias', 'details view renders');
    assert.dom('[data-test-alias-edit-link]').doesNotExist('edit action is hidden');
  });
});

// Capability gating must not hide the alias details Edit action from a user who is allowed to use it.
module('Acceptance | Identity group alias details | root token', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await login();
    const groupId = await runCmd('write -field=id identity/group name=root-alias-group type=external');
    const accessor = await runCmd('read -field=accessor sys/auth/token');
    this.aliasId = await runCmd(
      `write -field=id identity/group-alias name=root-alias mount_accessor=${accessor} canonical_id=${groupId}`
    );
  });

  hooks.afterEach(async function () {
    await runCmd(`delete identity/group-alias/id/${this.aliasId}`);
    await runCmd('delete identity/group/name/root-alias-group');
  });

  test('it shows the edit action on the alias details view', async function (assert) {
    await visit(`/vault/access/identity/groups/aliases/${this.aliasId}/details`);
    assert.dom(GENERAL.hdsPageHeaderTitle).hasText('root-alias', 'details view renders');
    assert.dom('[data-test-alias-edit-link]').exists('edit action is shown');
  });
});

// Page-scoped enrichment for group aliases (WO-019)
module('Acceptance | /access/identity/groups/aliases | page-scoped enrichment', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  const PAGE_SIZE = 10;
  const ALIAS_COUNT = 30;

  hooks.beforeEach(async function () {
    await login();

    this.aliases = Array.from({ length: ALIAS_COUNT }, (_, i) => ({
      id: `grp-alias-id-${String(i).padStart(2, '0')}`,
      name: `grp-alias-${String(i).padStart(2, '0')}`,
      mount_type: 'approle',
      mount_accessor: `auth_approle_${i}`,
      mount_path: 'auth/approle/',
      canonical_id: `group-id-${String(i).padStart(2, '0')}`,
    }));

    this.server.get('/identity/group-alias/id', () => aliasListResponse(this.aliases));
    // Missing path keys → capabilities service defaults to allowed (root-like)
    this.server.post('/sys/capabilities-self', () => ({ data: {}, request_id: 'test' }));
  });

  hooks.afterEach(function () {
    this.fetchSpy?.restore();
  });

  function aliasIdsFromPaths(paths) {
    return [
      ...new Set(
        (paths || [])
          .filter((p) => typeof p === 'string')
          .map((p) => {
            const m = p.match(/identity\/group\/id\/(grp-alias-id-\d+)/);
            return m ? m[1] : null;
          })
          .filter(Boolean)
      ),
    ];
  }

  test('it enriches only page-1 aliases and paginates the full N-item dataset', async function (assert) {
    const capabilities = this.owner.lookup('service:capabilities');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    await visit('/vault/access/identity/groups/aliases');
    await settled();

    assert.ok(this.fetchSpy.called, 'capabilities.fetch called on page 1');
    const page1Ids = aliasIdsFromPaths(this.fetchSpy.lastCall.args[0]);
    assert.strictEqual(page1Ids.length, PAGE_SIZE, `page 1 enriches exactly ${PAGE_SIZE} aliases`);
    assert.ok(page1Ids.includes('grp-alias-id-00'), 'page 1 includes first alias');
    assert.ok(page1Ids.includes('grp-alias-id-09'), 'page 1 includes last page-1 alias');
    assert.notOk(page1Ids.includes('grp-alias-id-10'), 'page 1 excludes page-2 alias ids');

    assert.dom(GENERAL.tableRow()).exists({ count: PAGE_SIZE }, 'page 1 renders P rows');
    assert.dom(GENERAL.paginationInfo).includesText(String(ALIAS_COUNT), 'pagination total is full N');

    // Enriched page-1 rows show capability-gated edit/delete (fail-open / root-like caps)
    await click(`[data-test-popup-menu="${this.aliases[0].name}"]`);
    assert.dom(GENERAL.menuItem('edit-details')).exists('edit visible for enriched page-1 alias');
    assert.dom(GENERAL.menuItem('delete')).exists('delete visible for enriched page-1 alias');
  });

  test('it enriches only page-2 alias IDs after navigation', async function (assert) {
    const capabilities = this.owner.lookup('service:capabilities');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    await visit('/vault/access/identity/groups/aliases');
    await settled();

    const page1Ids = new Set(aliasIdsFromPaths(this.fetchSpy.lastCall.args[0]));
    this.fetchSpy.resetHistory();

    await click(GENERAL.nextPage);
    await settled();

    assert.true(currentURL().includes('page=2'), 'URL contains page=2');
    assert.ok(this.fetchSpy.called, 'capabilities.fetch called on page 2');

    const page2Ids = aliasIdsFromPaths(this.fetchSpy.lastCall.args[0]);
    assert.strictEqual(page2Ids.length, PAGE_SIZE, `page 2 enriches exactly ${PAGE_SIZE} aliases`);
    assert.ok(page2Ids.includes('grp-alias-id-10'), 'page 2 includes first remaining alias');
    assert.notOk(
      page2Ids.some((id) => page1Ids.has(id)),
      'page 2 enrichment IDs do not overlap page 1'
    );
  });

  test('it skips per-alias enrichment when the alias list is empty', async function (assert) {
    this.server.get('/identity/group-alias/id', () => ({
      data: { key_info: {}, keys: [] },
      request_id: 'test',
    }));

    const capabilities = this.owner.lookup('service:capabilities');
    this.fetchSpy = sinon.spy(capabilities, 'fetch');

    await visit('/vault/access/identity/groups/aliases');
    await settled();

    const aliasPaths = (this.fetchSpy.getCalls() || []).flatMap((c) =>
      aliasIdsFromPaths(c.args[0] || [])
    );
    assert.strictEqual(aliasPaths.length, 0, 'no per-alias capability paths when list is empty');
    assert.dom(GENERAL.emptyStateTitle).exists('empty state renders');
  });
});
