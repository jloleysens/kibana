/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { renderMustacheObject } from '@kbn/actions-plugin/server/lib/mustache_renderer';
import type { ActionParamsType } from '@kbn/connector-schemas/torq';

export function renderParameterTemplates(
  logger: Logger,
  params: ActionParamsType,
  variables: Record<string, unknown>
): ActionParamsType {
  if (!params.body) return params;
  return renderMustacheObject(logger, params, variables);
}
