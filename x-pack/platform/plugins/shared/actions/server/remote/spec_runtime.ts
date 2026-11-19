/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import { NativeActionsToken } from './tokens';
import type { NativeActionsApi } from './types';

/** Defers the entire connector capability until the first reached connector. */
export class SpecRuntime implements SpecRuntimeApi {
  private implementation?: Promise<SpecRuntimeApi>;
  constructor(@inject(NativeActionsToken) private readonly actions: NativeActionsApi) {}

  private getImplementation(): Promise<SpecRuntimeApi> {
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

  async drain(scopeId: string): Promise<void> {
    await (await this.implementation)?.drain(scopeId);
  }

  async close(scopeId: string): Promise<void> {
    await (await this.implementation)?.close(scopeId);
  }
}
