/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import type { ClassicConnectorType } from './classic_connector_types';
import type { PreparedConnector } from './types';
import { NativeActionsToken } from './tokens';
import type { SubActionConnectorType, SubActionServices } from '../sub_action_framework/types';
import type { SpecRuntime as Implementation } from './spec_runtime_impl';
import type { NativeActionsApi } from './types';

/** Defers the entire connector capability until the first reached connector. */
export class SpecRuntime implements SpecRuntimeApi {
  private implementation?: Promise<Implementation>;
  constructor(@inject(NativeActionsToken) private readonly actions: NativeActionsApi) {}

  private getImplementation(): Promise<Implementation> {
    if (!this.implementation) {
      const pending = import('./spec_runtime_impl').then(
        ({ SpecRuntime: Implementation }) => new Implementation(this.actions)
      );
      this.implementation = pending;
      void pending.catch(() => {
        if (this.implementation === pending) this.implementation = undefined;
      });
    }
    return this.implementation;
  }

  async run(...args: Parameters<SpecRuntimeApi['run']>): ReturnType<SpecRuntimeApi['run']> {
    return (await this.getImplementation()).run(...args);
  }

  async runLegacy<Config extends Record<string, unknown>, Secrets extends Record<string, unknown>>(
    connector: SubActionConnectorType<Config, Secrets, SubActionServices>,
    services: Pick<SubActionServices, 'scopedClusterClient'>,
    scopeId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return (await this.getImplementation()).runLegacy(connector, services, scopeId, input, signal);
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
    return (await this.getImplementation()).runClassic(
      type,
      createConnector,
      scopeId,
      input,
      signal
    );
  }

  async drain(scopeId: string): Promise<void> {
    await (await this.implementation)?.drain(scopeId);
  }

  async close(scopeId: string): Promise<void> {
    await (await this.implementation)?.close(scopeId);
  }
}
