/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, KibanaRequest } from '@kbn/core/server';
import type { SpacesPluginStart } from '@kbn/spaces-plugin/server';
import { remotable, recordRemoteTiming } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { AttachmentServiceStart } from '../services/attachments/types';
import type { AttachmentRegistryApi } from './attachment_tokens';
import { createRegistryTransportError } from './registry_errors';

interface AttachmentServices {
  attachments: Pick<AttachmentServiceStart, 'getTypeDefinition' | 'getRegisteredTypeIds'>;
  coreStart: Pick<CoreStart, 'savedObjects'>;
  spaces?: SpacesPluginStart;
}

/** Keeps live type validation and origin resolution on the original scoped service boundary. */
@remotable()
export class AttachmentRegistry implements AttachmentRegistryApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getServices: () => Promise<AttachmentServices>
  ) {}

  async #call<T>(
    scopeId: string,
    operation: string,
    payload: object,
    run: (services: AttachmentServices, request: KibanaRequest) => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const services = await this.getServices();
      signal.throwIfAborted();
      const result = await run(services, request);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createRegistryTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('agent_builder_attachment_registry', {
        scopeId,
        stepType: operation,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }

  describe(scopeId: string): ReturnType<AttachmentRegistryApi['describe']> {
    return this.#call(scopeId, 'describe', {}, async ({ attachments }) =>
      attachments.getRegisteredTypeIds().map((id) => {
        const definition = attachments.getTypeDefinition(id);
        if (!definition) throw new Error(`Unknown attachment type: ${id}`);
        return { id, isReadonly: definition.isReadonly, canResolve: Boolean(definition.resolve) };
      })
    );
  }

  validate(
    ...[scopeId, type, data]: Parameters<AttachmentRegistryApi['validate']>
  ): ReturnType<AttachmentRegistryApi['validate']> {
    return this.#call(scopeId, 'validate', { type, data }, async ({ attachments }, request) => {
      const definition = attachments.getTypeDefinition(type);
      if (!definition) throw new Error(`Unknown attachment type: ${type}`);
      return definition.validate(data, { request });
    });
  }

  resolve(
    ...[scopeId, type, origin]: Parameters<AttachmentRegistryApi['resolve']>
  ): ReturnType<AttachmentRegistryApi['resolve']> {
    return this.#call(
      scopeId,
      'resolve',
      { type, origin },
      async ({ attachments, coreStart, spaces }, request) => {
        const definition = attachments.getTypeDefinition(type);
        if (!definition) throw new Error(`Unknown attachment type: ${type}`);
        if (!definition.resolve)
          throw new Error(`Attachment type "${type}" does not support resolving from origin`);
        return definition.resolve(origin, {
          request,
          spaceId: spaces?.spacesService.getSpaceId(request) ?? 'default',
          savedObjectsClient: coreStart.savedObjects.getScopedClient(request),
        });
      }
    );
  }
}
