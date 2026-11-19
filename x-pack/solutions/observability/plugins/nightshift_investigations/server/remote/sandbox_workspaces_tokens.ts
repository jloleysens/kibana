/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import { createToken } from '@kbn/core-di';
import type { CortexEntityType } from '../../common/cortex';

export interface SandboxWorkspacesApi {
  isCortexEnabled(scopeId: string): Promise<boolean>;
  openCortexWorkspace(
    scopeId: string,
    conversationId: string,
    telemetryConversationId: string
  ): Promise<string | undefined>;
  reportCortexHydrated(
    scopeId: string,
    reference: string,
    pages: Array<{ entity_type: CortexEntityType }>
  ): Promise<void>;
  openDecisionTreeWorkspace(scopeId: string, conversationId: string): Promise<string | undefined>;
  mkdirs(scopeId: string, reference: string, paths: string[]): Promise<boolean[]>;
  writeFiles(
    scopeId: string,
    reference: string,
    files: Array<{ path: string; content: string }>
  ): ReturnType<SandboxSession['writeFiles']>;
  allocate(
    scopeId: string,
    conversationId: string,
    required: boolean
  ): Promise<{ skipped?: boolean }>;
}
export const SandboxWorkspacesToken = createToken<SandboxWorkspacesApi>(
  'nightshift.sandboxWorkspaces'
);
