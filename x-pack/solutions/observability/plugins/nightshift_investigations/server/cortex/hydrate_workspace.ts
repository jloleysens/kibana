/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import type { CortexTelemetry } from '../telemetry/cortex_telemetry';
import { createCortexPageStore } from './page_store';
import { materializeCortex } from './materialize';

/** gRPC status the sandbox session rethrows when its pod refuses or drops the connection. */
const GRPC_UNAVAILABLE = 14;

const isSandboxUnavailable = (err: unknown): err is Error & { code: number } =>
  err instanceof Error && (err as Error & { code?: number }).code === GRPC_UNAVAILABLE;

export const hydrateCortexWorkspaceWithTelemetry = async ({
  session,
  esClient,
  spaceId,
  signal,
  telemetry,
  logger,
}: {
  session: Pick<SandboxSession, 'mkdirs' | 'writeFiles'>;
  esClient: ElasticsearchClient;
  spaceId: string;
  signal?: AbortSignal;
  telemetry: Pick<CortexTelemetry, 'reportHydrated'>;
  logger: Pick<Logger, 'info' | 'warn' | 'debug'>;
}): Promise<void> => {
  const store = createCortexPageStore({ esClient, logger, spaceId, signal });
  const materialize = () => materializeCortex({ session, store, telemetry, logger });

  try {
    await materialize();
  } catch (err) {
    if (!isSandboxUnavailable(err) || signal?.aborted) throw err;

    // Hydrate is usually the conversation's first sandbox call, so it is the one that reaches a
    // freshly allocated pod before that pod accepts connections. The sandbox drops the session on
    // UNAVAILABLE and allocates a new pod for the next call, so a single retry lands on a pod
    // that is ready. Without it the run continues with no wiki, because nothing else seeds it.
    logger.warn(`Cortex hydrate reached an unavailable sandbox, retrying once: ${err.message}`);
    await materialize();
  }
};
