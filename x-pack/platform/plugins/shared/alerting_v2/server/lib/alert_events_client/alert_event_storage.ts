/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import Boom from '@hapi/boom';
import { inject, injectable } from 'inversify';
import { ALERT_EVENTS_DATA_STREAM } from '@kbn/alerting-v2-constants';
import {
  ALERT_EVENTS_RESOURCE_KEY,
  type AlertEventDocument,
} from '../../resources/datastreams/alert_events';
import {
  ResourceManager,
  type ResourceManagerContract,
} from '../services/resource_service/resource_manager';
import type { QueryServiceContract } from '../services/query_service/query_service';
import { QueryServiceInternalToken } from '../services/query_service/tokens';
import type { StorageServiceContract } from '../services/storage_service/storage_service';
import { StorageServiceInternalToken } from '../services/storage_service/tokens';
import { RequestSpaceIdToken } from '../services/spaces_service/tokens';
import type { AlertEpisodeRow, AlertEventOperations } from './alert_event_algorithms';

@injectable()
export class AlertEventStorage implements AlertEventOperations {
  constructor(
    @inject(StorageServiceInternalToken) private readonly storageService: StorageServiceContract,
    @inject(QueryServiceInternalToken) private readonly queryService: QueryServiceContract,
    @inject(RequestSpaceIdToken) public readonly spaceId: string,
    @inject(ResourceManager) private readonly resourceManager: ResourceManagerContract
  ) {}
  async readLatest(groupHash: string, abortSignal?: AbortSignal): Promise<AlertEpisodeRow[]> {
    return await this.queryService.executeQueryRows<AlertEpisodeRow>({
      query: `FROM ${ALERT_EVENTS_DATA_STREAM}
          | WHERE type == "alert" AND group_hash == "${groupHash}" AND alert.status IS NOT NULL
          | STATS last_episode_id = LAST(alert.id, @timestamp),
                  last_episode_status = LAST(alert.status, @timestamp)
            BY group_hash
          | KEEP last_episode_id, last_episode_status
          | LIMIT 1`,
      abortSignal,
    });
  }
  async persist(doc: AlertEventDocument): Promise<void> {
    // The doc may omit `@timestamp`, so the ingest pipeline must be in place before writing.
    await this.resourceManager.ensureResourceReady(ALERT_EVENTS_RESOURCE_KEY);

    // `refresh: 'wait_for'` ensures the written doc is visible to the next
    // resolveEpisodeId query when events for the same series arrive back-to-back.
    const { errors } = await this.storageService.bulkIndexDocs({
      index: ALERT_EVENTS_DATA_STREAM,
      docs: [doc],
      refresh: 'wait_for',
    });

    if (errors.length > 0) {
      const first = errors[0];
      throw Boom.badData(`Failed to persist alert event: ${first.message}`, {
        code: first.code,
        details: first.details,
      });
    }
  }
}
