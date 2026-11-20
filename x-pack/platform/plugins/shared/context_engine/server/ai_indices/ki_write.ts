/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { KiWriter } from './ki_revision';
import { getKiRevision, writeKiRevision } from './ki_revision';
import {
  updateKiWithRevisionOperations,
  softDeleteKiWithRevisionOperations,
  restoreKiWithRevisionOperations,
} from './ki_write_algorithms';
import type {
  KiRevisionOperations,
  UpdateKiOptions,
  SoftDeleteKiOptions,
  RestoreKiOptions,
} from './ki_write_algorithms';

export type { UpdateKiOptions, SoftDeleteKiOptions, RestoreKiOptions } from './ki_write_algorithms';

export type KiApiWriterAction = 'update' | 'delete' | 'restore';

export const buildKiApiWriter = (action: KiApiWriterAction, spaceId: string): KiWriter => ({
  uri: `api://context_engine.ki.${action}`,
  metadata: { space_id: spaceId },
});

const createRevisionOperations = (
  esClient: ElasticsearchClient,
  writer: KiWriter
): KiRevisionOperations => ({
  get: (options) => getKiRevision({ esClient, ...options }),
  write: ({ changes, ...options }) =>
    writeKiRevision({
      esClient,
      ...options,
      changes: {
        ...changes,
        governance: {
          provenance: { updated_by: writer },
          ...changes.governance,
        },
      },
    }),
});

/** Updates the current revision of a KI in place or appends a data-stream revision. */
export const updateKi = async (
  esClient: ElasticsearchClient,
  options: UpdateKiOptions
): Promise<{ id: string; result: 'updated' | 'noop' }> =>
  updateKiWithRevisionOperations(options, createRevisionOperations(esClient, options.writer));

/** Marks a KI as deleted via lifecycle tombstone without removing the document. */
export const softDeleteKi = async (
  esClient: ElasticsearchClient,
  options: SoftDeleteKiOptions
): Promise<{ id: string }> =>
  softDeleteKiWithRevisionOperations(options, createRevisionOperations(esClient, options.writer));

/** Restores a soft-deleted KI by setting lifecycle status back to active. */
export const restoreKi = async (
  esClient: ElasticsearchClient,
  options: RestoreKiOptions
): Promise<{ id: string }> =>
  restoreKiWithRevisionOperations(options, createRevisionOperations(esClient, options.writer));
