/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { IdentityApiGroupListByIdListEnum } from '@hashicorp/vault-client-typescript';
import { accessIdentityGroupsListViewConfig } from 'vault/utils/constants/list-view-config/access-identity-groups';

import type ApiService from 'vault/services/api';
import type Controller from '@ember/controller';
import type CapabilitiesService from 'vault/services/capabilities';
import type { Group } from 'vault/vault/identity';

// keyInfoToArray needs a concrete type to avoid index-signature errors on .id access.
interface GroupKeyInfo {
  id: string;
  name: string;
}

interface RouteParams extends Record<string, unknown> {
  page: string;
  pageSize: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

type CapabilitiesEntry = { canDelete?: boolean; canUpdate?: boolean; canCreate?: boolean };

export type GroupListItem = Pick<Group, 'id' | 'name'> &
  Partial<Pick<Group, 'type' | 'alias'>> & {
    canDelete?: boolean;
    canEdit?: boolean;
    canAddAlias?: boolean;
  };

export interface IdentityGroupsIndexModel {
  groups: GroupListItem[];
  listViewConfig: typeof accessIdentityGroupsListViewConfig;
  canCreateGroup: boolean;
  page: number;
  pageSize: number;
}

interface RouteController extends Controller {
  page: number;
  pageSize: number;
}

/**
 * Replicates Page::ListView sortedModel (ui/lib/core/addon/components/page/list-view.ts):
 * localeCompare with {numeric: true, sensitivity: 'base'}, nulls last.
 */
function sortItems<T extends Record<string, unknown>>(
  items: T[],
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' | undefined
): T[] {
  if (!sortBy) return items;

  const direction = sortOrder ?? 'asc';
  return [...items].sort((a, b) => {
    const valA = a[sortBy];
    const valB = b[sortBy];

    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    let result: number;
    if (typeof valA === 'string' && typeof valB === 'string') {
      result = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
    } else {
      result = valA < valB ? -1 : valA > valB ? 1 : 0;
    }

    return direction === 'asc' ? result : -result;
  });
}

function buildListViewConfig() {
  const listViewConfig = { ...accessIdentityGroupsListViewConfig };
  listViewConfig.breadcrumbs = [
    { label: 'Vault', route: 'vault.cluster.dashboard', icon: 'vault' },
    { label: 'Groups' },
  ];
  return listViewConfig;
}

async function fetchGroupDetails(
  api: ApiService,
  items: GroupKeyInfo[]
): Promise<Record<string, Partial<Pick<Group, 'type' | 'alias'>>>> {
  const detailsMap: Record<string, Partial<Pick<Group, 'type' | 'alias'>>> = {};
  const detailsResponses = await Promise.all(
    items.map(async (item) => {
      try {
        return await api.identity.groupReadById(item.id);
      } catch {
        // Graceful: render item without detail data rather than failing the page
        return null;
      }
    })
  );
  detailsResponses.forEach((res) => {
    const d = (res as unknown as { data: Group } | null)?.data;
    if (d?.id) {
      detailsMap[d.id] = { type: d.type, alias: d.alias };
    }
  });
  return detailsMap;
}

export default class IdentityGroupsIndexRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;

  queryParams = {
    page: { refreshModel: true },
    // refreshModel true so enrichment can branch on sortBy (name/id vs type/alias)
    sortBy: { refreshModel: true },
    sortOrder: { refreshModel: true },
  };

  async model(params: RouteParams) {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 10;
    const sortBy = params.sortBy;
    const sortOrder = params.sortOrder;
    // Creating a group is an update operation on identity/group (no existence check).
    const { canUpdate: canCreateGroup } = await this.capabilities.for('identityGroup');

    try {
      const response = await this.api.identity.groupListById(IdentityApiGroupListByIdListEnum.TRUE);
      const items = this.api.keyInfoToArray<GroupKeyInfo>(response);

      // name/id (and default unsorted) can page-scope both details + capabilities.
      // type/alias need full-detail groupReadById for correct global sort; capabilities stay page-scoped.
      const usePageScopedDetails = !sortBy || sortBy === 'name' || sortBy === 'id';

      let detailsMap: Record<string, Partial<Pick<Group, 'type' | 'alias'>>> = {};
      let capabilityTargetIds: string[];

      if (usePageScopedDetails) {
        const sorted = sortItems(
          items as unknown as Record<string, unknown>[],
          sortBy,
          sortOrder
        ) as unknown as GroupKeyInfo[];
        const start = (page - 1) * pageSize;
        const pageSlice = sorted.slice(start, start + pageSize);
        capabilityTargetIds = pageSlice.map((item) => item.id);
        detailsMap = await fetchGroupDetails(this.api, pageSlice);
      } else {
        // Full-detail fallback (WO-014): enrich ALL N items with type/alias for correct global sort.
        detailsMap = await fetchGroupDetails(this.api, items);

        const itemsWithDetails = items.map((item) => ({
          ...item,
          ...(detailsMap[item.id] || {}),
        }));
        const sorted = sortItems(
          itemsWithDetails as unknown as Record<string, unknown>[],
          sortBy,
          sortOrder
        ) as unknown as GroupKeyInfo[];
        const start = (page - 1) * pageSize;
        const pageSlice = sorted.slice(start, start + pageSize);
        capabilityTargetIds = pageSlice.map((item) => item.id);
      }

      const groupAliasPath = this.capabilities.pathFor('groupAlias');
      let capabilitiesMap: Record<string, CapabilitiesEntry> = {};

      if (capabilityTargetIds.length > 0) {
        const capabilityPaths = [
          groupAliasPath,
          ...capabilityTargetIds.map((id) =>
            this.capabilities.pathFor('identityCapabilities', { identityType: 'group', id })
          ),
        ];
        capabilitiesMap = (await this.capabilities.fetch(capabilityPaths)) as Record<
          string,
          CapabilitiesEntry
        >;
      }

      const groupAliasCapabilities = capabilitiesMap[groupAliasPath];
      const capabilityIdSet = new Set(capabilityTargetIds);
      // In the full-detail path every item has type/alias; in page-scoped only the page slice does.
      const detailIdSet = new Set(Object.keys(detailsMap));

      // Return the full N-item array so Page::ListView can paginate/sort; only P items get capabilities.
      const groups = items.map((item) => {
        const hasDetails = detailIdSet.has(item.id);
        const hasCapabilities = capabilityIdSet.has(item.id);

        const base: GroupListItem = {
          ...item,
          ...(hasDetails ? detailsMap[item.id] || {} : {}),
        };

        if (!hasCapabilities) {
          return {
            ...base,
            canDelete: false,
            canEdit: false,
            canAddAlias: false,
          };
        }

        const capPath = this.capabilities.pathFor('identityCapabilities', {
          identityType: 'group',
          id: item.id,
        });
        const itemCapabilities = capabilitiesMap[capPath];

        return {
          ...base,
          canDelete: itemCapabilities?.canDelete || false,
          canEdit: itemCapabilities?.canUpdate || false,
          canAddAlias: groupAliasCapabilities?.canCreate || false,
        };
      });

      return {
        groups,
        listViewConfig: buildListViewConfig(),
        canCreateGroup,
        page,
        pageSize,
      };
    } catch (error) {
      const { status } = await this.api.parseError(error);
      if (status === 404) {
        return {
          groups: [],
          listViewConfig: buildListViewConfig(),
          canCreateGroup,
          page: 1,
          pageSize,
        };
      }
      throw error;
    }
  }

  resetController(
    controller: RouteController & { sortBy: string | undefined; sortOrder: string | undefined },
    isExiting: boolean
  ) {
    if (isExiting) {
      controller.page = 1;
      controller.pageSize = 10;
      controller.sortBy = undefined;
      controller.sortOrder = undefined;
    }
  }

  @action
  reload() {
    this.refresh();
  }
}
