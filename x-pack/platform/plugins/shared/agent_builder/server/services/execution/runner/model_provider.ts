/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ModelProvider } from '@kbn/agent-builder-server/runner';
import { createModelProviderRuntime } from './model_provider_runtime';
import type {
  CreateModelProviderOpts,
  CreateModelProviderFactoryFn,
} from './model_provider_runtime';
import { resolveModelTelemetryMetadata } from './model_provider_telemetry';
export type {
  CreateModelProviderOpts,
  CreateModelProviderFactoryFn,
  ModelProviderFactoryFn,
} from './model_provider_runtime';

/** Creates a model provider with the original request-derived telemetry defaults. */
export const createModelProvider = (opts: CreateModelProviderOpts): ModelProvider =>
  createModelProviderRuntime({
    ...opts,
    resolveTelemetryMetadata:
      opts.resolveTelemetryMetadata ?? (() => resolveModelTelemetryMetadata(opts)),
  });

/** Creates a request-scoped model provider factory. */
export const createModelProviderFactory: CreateModelProviderFactoryFn = (factoryOpts) => (opts) =>
  createModelProvider({ ...factoryOpts, ...opts });
