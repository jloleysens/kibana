/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import { z, lazySchema, lazyImmutableGCableObject } from '@kbn/zod/v4';
import type {
  ConnectorSpec,
  NormalizedAuthType,
  SpecRuntimeApi,
  SpecRuntimeServices,
} from '@kbn/connector-specs';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import {
  createTaskRunError,
  TaskErrorSource,
  getErrorSource,
  isUserError,
} from '@kbn/task-manager-plugin/server/task_running/errors';
import type { Logger } from '@kbn/core/server';
import type { ConnectorFinalization, NativeActionsApi } from './types';
import { configSchema } from '../config';
import { getActionsConfigurationUtilities } from '../actions_config';
import { createAxiosTransport, createCredentialAccessor } from '../lib/create_axios_transport';
import { getAxiosAuthStrategy } from '../lib/axios_auth_strategies/get_axios_auth_strategy';
import { createConnectorTokenStore } from './connector_token_store';
import { executeAction, getActionRuntimeError } from '../lib/execute_action';
import { createSpecExecutor } from '../lib/single_file_connectors/create_spec_executor';
import { generateConfigSchema } from '../lib/single_file_connectors/generate_config_schema';
import { generateParamsSchema } from '../lib/single_file_connectors/generate_params_schema';
import { generateSecretsSchema } from '../lib/single_file_connectors/generate_secrets_schema';
import {
  createConnectorNetworkSettings,
  createPlatformServices,
} from '../lib/single_file_connectors/create_connector_network_settings';
import { LeasePool } from '../lib/lease_pool';
import type { ActionType } from '../types';

const requestSchema = lazySchema(() =>
  z.object({
    connectorType: z.string().max(256),
    connectorNameOrId: z.string().max(1024),
    input: z.record(z.string(), z.unknown()),
    system: z.boolean(),
  })
);

const createLogger = (): Logger => {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    trace() {},
    fatal() {},
    log() {},
    isLevelEnabled: () => false,
    get: () => logger,
  };
  return logger;
};

/** Runs original spec validation, transport, authentication and handlers in the worker. */
export class SpecRuntime implements SpecRuntimeApi {
  private readonly contexts = new Map<
    string,
    {
      readonly configurationUtilities: ReturnType<typeof getActionsConfigurationUtilities>;
      readonly actionTypes: Map<string, ActionType>;
    }
  >();
  private readonly drains = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, ConnectorFinalization[]>();
  constructor(private readonly actions: NativeActionsApi) {}

  async run(
    spec: ConnectorSpec,
    services: SpecRuntimeServices,
    scopeId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const request = requestSchema.parse(input);
    if (
      request.system ||
      spec.metadata.id.replace(/^\./, '') !== request.connectorType.replace(/^\./, '')
    )
      throw new Error('Native spec connector type mismatch');
    const invocationId = randomUUID();
    const preparation = await this.actions.prepare(scopeId, invocationId, request);
    if ('result' in preparation) return preparation.result;
    const { prepared } = preparation;
    let pool: LeasePool<unknown> | undefined;
    let queued = false;
    let handlerStarted = false;
    const executionStartedAt = Date.now();
    const enqueue = (runtime: ConnectorFinalization['runtime']) => {
      const pending = this.pending.get(scopeId) ?? [];
      pending.push({ invocationId, runtime });
      this.pending.set(scopeId, pending);
      queued = true;
    };
    const started = performance.now();
    try {
      signal?.throwIfAborted();
      let context = this.contexts.get(scopeId);
      if (!context) {
        context = {
          configurationUtilities: getActionsConfigurationUtilities(
            configSchema.validate(prepared.runtimeConfig)
          ),
          actionTypes: new Map(),
        };
        this.contexts.set(scopeId, context);
      }
      const { configurationUtilities } = context;
      const logger = createLogger();
      pool = new LeasePool<unknown>(logger);
      const transportDeps = {
        userAgent: prepared.userAgent,
        authTypeRegistry: {
          get: (id: string): NormalizedAuthType => {
            const authType = services.authTypes.find((candidate) => candidate.id === id);
            if (!authType) throw new Error(`Unsupported native connector authentication: ${id}`);
            return authType;
          },
        },
        getAuthStrategy: getAxiosAuthStrategy,
        configurationUtilities,
        logger,
      };
      const executor = createSpecExecutor({
        kibanaVersion: prepared.kibanaVersion,
        connectorTypeId: spec.metadata.id,
        onHandler: (subAction) => {
          handlerStarted = true;
          recordRemoteTiming('connector_spec_handler', {
            stepType: spec.metadata.id + '.' + subAction,
            scopeId,
          });
        },
        actions: spec.actions,
        getAxiosInstanceWithAuth: createAxiosTransport(transportDeps),
        getCredential: createCredentialAccessor(transportDeps),
        getClientLeasePool: () => {
          if (!pool) throw new Error('Connector lease pool is not initialized');
          return pool;
        },
        networkSettings: createConnectorNetworkSettings(configurationUtilities),
        platform: createPlatformServices(configurationUtilities),
        clientTypes: {},
        errors: { createTaskRunError, TaskErrorSource, getErrorSource, isUserError },
      });
      let actionType = context.actionTypes.get(spec.metadata.id);
      if (!actionType) {
        actionType = {
          id: spec.metadata.id,
          name: spec.metadata.displayName,
          minimumLicenseRequired: spec.metadata.minimumLicense,
          supportedFeatureIds: spec.metadata.supportedFeatureIds,
          validate: {
            params: lazyImmutableGCableObject(() => generateParamsSchema(spec.actions)),
            config: lazyImmutableGCableObject(() =>
              generateConfigSchema(spec.schema, Object.keys(spec.actions))
            ),
            secrets: lazyImmutableGCableObject(() =>
              generateSecretsSchema(spec.auth, configurationUtilities)
            ),
          },
        };

        context.actionTypes.set(spec.metadata.id, actionType);
      }
      const runtime = await executeAction(
        {
          ...prepared,
          actionType,
          configurationUtilities,
          executor: ({ validatedParams, validatedConfig, validatedSecrets }) =>
            executor({
              ...prepared,
              connectorTokenClient: createConnectorTokenStore(this.actions, scopeId, invocationId),
              params: validatedParams,
              config: validatedConfig,
              secrets: validatedSecrets,
              logger,
              signal,
              globalAuthHeaders: spec.auth?.headers,
            }),
        },
        {
          TaskErrorSource,
          getErrorSource,
          isConnectorAuthorizationError: services.isConnectorAuthorizationError,
        }
      );
      enqueue({ ...runtime, handlerStarted });
      recordRemoteTiming('connector_handler', {
        stepType: spec.metadata.id,
        durationMs: performance.now() - started,
      });
      const { error, ...result } = runtime.result;
      return result;
    } catch (error) {
      if (!queued)
        enqueue({
          ...getActionRuntimeError(
            {
              error,
              actionId: prepared.actionId,
              actionTypeId: prepared.actionTypeId,
              name: prepared.name,
              config: prepared.config,
              secrets: prepared.secrets,
            },
            {
              TaskErrorSource,
              getErrorSource,
              isConnectorAuthorizationError: services.isConnectorAuthorizationError,
            }
          ),
          validatedParams: prepared.params,
          executionStartedAt,
          executionCompletedAt: Date.now(),
          handlerStarted,
        });
      throw error;
    } finally {
      await pool?.evict(prepared.actionId);
    }
  }

  async close(scopeId: string): Promise<void> {
    try {
      await this.drain(scopeId);
    } finally {
      this.pending.delete(scopeId);
      this.drains.delete(scopeId);
      this.contexts.delete(scopeId);
    }
  }

  async drain(scopeId: string): Promise<void> {
    const existing = this.drains.get(scopeId);
    if (existing) return existing;
    const pending = this.pending.get(scopeId) ?? [];
    if (pending.length === 0) return;
    const drain = this.actions.finalize(scopeId, pending).then(() => {
      this.pending.delete(scopeId);
    });
    this.drains.set(scopeId, drain);
    return drain;
  }
}
