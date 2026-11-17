/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { getConnectorSpec } from '@kbn/connector-specs';
import { getElasticsearchConnectors } from '@kbn/workflows';
import type { ContextDependencies } from '../workflow_context_manager/types';

/** Authoring catalogs remain on the coordinator; the engine consumes only runtime metadata. */
export const coordinatorRuntimeMetadata: ContextDependencies['runtimeMetadata'] = {
  elasticsearchDefinition: (type) => {
    const definition = getElasticsearchConnectors().find((item) => item.type === type);
    if (!definition?.methods || !definition.patterns) return;
    const { methods, patterns, parameterTypes } = definition;
    return {
      methods,
      patterns,
      ...(parameterTypes
        ? {
            parameterTypes: {
              urlParams: parameterTypes.urlParams,
              bodyParams: parameterTypes.bodyParams,
            },
          }
        : {}),
    };
  },
  isSpecConnector: (type) => getConnectorSpec(`.${type}`) !== undefined,
};
