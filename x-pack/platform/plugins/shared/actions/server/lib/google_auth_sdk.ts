/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Agent } from 'https';
import { GoogleAuth } from 'google-auth-library';

/** Loads Google's service-account authentication capability only on a token cache miss. */
export const getGoogleAccessToken = async (
  credentials: object,
  agent?: Agent
): Promise<string | null | undefined> => {
  const auth = new GoogleAuth({
    credentials,
    ...(agent ? { clientOptions: { transporterOptions: { agent } } } : {}),
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  return auth.getAccessToken();
};
