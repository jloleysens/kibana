/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { SandboxPluginStart, SandboxSession } from '@kbn/sandbox-plugin/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { SandboxWorkspacesApi } from './sandbox_workspaces_tokens';
import type { createWorkspaceAllocator } from './allocate_workspace';
import { createInvestigationTransportError } from './investigation_errors';

/** Sandbox credentials, TLS, sessions, allocation and isolation stay in their original owner. */
@remotable()
export class SandboxWorkspaces implements SandboxWorkspacesApi {
  private readonly sessions = new Map<string, Map<string, SandboxSession>>();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly allocateWorkspace: ReturnType<typeof createWorkspaceAllocator>,
    private readonly getSandboxStart: () => SandboxPluginStart | undefined
  ) {}

  async openDecisionTreeWorkspace(
    scopeId: string,
    conversationId: string
  ): Promise<string | undefined> {
    return this.perform(scopeId, 'open', { conversationId }, async () => {
      const { spaceId } = this.scopes.getRunState(scopeId);
      const session = this.getSandboxStart()?.getSessionForSpace(spaceId, conversationId);
      if (!session) return undefined;
      let references = this.sessions.get(scopeId);
      if (!references) {
        references = new Map();
        this.sessions.set(scopeId, references);
        this.scopes
          .getAbortSignal(scopeId)
          .addEventListener('abort', () => this.sessions.delete(scopeId), { once: true });
      }
      const reference = randomUUID();
      references.set(reference, session);
      return reference;
    });
  }

  async mkdirs(scopeId: string, reference: string, paths: string[]): Promise<boolean[]> {
    return this.perform(scopeId, 'mkdirs', { reference, paths }, async () => {
      const session = this.getSession(scopeId, reference);
      paths.forEach((path) => this.assertTreePath(path));
      return session.mkdirs(paths);
    });
  }

  async writeFiles(
    scopeId: string,
    reference: string,
    files: Array<{ path: string; content: string }>
  ): ReturnType<SandboxSession['writeFiles']> {
    return this.perform(scopeId, 'write_files', { reference, files }, async () => {
      const session = this.getSession(scopeId, reference);
      files.forEach(({ path }) => this.assertTreePath(path));
      return session.writeFiles(
        files.map(({ path, content }) => ({ path, content: Buffer.from(content, 'utf8') }))
      );
    });
  }

  private getSession(scopeId: string, reference: string): SandboxSession {
    const session = this.sessions.get(scopeId)?.get(reference);
    if (!session) throw new Error('Unknown sandbox workspace reference');
    return session;
  }

  private assertTreePath(path: string): void {
    const root = '/workspace/decision-trees';
    if (posix.normalize(path) !== path || (path !== root && !path.startsWith(root + '/')))
      throw new Error('Path outside decision tree workspace');
  }

  private async perform<T>(
    scopeId: string,
    operation: string,
    input: object,
    run: () => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      this.scopes.getRunState(scopeId);
      const result = await run();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_sandbox_' + operation, {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify(input)),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }

  async allocate(
    scopeId: string,
    conversationId: string,
    required: boolean
  ): Promise<{ skipped?: boolean }> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const { spaceId } = this.scopes.getRunState(scopeId);
      const { skipped } = await this.allocateWorkspace(spaceId, conversationId, required);
      signal.throwIfAborted();
      return skipped ? { skipped } : {};
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_sandbox_allocate', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify({ conversationId, required })),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}
