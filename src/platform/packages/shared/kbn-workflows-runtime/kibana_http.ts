/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export const KibanaHttpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const IGNORED_KIBANA_FETCHER_SETTING_MESSAGE =
  'The "fetcher" setting is deprecated and some options are already ignored. Please remove this setting. Configure self HTTP routing, TLS, and redirects with `server.selfHttp`. Use `max-step-size` for response limits.';
