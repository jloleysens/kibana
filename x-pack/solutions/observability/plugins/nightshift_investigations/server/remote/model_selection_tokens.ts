/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';

export interface ModelSelectionInput {
  step: 'investigation';
  connector_id?: string;
  round_connector_id?: string;
}
export interface ModelSelectionApi {
  resolve(scopeId: string, input: ModelSelectionInput): Promise<string>;
}
export const ModelSelectionToken = createToken<ModelSelectionApi>('nightshift.modelSelection');
