/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { coreMock, httpServerMock } from '@kbn/core/server/mocks';
import { spacesMock } from '@kbn/spaces-plugin/server/mocks';
import { asSpaceId } from '@kbn/core-spaces-common';
import type { AttachmentTypeDefinition } from '@kbn/agent-builder-server/attachments';
import { createAttachmentStateManager } from '@kbn/agent-builder-server/attachments';
import { AttachmentRegistry } from './attachment_registry';
import type { AttachmentRegistryApi } from './attachment_tokens';
import { restoreRegistryError } from './registry_errors';

const setup = () => {
  const request = httpServerMock.createKibanaRequest();
  const coreStart = coreMock.createStart();
  const controller = new AbortController();
  const definition: AttachmentTypeDefinition = {
    id: 'text',
    isReadonly: true,
    validate: jest.fn(async (data) => ({ valid: true as const, data })),
    resolve: jest.fn(async (origin) => ({ content: origin })),
    format: () => ({ getRepresentation: () => ({ type: 'text', value: 'Fixture' }) }),
  };
  const attachments = {
    getTypeDefinition: jest.fn((type: string) => (type === 'text' ? definition : undefined)),
    getRegisteredTypeIds: () => ['text'],
  };
  const scopes = {
    get: jest.fn().mockImplementation((id) => {
      if (id !== 'run') throw new Error('Foreign run');
      return request;
    }),
    getRunState: jest.fn(),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
    getAbortSignal: (id: string) => {
      if (id !== 'run') throw new Error('Foreign run');
      return controller.signal;
    },
  };
  const services: Awaited<ReturnType<ConstructorParameters<typeof AttachmentRegistry>[1]>> = {
    attachments,
    coreStart,
  };
  const getServices = jest.fn(async () => services);
  const registry = new AttachmentRegistry(scopes, getServices);
  return { registry, request, coreStart, controller, definition, attachments, getServices };
};

it('exports only registered type facts and exposes no generic callback', async () => {
  const { registry } = setup();
  expect(await registry.describe('run')).toEqual([
    { id: 'text', isReadonly: true, canResolve: true },
  ]);
  expect('call' in expose(registry)).toBe(false);
  expect(Object.keys(expose(registry)).some((key) => key.includes('savedObjects'))).toBe(false);
  await expect(registry.describe('foreign')).rejects.toThrow('Foreign run');
});

it('uses the original run request, scoped SO client and space default for original callbacks', async () => {
  const { registry, request, coreStart, definition } = setup();
  await registry.validate('run', 'text', { content: 'value' });
  expect(definition.validate).toHaveBeenCalledWith({ content: 'value' }, { request });
  await registry.resolve('run', 'text', 'origin');
  expect(coreStart.savedObjects.getScopedClient).toHaveBeenCalledWith(request);
  expect(definition.resolve).toHaveBeenCalledWith('origin', {
    request,
    spaceId: 'default',
    savedObjectsClient: coreStart.savedObjects.getScopedClient.mock.results[0].value,
  });
});

it('resolves origins in the owning request space instead of trusting worker-supplied space facts', async () => {
  const { registry, request, definition, getServices } = setup();
  const services = await getServices();
  const spaces = spacesMock.createStart();
  spaces.spacesService.getSpaceId.mockReturnValue(asSpaceId('owning-space'));
  getServices.mockResolvedValueOnce({ ...services, spaces });
  await registry.resolve('run', 'text', 'origin');
  expect(spaces.spacesService.getSpaceId).toHaveBeenCalledWith(request);
  expect(definition.resolve).toHaveBeenCalledWith(
    'origin',
    expect.objectContaining({ request, spaceId: 'owning-space' })
  );
});

it('refuses unknown types, unsupported origins and closed scopes before original callbacks', async () => {
  const { registry, controller, definition, getServices } = setup();
  await expect(registry.validate('run', 'foreign', {})).rejects.toThrow('Unknown attachment');
  await expect(registry.resolve('run', 'foreign', 'origin')).rejects.toThrow('Unknown attachment');
  definition.resolve = undefined;
  await expect(registry.resolve('run', 'text', 'origin')).rejects.toThrow('does not support');
  getServices.mockClear();
  controller.abort();
  await expect(registry.validate('run', 'text', {})).rejects.toThrow();
  expect(getServices).not.toHaveBeenCalled();
  expect(definition.validate).not.toHaveBeenCalled();
});

it('refuses a response when the run closes during original registry lookup', async () => {
  const { registry, controller, getServices } = setup();
  const original = await getServices();
  getServices.mockImplementationOnce(async () => {
    controller.abort();
    return original;
  });
  await expect(registry.describe('run')).rejects.toThrow();
});

it('preserves builtin retry errors without transporting private authorization metadata over real RPC', async () => {
  const { registry, definition } = setup();
  const failure = Object.assign(new TypeError('Original validation failure'), {
    headers: { authorization: 'private-authorization-fixture' },
  });
  definition.validate = async () => {
    throw failure;
  };
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<AttachmentRegistryApi>(port1);
    openPortSession(port2, expose(registry));
    try {
      await restoreRegistryError<Awaited<ReturnType<AttachmentRegistryApi['validate']>>>(
        remote.validate('run', 'text', {})
      );
      throw new Error('Expected original failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ name: 'TypeError', message: failure.message });
      expect(JSON.stringify(error)).not.toContain('private-authorization-fixture');
      expect(error).not.toHaveProperty('headers');
    }
    expect(failure.headers.authorization).toBe('private-authorization-fixture');
  } finally {
    port1.close();
    port2.close();
  }
});

it('runs original by-reference attachment state without a fake Core or SO context', async () => {
  const localResolve = jest.fn(() => {
    throw new Error('The scoped resolver owns origin lookup');
  });
  const resolveOrigin = jest.fn(async (type: string, origin: string) => ({
    content: `${type}:${origin}`,
  }));
  const state = createAttachmentStateManager([], {
    getTypeDefinition: (type) =>
      type === 'text'
        ? {
            id: 'text',
            isReadonly: true,
            validate: (data) => ({ valid: true, data }),
            resolve: localResolve,
          }
        : undefined,
    resolveOrigin,
  });
  const attachment = await state.add({ id: 'attachment', type: 'text', origin: 'original-id' });
  expect(resolveOrigin).toHaveBeenCalledWith('text', 'original-id');
  expect(localResolve).not.toHaveBeenCalled();
  expect(attachment).toMatchObject({
    id: 'attachment',
    origin: 'original-id',
    readonly: true,
    current_version: 1,
    versions: [{ version: 1, data: { content: 'text:original-id' } }],
  });
  expect(state.drainChanges()).toEqual([
    { kind: 'added', attachment_id: 'attachment', attachment_type: 'text', current_version: 1 },
  ]);
  await expect(state.add({ type: 'unknown', origin: 'original-id' })).rejects.toThrow(
    'Unknown attachment'
  );
  expect(resolveOrigin).toHaveBeenCalledTimes(1);
});
