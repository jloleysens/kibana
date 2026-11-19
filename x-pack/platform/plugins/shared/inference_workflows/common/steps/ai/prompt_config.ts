/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * A connector field that renders to an empty or blank string (for example a templated value that
 * is not set on this path) counts as absent, so one step can list both connector fields.
 */
export const normalizeOptionalConnectorParam = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Validation message shown when `aggregate-by` is set without a `plugin-id`: the parent rollup id
 * only means something next to the attribution id it groups.
 */
export const AGGREGATE_BY_REQUIRES_PLUGIN_ID_MESSAGE =
  '`aggregate-by` can only be set when `plugin-id` is also set.';
