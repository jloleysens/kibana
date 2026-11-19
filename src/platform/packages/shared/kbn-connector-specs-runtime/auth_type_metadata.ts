/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export const AUTH_TYPE_METADATA = {
  api_key_header: {
    id: 'api_key_header',
  },
  api_key_header_with_tls: {
    id: 'api_key_header_with_tls',
  },
  api_key_query: {
    id: 'api_key_query',
  },
  azure_shared_key: {
    id: 'azure_shared_key',
  },
  aws_credentials: {
    id: 'aws_credentials',
  },
  bearer: {
    id: 'bearer',
  },
  bearer_with_tls: {
    id: 'bearer_with_tls',
  },
  basic: {
    id: 'basic',
  },
  basic_with_tls: {
    id: 'basic_with_tls',
  },
  gcp_service_account: {
    id: 'gcp_service_account',
  },
  none: {
    id: 'none',
  },
  oauth_client_credentials: {
    id: 'oauth_client_credentials',
  },
  oauth_password: {
    id: 'oauth_password',
  },
  oauth_authorization_code: {
    id: 'oauth_authorization_code',
    authMode: 'per-user',
  },
  oauth_client_credentials_private_key_jwt: {
    id: 'oauth_client_credentials_private_key_jwt',
  },
  ears: {
    id: 'ears',
    authMode: 'per-user',
  },
  relay: {
    id: 'relay',
    authMode: 'shared',
    usesRelayTransport: true,
    isKibanaManaged: true,
  },
  kubernetes_gke: {
    id: 'kubernetes_gke',
  },
  kubernetes_eks: {
    id: 'kubernetes_eks',
  },
  kubernetes_aks: {
    id: 'kubernetes_aks',
  },
} as const;
