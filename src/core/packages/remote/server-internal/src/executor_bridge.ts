/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { RpcTarget } from 'capnweb';

export function createBridge(): {
  rpc: RpcTarget;
  attach(executor: object, loaded: string[]): void;
} {
  const state: {
    executor?: Record<string, (...args: unknown[]) => unknown>;
    loaded: string[];
  } = { loaded: [] };

  class Bridge extends RpcTarget {
    loadedModules(): string[] {
      return state.loaded;
    }
  }

  return {
    rpc: new Bridge(),
    attach(executor, loaded) {
      state.executor = executor as Record<string, (...args: unknown[]) => unknown>;
      state.loaded = loaded;
      const proto = Bridge.prototype as unknown as Record<string, unknown>;
      let cursor: object | null = executor;
      while (cursor && cursor !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(cursor)) {
          if (name === 'constructor' || typeof proto[name] === 'function') continue;
          const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
          if (typeof descriptor?.value !== 'function') continue;
          const method = descriptor.value as (...args: unknown[]) => unknown;
          proto[name] = (...args: unknown[]) => method.apply(state.executor, args);
        }
        cursor = Object.getPrototypeOf(cursor) as object | null;
      }
    },
  };
}
