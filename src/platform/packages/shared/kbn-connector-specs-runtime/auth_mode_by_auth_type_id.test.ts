/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  AUTH_MODE_BY_AUTH_TYPE_ID,
  USES_RELAY_BY_AUTH_TYPE_ID,
  IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID,
} from './auth_mode_by_auth_type_id';

it('does not construct auth maps until first use, and memoizes each independently', async () => {
  await jest.isolateModulesAsync(async () => {
    const construct = jest.spyOn(Object, 'fromEntries');
    try {
      const runtime = await import('./auth_mode_by_auth_type_id');
      expect(construct).not.toHaveBeenCalled();
      expect(runtime.AUTH_MODE_BY_AUTH_TYPE_ID.ears).toBe('per-user');
      expect(construct).toHaveBeenCalledTimes(1);
      expect(runtime.getAuthModeForAuthTypeId('ears')).toBe('per-user');
      expect(Object.keys(runtime.AUTH_MODE_BY_AUTH_TYPE_ID)).toContain('relay');
      expect(construct).toHaveBeenCalledTimes(1);
      expect(runtime.USES_RELAY_BY_AUTH_TYPE_ID.relay).toBe(true);
      expect(construct).toHaveBeenCalledTimes(2);
    } finally {
      construct.mockRestore();
    }
  });
});

it.each([AUTH_MODE_BY_AUTH_TYPE_ID, USES_RELAY_BY_AUTH_TYPE_ID, IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID])(
  'refuses mutation through every object trap',
  (map) => {
    const before = { ...map };
    expect(() => Reflect.set(map, 'relay', 'changed')).toThrow('immutable');
    expect(() => Reflect.deleteProperty(map, 'relay')).toThrow('immutable');
    expect(() => Reflect.defineProperty(map, 'relay', { value: 'changed' })).toThrow('immutable');
    expect(() => Reflect.setPrototypeOf(map, null)).toThrow('immutable');
    expect(() => Reflect.preventExtensions(map)).toThrow('immutable');
    expect({ ...map }).toEqual(before);
    expect('relay' in map).toBe(true);
    expect(Object.getOwnPropertyDescriptor(map, 'relay')?.enumerable).toBe(true);
  }
);
