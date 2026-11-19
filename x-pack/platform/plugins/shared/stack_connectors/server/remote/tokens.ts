/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { ElasticsearchClient } from '@kbn/core/server';

/** The existing Workflows data-plane token; only its caller-scoped client is consumed here. */
export interface ConnectorDataPlane {
  user(scopeId: string): ElasticsearchClient;
}
export const WorkflowDataPlaneToken = createToken<ConnectorDataPlane>('workflows.dataPlane');
