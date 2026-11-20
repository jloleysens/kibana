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
import type { SemanticMemoryMaterializedEvent } from '../telemetry/events';
import type { CortexEntityType } from '../../common/cortex';
import type { SandboxWorkspacesApi } from './sandbox_workspaces_tokens';
import type { createWorkspaceAllocator } from './allocate_workspace';
import { createSandboxTransportError } from './sandbox_errors';

/** Sandbox credentials, TLS, sessions, allocation and isolation stay in their original owner. */
@remotable()
export class SandboxWorkspaces implements SandboxWorkspacesApi {
  private readonly sessions = new Map<
    string,
    Map<
      string,
      {
        session: SandboxSession;
        root: '/workspace/decision-trees' | '/workspace/cortex' | '/workspace/memories';
        telemetryConversationId?: string;
      }
    >
  >();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly allocateWorkspace: ReturnType<typeof createWorkspaceAllocator>,
    private readonly getSandboxStart: () => SandboxPluginStart | undefined,
    private readonly cortex: {
      isEnabled: () => boolean;
      reportHydrated: (
        conversationId: string | undefined,
        pages: Array<{ entity_type: CortexEntityType }>
      ) => void | Promise<void>;
    },
    private readonly memory: {
      isEnabled: () => boolean;
      reportMaterialized: (event: SemanticMemoryMaterializedEvent) => void;
    }
  ) {}

  async isMemoryEnabled(scopeId: string): Promise<boolean> {
    return this.#perform(scopeId, 'memory_policy', {}, async () => this.memory.isEnabled());
  }

  async openMemoryWorkspace(scopeId: string, conversationId: string): Promise<string | undefined> {
    return this.#openWorkspace(scopeId, conversationId, '/workspace/memories');
  }

  async isReset(scopeId: string, reference: string): Promise<boolean> {
    return this.#perform(
      scopeId,
      'is_reset',
      { reference },
      async () => this.#getWorkspace(scopeId, reference).session.isReset
    );
  }

  async statFiles(
    scopeId: string,
    reference: string,
    paths: string[]
  ): ReturnType<SandboxWorkspacesApi['statFiles']> {
    return this.#perform(scopeId, 'stat', { reference, paths }, async () => {
      const { session, root } = this.#getWorkspace(scopeId, reference);
      paths.forEach((path) => this.#assertWorkspacePath(root, path));
      return session.statFiles(paths);
    });
  }

  async readFiles(
    scopeId: string,
    reference: string,
    requests: Array<{ path: string; maxReadBytes?: number }>
  ): ReturnType<SandboxWorkspacesApi['readFiles']> {
    return this.#perform(scopeId, 'read', { reference, requests }, async () => {
      const { session, root } = this.#getWorkspace(scopeId, reference);
      requests.forEach(({ path }) => this.#assertWorkspacePath(root, path));
      const results = await session.readFiles(
        requests.map(({ path, maxReadBytes }) => ({ path, maxReadBytes }))
      );
      return results.map(({ path, content, success }) => ({
        path,
        contentBase64: content.toString('base64'),
        success,
      }));
    });
  }

  async reportMemoryMaterialized(
    scopeId: string,
    reference: string,
    event: Omit<SemanticMemoryMaterializedEvent, 'workflow_execution_id'>
  ): Promise<void> {
    return this.#perform(scopeId, 'memory_telemetry', { reference, event }, async () => {
      const { root } = this.#getWorkspace(scopeId, reference);
      if (root !== '/workspace/memories') throw new Error('Not a Memory workspace reference');
      const { workflowRunId } = this.scopes.getRunState(scopeId);
      const {
        agent_id,
        conversation_id,
        outcome,
        retrieval_mode,
        search_fallback,
        candidate_count,
        recalled_count,
        new_page_count,
        catalog_size,
        catalog_evicted_count,
        pod_reset,
        notification_chars,
      } = event;
      this.memory.reportMaterialized({
        agent_id,
        ...(conversation_id ? { conversation_id } : {}),
        workflow_execution_id: workflowRunId,
        outcome,
        retrieval_mode,
        search_fallback,
        candidate_count,
        recalled_count,
        new_page_count,
        catalog_size,
        catalog_evicted_count,
        pod_reset,
        notification_chars,
      });
    });
  }

  async isCortexEnabled(scopeId: string): Promise<boolean> {
    return this.#perform(scopeId, 'cortex_policy', {}, async () => this.cortex.isEnabled());
  }

  async openCortexWorkspace(
    scopeId: string,
    conversationId: string,
    telemetryConversationId: string
  ): Promise<string | undefined> {
    return this.#openWorkspace(
      scopeId,
      conversationId,
      '/workspace/cortex',
      telemetryConversationId
    );
  }

  async reportCortexHydrated(
    scopeId: string,
    reference: string,
    pages: Array<{ entity_type: CortexEntityType }>
  ): Promise<void> {
    return this.#perform(scopeId, 'cortex_telemetry', { reference, pages }, async () => {
      const { root, telemetryConversationId } = this.#getWorkspace(scopeId, reference);
      if (root !== '/workspace/cortex') throw new Error('Not a Cortex workspace reference');
      await this.cortex.reportHydrated(
        telemetryConversationId,
        pages.map(({ entity_type }) => ({ entity_type }))
      );
    });
  }

  async openDecisionTreeWorkspace(
    scopeId: string,
    conversationId: string
  ): Promise<string | undefined> {
    return this.#openWorkspace(scopeId, conversationId, '/workspace/decision-trees');
  }

  async #openWorkspace(
    scopeId: string,
    conversationId: string,
    root: '/workspace/decision-trees' | '/workspace/cortex' | '/workspace/memories',
    telemetryConversationId?: string
  ): Promise<string | undefined> {
    return this.#perform(scopeId, 'open', { conversationId }, async () => {
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
      references.set(reference, { session, root, telemetryConversationId });
      return reference;
    });
  }

  async mkdirs(scopeId: string, reference: string, paths: string[]): Promise<boolean[]> {
    return this.#perform(scopeId, 'mkdirs', { reference, paths }, async () => {
      const { session, root } = this.#getWorkspace(scopeId, reference);
      paths.forEach((path) => this.#assertWorkspacePath(root, path));
      return session.mkdirs(paths);
    });
  }

  async writeFiles(
    scopeId: string,
    reference: string,
    files: Array<{ path: string; content: string }>
  ): ReturnType<SandboxSession['writeFiles']> {
    return this.#perform(scopeId, 'write_files', { reference, files }, async () => {
      const { session, root } = this.#getWorkspace(scopeId, reference);
      files.forEach(({ path }) => this.#assertWorkspacePath(root, path));
      return session.writeFiles(
        files.map(({ path, content }) => ({ path, content: Buffer.from(content, 'utf8') }))
      );
    });
  }

  #getWorkspace(scopeId: string, reference: string) {
    const workspace = this.sessions.get(scopeId)?.get(reference);
    if (!workspace) throw new Error('Unknown sandbox workspace reference');
    return workspace;
  }

  #assertWorkspacePath(root: string, path: string): void {
    if (posix.normalize(path) !== path || (path !== root && !path.startsWith(root + '/')))
      throw new Error('Path outside sandbox workspace');
  }

  async #perform<T>(
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
      throw createSandboxTransportError(error);
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
      throw createSandboxTransportError(error);
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
