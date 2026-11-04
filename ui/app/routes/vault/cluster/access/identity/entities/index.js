/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { paginate } from 'core/utils/paginate-list';
import { IdentityApiEntityListByIdListEnum } from '@hashicorp/vault-client-typescript';

export default class IdentityIndexRoute extends Route {
  @service api;
  @service capabilities;

  queryParams = {
    page: {
      refreshModel: true,
    },
    pageFilter: {
      refreshModel: true,
    },
  };

  async model(params) {
    const { pageFilter, page } = params;

    // Page-independent capability checks (not per-item)
    const [{ canUpdate: canCreateEntity }, { canUpdate: canMergeEntities }] = await Promise.all([
      this.capabilities.for('identityEntity'),
      this.capabilities.for('entityMerge'),
    ]);

    // Fetch entity list, treating a 404 as an empty list rather than an error
    let items = [];
    try {
      const response = await this.api.identity.entityListById(IdentityApiEntityListByIdListEnum.TRUE);
      items = this.api.keyInfoToArray(response);
    } catch (error) {
      const { status } = await this.api.parseError(error);
      if (status !== 404) {
        throw error;
      }
    }

    // Paginate before enrichment so capability fetches are scoped to the visible page
    const paginatedResult = paginate(items, { page, filter: pageFilter });

    // Build capability paths only for the current page slice (+ shared entity-alias create path)
    const capabilityPaths = [
      this.capabilities.pathFor('entityAlias'),
      ...paginatedResult.map((item) =>
        this.capabilities.pathFor('identityCapabilities', { identityType: 'entity', id: item.id })
      ),
      ...paginatedResult.flatMap(
        (item) =>
          item.aliases?.map((alias) => this.capabilities.pathFor('entityAliasById', { id: alias.id })) || []
      ),
    ];

    const capabilitiesMap = await this.capabilities.fetch(capabilityPaths);

    const entityAliasCapabilities = capabilitiesMap[this.capabilities.pathFor('entityAlias')];

    const entities = paginatedResult.map((item) => {
      const capPath = this.capabilities.pathFor('identityCapabilities', {
        identityType: 'entity',
        id: item.id,
      });
      const itemCapabilities = capabilitiesMap[capPath];

      return {
        ...item,
        canDelete: itemCapabilities?.canDelete || false,
        canEdit: itemCapabilities?.canUpdate || false,
        canAddAlias: entityAliasCapabilities?.canCreate || false,
        aliases: (item.aliases || []).map((alias) => {
          const aliasCapPath = this.capabilities.pathFor('entityAliasById', { id: alias.id });
          const aliasCapabilities = capabilitiesMap[aliasCapPath];

          return {
            ...alias,
            canDelete: aliasCapabilities?.canDelete || false,
          };
        }),
      };
    });

    // Preserve pagination meta from paginate() on the enriched page slice
    Object.defineProperty(entities, 'meta', {
      value: paginatedResult.meta,
      writable: false,
    });

    return {
      entities,
      canCreateEntity,
      canMergeEntities,
    };
  }

  setupController(controller, resolvedModel) {
    super.setupController(controller, resolvedModel);

    const { pageFilter } = this.paramsFor(this.routeName);

    controller.setProperties({
      filter: pageFilter || '',
      page: resolvedModel?.entities?.meta?.currentPage || 1,
      identityType: 'entity',
    });
  }

  resetController(controller, isExiting) {
    if (isExiting) {
      controller.set('pageFilter', null);
      controller.set('filter', null);
    }
  }

  @action
  reload() {
    this.refresh();
  }
}
