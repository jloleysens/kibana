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
import { isConnectorAuthorizationError } from '@kbn/connector-specs/server/remote/connector_authorization_error';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import {
  createTaskRunError,
  TaskErrorSource,
  getErrorSource,
  isUserError,
} from '@kbn/task-manager-plugin/server/task_running/errors';
import type { Logger } from '@kbn/core/server';
import { sanitizeConnectorError } from './connector_error';
import type { ClassicConnectorType } from './classic_connector_types';
import { ConnectorUsageCollector } from '../usage/connector_usage_collector';
import type { ConnectorFinalization, NativeActionsApi } from './types';
import { configSchema } from '../config';
import { getActionsConfigurationUtilities } from '../actions_config';
import { createAxiosTransport, createCredentialAccessor } from '../lib/create_axios_transport';
import { getAxiosAuthStrategy } from '../lib/axios_auth_strategies/get_axios_auth_strategy';
import { createConnectorRelayClient } from './connector_relay_client';
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
import { createConnectorDashboardStore } from './connector_dashboard_store';
import { buildExecutor } from '../sub_action_framework/executor';
import { buildValidators } from '../sub_action_framework/validators';
import type { SubActionConnectorType, SubActionServices } from '../sub_action_framework/types';
import type { PreparedConnector } from './types';
import type { ActionRuntimeResult } from '../lib/execute_action';

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
  private readonly retries = new Map<string, string[]>();
  constructor(private readonly actions: NativeActionsApi) {}

  async run(
    spec: ConnectorSpec,
    services: SpecRuntimeServices,
    scopeId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.runPrepared(
      spec.metadata.id,
      scopeId,
      input,
      signal,
      async (prepared, context, logger, invocationId, markHandler) => {
        const pool = new LeasePool<unknown>(logger);
        let handlerStarted = false;
        const { configurationUtilities } = context;
        try {
          const transportDeps = {
            userAgent: prepared.userAgent,
            authTypeRegistry: {
              get: (id: string): NormalizedAuthType => {
                const authType = services.authTypes.find((candidate) => candidate.id === id);
                if (!authType)
                  throw new Error(`Unsupported native connector authentication: ${id}`);
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
              markHandler();
              recordRemoteTiming('connector_spec_handler', {
                stepType: spec.metadata.id + '.' + subAction,
                scopeId,
              });
            },
            actions: spec.actions,
            getRelayClient: () =>
              prepared.relayAvailable
                ? createConnectorRelayClient(this.actions, scopeId, invocationId)
                : undefined,
            getAxiosInstanceWithAuth: createAxiosTransport(transportDeps),
            getCredential: createCredentialAccessor(transportDeps),
            getClientLeasePool: () => {
              return pool;
            },
            networkSettings: createConnectorNetworkSettings(configurationUtilities),
            platform: createPlatformServices(configurationUtilities),
            getClientType: async (id) =>
              (await import('@kbn/connector-specs/src/lib/clients/get_client_type')).getClientType(
                id
              ),
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
                  connectorTokenClient: createConnectorTokenStore(
                    this.actions,
                    scopeId,
                    invocationId,
                    prepared.earsTransportAvailable
                  ),
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

          return { ...runtime, handlerStarted };
        } finally {
          await pool.evict(prepared.actionId);
        }
      }
    );
  }

  async runLegacy<Config extends Record<string, unknown>, Secrets extends Record<string, unknown>>(
    connector: SubActionConnectorType<Config, Secrets, SubActionServices>,
    services: Pick<SubActionServices, 'scopedClusterClient'>,
    scopeId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.runPrepared(
      connector.id,
      scopeId,
      input,
      signal,
      async (prepared, context, logger, invocationId, markHandler) => {
        const { configurationUtilities } = context;
        const executor = buildExecutor({ connector, configurationUtilities, logger, signal });
        const actionType = {
          id: connector.id,
          name: connector.name,
          minimumLicenseRequired: connector.minimumLicenseRequired,
          supportedFeatureIds: connector.supportedFeatureIds,
          validate: buildValidators({
            connector,
            configurationUtilities,
          }) as ActionType['validate'],
        };
        const usage = new ConnectorUsageCollector({ logger, connectorId: prepared.actionId });
        const runtime = await executeAction(
          {
            ...prepared,
            actionType,
            configurationUtilities,
            executor: ({ validatedParams, validatedConfig, validatedSecrets }) => {
              markHandler();
              recordRemoteTiming('connector_legacy_handler', { stepType: connector.id, scopeId });
              return executor({
                actionId: prepared.actionId,
                params: validatedParams as import('../sub_action_framework/types').ExecutorParams,
                config: validatedConfig as Config,
                secrets: validatedSecrets as Secrets,
                configurationUtilities,
                services: {
                  ...services,
                  inferenceStreamingFacts: prepared.inferenceStreamingFacts,
                  savedObjectsClient: createConnectorDashboardStore(
                    this.actions,
                    scopeId,
                    invocationId
                  ),
                  connectorTokenClient: createConnectorTokenStore(
                    this.actions,
                    scopeId,
                    invocationId
                  ),
                },
                logger,
                connectorUsageCollector: usage,
                signal,
                connectorVersion: prepared.connectorVersion,
              });
            },
          },
          { TaskErrorSource, getErrorSource, isConnectorAuthorizationError }
        );
        const { getGenAiTokenTracking } = await import(
          '../lib/token_tracking/gen_ai_token_tracking'
        );
        const tracking =
          runtime.result.status === 'ok'
            ? getGenAiTokenTracking({
                actionTypeId: connector.id,
                logger,
                result: runtime.result,
                validatedParams: runtime.validatedParams,
              })
            : Promise.resolve(null);
        // Match ordinary step persistence: streams become JSON descriptors, not a new output API.
        const result =
          runtime.result.status === 'ok'
            ? (JSON.parse(JSON.stringify(runtime.result)) as typeof runtime.result)
            : runtime.result;
        return {
          ...runtime,
          result,
          genAiTokenTracking: await tracking,
          requestBodyBytes: usage.getRequestBodyByte(),
        };
      }
    );
  }

  async runClassic<
    Config extends Record<string, unknown>,
    Secrets extends Record<string, unknown>,
    Params extends Record<string, unknown>,
    Result
  >(
    type: string,
    createConnector: (
      prepared: PreparedConnector
    ) => ClassicConnectorType<Config, Secrets, Params, Result>,
    scopeId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.runPrepared(
      type,
      scopeId,
      input,
      signal,
      async (prepared, context, logger, invocationId, markHandler) => {
        const connector = createConnector(prepared);
        if (connector.id.replace(/^\./, '') !== type.replace(/^\./, ''))
          throw new Error('Classic connector type mismatch');
        const usage = new ConnectorUsageCollector({ logger, connectorId: prepared.actionId });
        const runtime = await executeAction(
          {
            ...prepared,
            actionType: {
              id: connector.id,
              name: connector.name,
              minimumLicenseRequired: connector.minimumLicenseRequired,
              supportedFeatureIds: connector.supportedFeatureIds,
              validate: connector.validate as ActionType['validate'],
            },
            configurationUtilities: context.configurationUtilities,
            executor: ({ validatedParams, validatedConfig, validatedSecrets }) => {
              markHandler();
              recordRemoteTiming('connector_classic_handler', { stepType: connector.id, scopeId });
              const connectorTokenClient = createConnectorTokenStore(
                this.actions,
                scopeId,
                invocationId
              );
              return connector.executor({
                ...prepared,
                params: validatedParams as Params,
                config: validatedConfig as Config,
                secrets: validatedSecrets as Secrets,
                configurationUtilities: context.configurationUtilities,
                services: { connectorTokenClient },
                connectorTokenClient,
                connectorUsageCollector: usage,
                logger,
                signal,
              });
            },
          },
          { TaskErrorSource, getErrorSource, isConnectorAuthorizationError }
        );
        return { ...runtime, requestBodyBytes: usage.getRequestBodyByte() };
      }
    );
  }

  private async runPrepared(
    type: string,
    scopeId: string,
    input: unknown,
    signal: AbortSignal | undefined,
    execute: (
      prepared: PreparedConnector,
      context: {
        readonly configurationUtilities: ReturnType<typeof getActionsConfigurationUtilities>;
        readonly actionTypes: Map<string, ActionType>;
      },
      logger: Logger,
      invocationId: string,
      markHandler: () => void
    ) => Promise<ActionRuntimeResult>
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const request = requestSchema.parse(input);
    if (request.system || type.replace(/^\./, '') !== request.connectorType.replace(/^\./, ''))
      throw new Error('Native connector type mismatch');
    const invocationId = randomUUID();
    const preparation = await this.actions.prepare(scopeId, invocationId, request);
    if ('result' in preparation) return preparation.result;
    const { prepared } = preparation;
    let queued = false;
    let handlerStarted = false;
    const executionStartedAt = Date.now();
    const enqueue = (runtime: ConnectorFinalization['runtime']) => {
      const pending = this.pending.get(scopeId) ?? [];
      const { error, ...result } = runtime.result;
      pending.push({
        invocationId,
        runtime: {
          ...runtime,
          result: {
            ...result,
            ...(error ? { error: sanitizeConnectorError(error) } : {}),
          },
        },
      });
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
      const logger = createLogger();
      const runtime = await execute(prepared, context, logger, invocationId, () => {
        handlerStarted = true;
      });
      enqueue({ ...runtime, handlerStarted });
      recordRemoteTiming('connector_handler', {
        stepType: type,
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
              isConnectorAuthorizationError,
            }
          ),
          validatedParams: prepared.params,
          executionStartedAt,
          executionCompletedAt: Date.now(),
          handlerStarted,
        });
      throw error;
    }
  }

  async close(scopeId: string): Promise<void> {
    try {
      do {
        await this.drain(scopeId);
      } while (this.retries.has(scopeId) || this.pending.get(scopeId)?.length);
    } finally {
      this.contexts.delete(scopeId);
    }
  }

  async drain(scopeId: string): Promise<void> {
    const existing = this.drains.get(scopeId);
    if (existing) return existing;
    const drain = (async () => {
      while (true) {
        const retryIds = this.retries.get(scopeId);
        if (retryIds) {
          await this.actions.finalizeRetry(scopeId, retryIds);
          this.retries.delete(scopeId);
          continue;
        }
        const pending = this.pending.get(scopeId) ?? [];
        if (pending.length === 0) return;
        this.pending.delete(scopeId);
        const invocationIds = pending.map(({ invocationId }) => invocationId);
        this.retries.set(scopeId, invocationIds);
        await this.actions
          .finalize(scopeId, pending)
          .catch(() => this.actions.finalizeRetry(scopeId, invocationIds));
        this.retries.delete(scopeId);
      }
    })().finally(() => {
      this.drains.delete(scopeId);
    });
    this.drains.set(scopeId, drain);
    return drain;
  }
}
