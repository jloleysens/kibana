/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const DETECTION_ENGINE_URL = '/api/detection_engine' as const;
export const DETECTION_ENGINE_RULES_URL = `${DETECTION_ENGINE_URL}/rules` as const;
export const DETECTION_ENGINE_RULES_BULK_ACTION =
  `${DETECTION_ENGINE_RULES_URL}/_bulk_action` as const;
export const INTERNAL_DETECTION_ENGINE_URL = '/internal/detection_engine' as const;
export const DETECTION_ENGINE_ATTACKS_URL = `${DETECTION_ENGINE_URL}/attacks` as const;
export const DETECTION_ENGINE_ATTACKS_STATUS_URL =
  `${DETECTION_ENGINE_ATTACKS_URL}/status` as const;
export const DETECTION_ENGINE_ATTACKS_TAGS_URL = `${DETECTION_ENGINE_ATTACKS_URL}/tags` as const;
export const DETECTION_ENGINE_ATTACKS_ASSIGNEES_URL =
  `${DETECTION_ENGINE_ATTACKS_URL}/assignees` as const;
export const NOTE_URL = '/api/note' as const;
export const DETECTION_ENGINE_SIGNALS_URL = `${DETECTION_ENGINE_URL}/signals` as const;
export const DETECTION_ENGINE_SIGNALS_STATUS_URL =
  `${DETECTION_ENGINE_SIGNALS_URL}/status` as const;
export const DETECTION_ENGINE_ALERT_TAGS_URL = `${DETECTION_ENGINE_SIGNALS_URL}/tags` as const;
export const DETECTION_ENGINE_ALERT_ASSIGNEES_URL =
  `${DETECTION_ENGINE_SIGNALS_URL}/assignees` as const;
