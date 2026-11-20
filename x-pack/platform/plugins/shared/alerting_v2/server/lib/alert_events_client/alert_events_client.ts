/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject, injectable } from 'inversify';
import type { CreateAlertEventData, CreateAlertEventResponse } from '@kbn/alerting-v2-schemas';
import {
  ResourceManager,
  type ResourceManagerContract,
} from '../services/resource_service/resource_manager';
import type { QueryServiceContract } from '../services/query_service/query_service';
import { QueryServiceInternalToken } from '../services/query_service/tokens';
import type { StorageServiceContract } from '../services/storage_service/storage_service';
import { StorageServiceInternalToken } from '../services/storage_service/tokens';
import { RequestSpaceIdToken } from '../services/spaces_service/tokens';
import { createAlertEvent } from './alert_event_algorithms';
import { AlertEventStorage } from './alert_event_storage';
export { getGroupHash, getValueByDottedPath } from './alert_event_algorithms';

@injectable()
export class AlertEventsClient {
  private readonly operations: AlertEventStorage;
  constructor(
    @inject(StorageServiceInternalToken) storageService: StorageServiceContract,
    @inject(QueryServiceInternalToken) queryService: QueryServiceContract,
    @inject(RequestSpaceIdToken) private readonly spaceId: string,
    @inject(ResourceManager) resourceManager: ResourceManagerContract
  ) {
    this.operations = new AlertEventStorage(storageService, queryService, spaceId, resourceManager);
  }
  public async createAlertEvent(
    event: CreateAlertEventData,
    options: { abortSignal?: AbortSignal } = {}
  ): Promise<CreateAlertEventResponse> {
    return createAlertEvent(event, this.spaceId, this.operations, options);
  }
}
