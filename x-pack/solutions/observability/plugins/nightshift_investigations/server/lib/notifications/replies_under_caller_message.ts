/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { NotificationDestination } from './notification_routing';
/**
 * Whether the destination replies under a message the caller named, such as the Slack message that
 * triggered an automation, rather than under a thread it starts itself. That thread belongs to the
 * run started for the message, and the run keeps a single message in it.
 */
export const repliesUnderCallerMessage = ({ params }: Pick<NotificationDestination, 'params'>) =>
  typeof params.thread_ts === 'string' && params.thread_ts.length > 0;
