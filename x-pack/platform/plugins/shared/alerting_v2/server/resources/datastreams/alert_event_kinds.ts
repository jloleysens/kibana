/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const ALERT_EVENT_STATUSES = ['breached', 'recovered', 'no_data'] as const;
export const ALERT_EVENT_TYPES = ['signal', 'alert'] as const;
export const ALERT_EPISODE_STATUSES = ['inactive', 'pending', 'active', 'recovering'] as const;

export const alertEventStatus = {
  breached: 'breached',
  recovered: 'recovered',
  no_data: 'no_data',
} as const satisfies Record<(typeof ALERT_EVENT_STATUSES)[number], string>;

export const alertEventType = {
  signal: 'signal',
  alert: 'alert',
} as const satisfies Record<(typeof ALERT_EVENT_TYPES)[number], string>;

export const alertEpisodeStatus = {
  inactive: 'inactive',
  pending: 'pending',
  active: 'active',
  recovering: 'recovering',
} as const satisfies Record<(typeof ALERT_EPISODE_STATUSES)[number], string>;
