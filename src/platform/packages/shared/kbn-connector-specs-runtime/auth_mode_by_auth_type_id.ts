/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { AuthMode } from './types';
import { AUTH_TYPE_METADATA } from './auth_type_metadata';

function isAuthTypeSpecEntry(value: unknown): value is {
  id: string;
  authMode?: AuthMode;
  usesRelayTransport?: boolean;
  isKibanaManaged?: boolean;
} {
  return typeof (value as { id?: string })?.id === 'string';
}

function authModeOf(spec: { id: string; authMode?: AuthMode }): AuthMode {
  return spec.authMode ?? 'shared';
}

function usesRelayTransportOf(spec: { id: string; usesRelayTransport?: boolean }): boolean {
  return spec.usesRelayTransport ?? false;
}

function isKibanaManagedOf(spec: { id: string; isKibanaManaged?: boolean }): boolean {
  return spec.isKibanaManaged ?? false;
}

export const AUTH_MODE_BY_AUTH_TYPE_ID: Record<string, AuthMode> = lazyAuthMap(
  () =>
    Object.fromEntries(
      Object.values(AUTH_TYPE_METADATA)
        .filter(isAuthTypeSpecEntry)
        .map((spec) => [spec.id, authModeOf(spec)])
    ) as Record<string, AuthMode>
);

export function getAuthModeForAuthTypeId(authTypeId: string): AuthMode {
  return AUTH_MODE_BY_AUTH_TYPE_ID[authTypeId] ?? 'shared';
}

export const USES_RELAY_BY_AUTH_TYPE_ID: Record<string, boolean> = lazyAuthMap(
  () =>
    Object.fromEntries(
      Object.values(AUTH_TYPE_METADATA)
        .filter(isAuthTypeSpecEntry)
        .map((spec) => [spec.id, usesRelayTransportOf(spec)])
    ) as Record<string, boolean>
);

export function authTypeUsesRelay(authTypeId: string): boolean {
  return USES_RELAY_BY_AUTH_TYPE_ID[authTypeId] ?? false;
}

export const IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID: Record<string, boolean> = lazyAuthMap(
  () =>
    Object.fromEntries(
      Object.values(AUTH_TYPE_METADATA)
        .filter(isAuthTypeSpecEntry)
        .map((spec) => [spec.id, isKibanaManagedOf(spec)])
    ) as Record<string, boolean>
);

export function isKibanaManagedAuthTypeId(authTypeId: string): boolean {
  return IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID[authTypeId] ?? false;
}

function immutableAuthMap(): never {
  throw new Error('Connector auth metadata is immutable');
}

function lazyAuthMap<T extends string | boolean>(
  factory: () => Record<string, T>
): Record<string, T> {
  let cached: Record<string, T> | undefined;
  const materialize = () => (cached ??= factory());
  return new Proxy(
    {},
    {
      get: (_target, key) => Reflect.get(materialize(), key),
      has: (_target, key) => Reflect.has(materialize(), key),
      ownKeys: () => Reflect.ownKeys(materialize()),
      getOwnPropertyDescriptor: (_target, key) =>
        Reflect.getOwnPropertyDescriptor(materialize(), key),
      set: immutableAuthMap,
      defineProperty: immutableAuthMap,
      deleteProperty: immutableAuthMap,
      setPrototypeOf: immutableAuthMap,
      preventExtensions: immutableAuthMap,
    }
  );
}
