/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { SearchInferenceEndpointsPluginStart } from '@kbn/search-inference-endpoints/server';
import type { InferenceFeaturesApi } from './tokens';

/** Reads only the original feature configuration with the run's request and space. */
@remotable()
export class InferenceFeatures implements InferenceFeaturesApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getServices: () => Promise<SearchInferenceEndpointsPluginStart>
  ) {}

  async list(scopeId: string): ReturnType<InferenceFeaturesApi['list']> {
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    this.scopes.get<KibanaRequest>(scopeId);
    const services = await this.getServices();
    signal.throwIfAborted();
    return services.features.getAll();
  }

  async getForFeature(
    scopeId: string,
    featureId: string,
    options?: Parameters<InferenceFeaturesApi['getForFeature']>[2]
  ): ReturnType<InferenceFeaturesApi['getForFeature']> {
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    const request = this.scopes.get<KibanaRequest>(scopeId);
    const services = await this.getServices();
    signal.throwIfAborted();
    const result = await services.endpoints.getForFeature(featureId, request, options);
    signal.throwIfAborted();
    return result;
  }
}
