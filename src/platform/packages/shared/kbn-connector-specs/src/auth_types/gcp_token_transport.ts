/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { AxiosInstance } from 'axios';
import type { AuthContext } from '../connector_spec';
import { GCP_TOKEN_URL, type GcpTokenTransport } from './gcp_jwt_helpers';

/** Uses the connector's real HTTP policy for GCP token exchanges, without forwarding API authorization. */
export const createGcpTokenTransport =
  (client: AxiosInstance, context?: Pick<AuthContext, 'ensureUriAllowed'>): GcpTokenTransport =>
  async (body) => {
    context?.ensureUriAllowed?.(GCP_TOKEN_URL);
    const response = await client.request<string>({
      url: GCP_TOKEN_URL,
      method: 'POST',
      data: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: undefined },
      responseType: 'text',
      validateStatus: () => true,
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.data,
      json: async () => JSON.parse(response.data),
    };
  };
