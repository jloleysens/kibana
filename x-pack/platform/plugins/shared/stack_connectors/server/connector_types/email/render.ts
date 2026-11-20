/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ActionParamsType } from '@kbn/connector-schemas/email';
import {
  renderMustacheObject,
  renderMustacheString,
} from '@kbn/actions-plugin/server/lib/mustache_renderer';

export function renderParameterTemplates(
  logger: Logger,
  params: ActionParamsType,
  variables: Record<string, unknown>
): ActionParamsType {
  return {
    // most of the params need no escaping
    ...renderMustacheObject(logger, params, variables),
    // message however, needs to escaped as markdown
    message: renderMustacheString(logger, params.message, variables, 'markdown'),
    messageHTML: renderMustacheString(logger, params.messageHTML, variables, 'html'),
  };
}
