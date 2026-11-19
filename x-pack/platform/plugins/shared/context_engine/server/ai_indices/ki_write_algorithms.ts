/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import isEqual from 'lodash/isEqual';
import type { AiIndexDest } from '../../common/http_api/ai_indices';
import type { KiLifecycleStatus, KiPartialFields } from '../../common/step_types/ki';
import { KiDeletedError } from './errors';
import { isKiDeleted } from './ki_revision_lifecycle';
import type { KiRevision, KiWriter, StoredKi, getKiRevision } from './ki_revision';

/** Final revision adapters own provenance; the domain algorithms never receive writer authority. */
export interface KiRevisionOperations {
  get(options: Omit<Parameters<typeof getKiRevision>[0], 'esClient'>): Promise<KiRevision>;
  write(options: {
    aiIndexId: string;
    dest: AiIndexDest;
    kiId: string;
    revision: KiRevision;
    changes: KiPartialFields & {
      updated_at: string;
      governance: { lifecycle?: { status: KiLifecycleStatus } };
    };
    refresh?: boolean;
    abortSignal?: AbortSignal;
  }): Promise<{ result: 'updated' | 'noop' }>;
}

/** Whether every field in `ki` (and the lifecycle status) matches the stored KI.
 * It doesn't compare other governance fields like provenance.
 */
const isNoopUpdate = (
  source: StoredKi,
  ki: KiPartialFields,
  lifecycle?: { status: KiLifecycleStatus }
): boolean => {
  if (lifecycle !== undefined && lifecycle.status !== source.governance?.lifecycle?.status) {
    return false;
  }
  // We need to loop entries and use isEqual instead of isMatch because it treats arrays as unordered subsets, so shrinking tags would look unchanged.
  return Object.entries(ki).every(([key, value]) => isEqual(source[key], value));
};

export interface UpdateKiOptions {
  aiIndexId: string;
  dest: AiIndexDest;
  kiId: string;
  ki: KiPartialFields;
  writer: KiWriter;
  backingIndex?: string;
  /** Bypasses the deleted-KI guard, allowing updates to an already soft-deleted KI. */
  force?: boolean;
  lifecycle?: { status: KiLifecycleStatus };
  refresh?: boolean;
  abortSignal?: AbortSignal;
}

/** Updates the current revision of a KI in place or appends a data-stream revision. */
export const updateKiWithRevisionOperations = async (
  options: Omit<UpdateKiOptions, 'writer'>,
  operations: KiRevisionOperations
): Promise<{ id: string; result: 'updated' | 'noop' }> => {
  const {
    aiIndexId,
    dest,
    kiId,
    ki,
    backingIndex,
    force = false,
    lifecycle,
    refresh = true,
    abortSignal,
  } = options;

  const revision = await operations.get({
    aiIndexId,
    dest,
    kiId,
    backingIndex,
    includeSource: true,
    abortSignal,
  });
  if (isKiDeleted(revision.source) && !force) {
    throw new KiDeletedError(aiIndexId, kiId, 'restore the deleted KI before updating it');
  }

  if (isNoopUpdate(revision.source, ki, lifecycle)) {
    return { id: kiId, result: 'noop' };
  }

  const now = new Date().toISOString();
  const changes = {
    ...ki,
    updated_at: now,
    governance: { ...(lifecycle && { lifecycle }) },
  };

  const { result } = await operations.write({
    aiIndexId,
    dest,
    kiId,
    revision,
    changes,
    refresh,
    abortSignal,
  });

  return { id: kiId, result };
};

export interface SoftDeleteKiOptions {
  aiIndexId: string;
  dest: AiIndexDest;
  kiId: string;
  writer: KiWriter;
  backingIndex?: string;
  refresh?: boolean;
  abortSignal?: AbortSignal;
}

/** Marks a KI as deleted via lifecycle tombstone without removing the document. */
export const softDeleteKiWithRevisionOperations = async (
  options: Omit<SoftDeleteKiOptions, 'writer'>,
  operations: KiRevisionOperations
): Promise<{ id: string }> => {
  const { aiIndexId, dest, kiId, backingIndex, refresh = true, abortSignal } = options;

  const revision = await operations.get({
    aiIndexId,
    dest,
    kiId,
    backingIndex,
    abortSignal,
  });
  if (isKiDeleted(revision.source)) {
    return { id: kiId };
  }

  const now = new Date().toISOString();
  const changes = {
    updated_at: now,
    governance: {
      lifecycle: { status: 'deleted' as const },
    },
  };

  await operations.write({
    aiIndexId,
    dest,
    kiId,
    revision,
    changes,
    refresh,
    abortSignal,
  });

  return { id: kiId };
};

export interface RestoreKiOptions {
  aiIndexId: string;
  dest: AiIndexDest;
  kiId: string;
  writer: KiWriter;
  backingIndex?: string;
  refresh?: boolean;
  abortSignal?: AbortSignal;
}

/** Restores a soft-deleted KI by setting lifecycle status back to active. */
export const restoreKiWithRevisionOperations = async (
  options: Omit<RestoreKiOptions, 'writer'>,
  operations: KiRevisionOperations
): Promise<{ id: string }> => {
  const { aiIndexId, dest, kiId, backingIndex, refresh = true, abortSignal } = options;

  const revision = await operations.get({
    aiIndexId,
    dest,
    kiId,
    backingIndex,
    abortSignal,
  });
  if (!isKiDeleted(revision.source)) {
    return { id: kiId };
  }

  const now = new Date().toISOString();
  const changes = {
    updated_at: now,
    governance: {
      lifecycle: { status: 'active' as const },
    },
  };

  await operations.write({
    aiIndexId,
    dest,
    kiId,
    revision,
    changes,
    refresh,
    abortSignal,
  });

  return { id: kiId };
};
