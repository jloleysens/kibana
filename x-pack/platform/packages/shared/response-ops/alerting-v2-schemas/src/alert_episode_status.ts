/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const ALERT_EPISODE_STATUS = {
  INACTIVE: 'inactive',
  PENDING: 'pending',
  ACTIVE: 'active',
  RECOVERING: 'recovering',
} as const;

export type AlertEpisodeStatus = (typeof ALERT_EPISODE_STATUS)[keyof typeof ALERT_EPISODE_STATUS];
