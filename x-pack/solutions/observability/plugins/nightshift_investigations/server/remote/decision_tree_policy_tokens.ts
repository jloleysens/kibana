/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';

export interface DecisionTreePolicySnapshot {
  enabled: boolean;
  telemetryConnectorId?: string;
}
export interface DecisionTreePolicyApi {
  read(scopeId: string): Promise<DecisionTreePolicySnapshot>;
}
export const DecisionTreePolicyToken = createToken<DecisionTreePolicyApi>(
  'nightshift.decisionTreePolicy'
);
