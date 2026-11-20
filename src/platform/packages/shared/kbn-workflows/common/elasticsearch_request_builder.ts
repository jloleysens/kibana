/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { buildElasticsearchRequestFromDefinition } from '@kbn/workflows-runtime';
import { getElasticsearchConnectors } from '../spec/elasticsearch';
import type { RequestOptions } from '../types/latest';

/** Builds a request using the authoring catalog; runtimes can supply only the dispatched operation. */
export function buildElasticsearchRequest(
  stepType: string,
  params: Record<string, unknown>
): RequestOptions {
  const definition =
    stepType === 'elasticsearch.request'
      ? undefined
      : getElasticsearchConnectors().find(({ type }) => type === stepType);
  return buildElasticsearchRequestFromDefinition(stepType, params, definition);
}
