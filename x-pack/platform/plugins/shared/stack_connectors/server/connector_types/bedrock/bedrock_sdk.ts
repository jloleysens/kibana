/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BedrockRuntimeClientConfig } from '@aws-sdk/client-bedrock-runtime';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';

/** Loads only the Bedrock runtime client and Node transport, not other AWS clients. */
export const createBedrockClient = ({
  agents,
  ...options
}: Pick<BedrockRuntimeClientConfig, 'region' | 'credentials'> & {
  readonly agents: ConstructorParameters<typeof NodeHttpHandler>[0];
}): BedrockRuntimeClient =>
  new BedrockRuntimeClient({ ...options, requestHandler: new NodeHttpHandler(agents) });
