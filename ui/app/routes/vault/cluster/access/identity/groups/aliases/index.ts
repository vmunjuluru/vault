/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { IdentityApiGroupListAliasesByIdListEnum } from '@hashicorp/vault-client-typescript';
import { accessIdentityGroupAliasesListViewConfig } from 'vault/utils/constants/list-view-config/access-identity-group-aliases';
import { attachAliasCapabilities } from 'vault/utils/identity-helpers';

import type ApiService from 'vault/services/api';
import type Controller from '@ember/controller';
import type CapabilitiesService from 'vault/services/capabilities';
import type { ListViewDisplayConfig } from 'core/types/list-view-config';

interface AliasKeyInfo {
  id: string;
  name: string;
  mount_type?: string;
  mount_accessor?: string;
  mount_path?: string;
  canonical_id?: string;
}

// RouteParams must extend Record<string, unknown> for the Ember Route base type.
// page/pageSize are optional — Ember omits query params that are not present in the URL.
interface RouteParams extends Record<string, unknown> {
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export type GroupAliasListItem = AliasKeyInfo & {
  canDelete: boolean;
  canEdit: boolean;
};

export interface IdentityGroupAliasesIndexModel {
  aliases: GroupAliasListItem[];
  listViewConfig: ListViewDisplayConfig;
  canCreateGroup: boolean;
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

export default class IdentityGroupAliasesIndexRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;

  queryParams = {
    page: { refreshModel: true },
    // refreshModel so page-scoped capability enrichment re-runs when sort changes
    sortBy: { refreshModel: true },
    sortOrder: { refreshModel: true },
  };

  async model(params: RouteParams): Promise<IdentityGroupAliasesIndexModel> {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 10;
    const sortBy = params.sortBy;
    const sortOrder = params.sortOrder;

    const listViewConfig = { ...accessIdentityGroupAliasesListViewConfig };
    listViewConfig.breadcrumbs = [
      { label: 'Vault', route: 'vault.cluster.dashboard', icon: 'vault' },
      { label: 'Groups' },
    ];
    // The aliases tab's header action creates a group, an update operation on identity/group.
    const { canUpdate: canCreateGroup } = await this.capabilities.for('identityGroup');

    try {
      const response = await this.api.identity.groupListAliasesById(
        IdentityApiGroupListAliasesByIdListEnum.TRUE
      );
      const items = this.api.keyInfoToArray<AliasKeyInfo>(response);

      // Sort then slice so only the P visible aliases get capability enrichment.
      // Full N-item array is still returned for Page::ListView pagination totals.
      const sorted = sortItems(
        items as unknown as Record<string, unknown>[],
        sortBy,
        sortOrder
      ) as unknown as AliasKeyInfo[];
      const start = (page - 1) * pageSize;
      const pageSlice = sorted.slice(start, start + pageSize);

      // attachAliasCapabilities returns new objects — merge back by id
      const enrichedSlice =
        pageSlice.length > 0
          ? ((await attachAliasCapabilities({
              aliases: pageSlice,
              identityType: 'group',
              capabilities: this.capabilities,
            })) as GroupAliasListItem[])
          : [];
      const enrichedById = new Map(enrichedSlice.map((alias) => [alias.id, alias]));

      const aliases = items.map((item) => {
        const enriched = enrichedById.get(item.id);
        if (enriched) {
          return enriched;
        }
        return {
          ...item,
          canDelete: false,
          canEdit: false,
        } as GroupAliasListItem;
      });

      return {
        aliases,
        listViewConfig,
        canCreateGroup,
        page,
        pageSize,
      };
    } catch (error) {
      const { status } = await this.api.parseError(error);
      if (status === 404) {
        return { aliases: [], listViewConfig, canCreateGroup, page: 1, pageSize };
      }
      throw error;
    }
  }

  resetController(
    controller: Controller & {
      page: number;
      pageSize: number;
      sortBy: string | undefined;
      sortOrder: string | undefined;
    },
    isExiting: boolean
  ) {
    if (isExiting) {
      controller.page = 1;
      controller.pageSize = 10;
      controller.sortBy = undefined;
      controller.sortOrder = undefined;
    }
  }
}
