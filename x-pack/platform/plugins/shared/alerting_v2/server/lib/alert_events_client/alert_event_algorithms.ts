/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { CreateAlertEventData, CreateAlertEventResponse } from '@kbn/alerting-v2-schemas';
import type { AlertEventDocument } from '../../resources/datastreams/alert_events';
import {
  alertEpisodeStatus,
  alertEventStatus,
  alertEventType,
} from '../../resources/datastreams/alert_event_kinds';

export interface AlertEpisodeRow {
  last_episode_id: string;
  last_episode_status: string;
}
export interface AlertEventOperations {
  readLatest(groupHash: string, abortSignal?: AbortSignal): Promise<AlertEpisodeRow[]>;
  persist(doc: AlertEventDocument): Promise<void>;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** Path format: dotted keys, e.g. `monitor_id`, `labels.env`. */
export function getValueByDottedPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Computes `group_hash` in priority order:
 *   1. Explicit `fingerprint`
 *   2. `fingerprint_fields` — keys/paths resolved only under `data` (missing → "")
 *   3. `rule_id` (schema guarantees one of the three)
 *
 * Always includes `spaceId` and `source` so series keys cannot collide across spaces or sources.
 */
export function getGroupHash(event: CreateAlertEventData, spaceId: string): string {
  const { source } = event;

  if (event.fingerprint) {
    return sha256(`${spaceId}:${source}:${event.fingerprint}`);
  }

  if (event.fingerprint_fields?.length) {
    const data = event.data ?? {};
    // Encode as [[field, value], ...] pairs so field names or values containing
    // the delimiter character cannot produce hash collisions across different inputs.
    const pairs = event.fingerprint_fields.map((field) => {
      const value = getValueByDottedPath(data, field);
      return [field, value == null ? '' : String(value)];
    });
    return sha256(`${spaceId}:${source}:${JSON.stringify(pairs)}`);
  }

  // Schema requires fingerprint, fingerprint_fields, or rule_id.
  return sha256(`${spaceId}:${source}:${event.rule_id}`);
}

export const createAlertEvent = async (
  event: CreateAlertEventData,
  spaceId: string,
  operations: AlertEventOperations,
  { abortSignal }: { abortSignal?: AbortSignal } = {}
): Promise<CreateAlertEventResponse> => {
  const { source } = event;
  const groupHash = getGroupHash(event, spaceId);

  const episodeStatus = event.alert_status ?? alertEpisodeStatus.active;
  const episodeId = await resolveEpisodeId(
    await operations.readLatest(groupHash, abortSignal),
    episodeStatus
  );

  const status =
    episodeStatus === alertEpisodeStatus.inactive || episodeStatus === alertEpisodeStatus.recovering
      ? alertEventStatus.recovered
      : alertEventStatus.breached;

  const statusCount =
    episodeStatus === alertEpisodeStatus.pending || episodeStatus === alertEpisodeStatus.recovering
      ? 1
      : undefined;

  // No `rule` object — no backing rule saved object. A caller-supplied timestamp is
  // honored as `@timestamp`; otherwise ES sets it at ingest.
  const doc: AlertEventDocument = {
    ...(event.timestamp != null ? { '@timestamp': event.timestamp } : {}),
    scheduled_timestamp: event.timestamp ?? new Date().toISOString(),
    group_hash: groupHash,
    data: event.data ?? {},
    status,
    source,
    type: alertEventType.alert,
    alert: {
      id: episodeId,
      status: episodeStatus,
      ...(statusCount != null ? { status_count: statusCount } : {}),
    },
    space_id: spaceId,
    ...(event.severity != null ? { severity: event.severity } : {}),
  };

  await operations.persist(doc);

  return {
    group_hash: groupHash,
    alert_id: episodeId,
  };
};

const resolveEpisodeId = (rows: AlertEpisodeRow[], nextStatus: string): string => {
  if (rows.length === 0 || !rows[0].last_episode_id) {
    return uuidv4();
  }

  const { last_episode_id: lastEpisodeId, last_episode_status: lastEpisodeStatus } = rows[0];

  const isNewLifecycle =
    lastEpisodeStatus === alertEpisodeStatus.inactive && nextStatus !== alertEpisodeStatus.inactive;

  return isNewLifecycle ? uuidv4() : lastEpisodeId;
};
