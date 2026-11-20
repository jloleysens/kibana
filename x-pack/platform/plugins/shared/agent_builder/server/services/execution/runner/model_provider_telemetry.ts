/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectorTelemetryMetadata } from '@kbn/inference-common';
import type { CreateModelProviderOpts } from './model_provider_runtime';
import { MODEL_TELEMETRY_METADATA } from '../../../telemetry';
import { getCurrentTraceId } from '../../../tracing';
import { getCurrentSpaceId } from '../../../utils/spaces';
import { getUserFromRequest } from '../../utils';

/** Resolves the original request-derived model telemetry without exporting request authority. */
export const resolveModelTelemetryMetadata = async ({
  request,
  spaces,
  security,
  elasticsearch,
  telemetryMetadata,
}: Pick<
  CreateModelProviderOpts,
  'request' | 'spaces' | 'security' | 'elasticsearch' | 'telemetryMetadata'
>): Promise<ConnectorTelemetryMetadata> => {
  const traceId = getCurrentTraceId();
  const spaceId = spaces ? getCurrentSpaceId({ request, spaces }) : undefined;
  // Only forward an actual profile UID: toStableUserId() falls back to a
  // `realm:[type,name,username]` synthetic id (used internally for ownership checks) when
  // the user has no activated profile, and that string embeds the raw username.
  const resolvedUserId =
    security && elasticsearch
      ? (
          await getUserFromRequest({
            request,
            security,
            esClient: elasticsearch.client.asScoped(request).asCurrentUser,
          })
        ).id
      : undefined;
  const userId =
    resolvedUserId && !resolvedUserId.startsWith('realm:') ? resolvedUserId : undefined;

  return {
    ...MODEL_TELEMETRY_METADATA,
    ...(traceId ? { traceId } : {}),
    ...(spaceId ? { spaceId } : {}),
    ...(userId ? { userId } : {}),
    ...telemetryMetadata,
  };
};
