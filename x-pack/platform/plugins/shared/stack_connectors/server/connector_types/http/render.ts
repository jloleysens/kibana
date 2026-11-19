/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { renderMustacheString } from '@kbn/actions-plugin/server/lib/mustache_renderer';
import type { ActionParamsType } from '@kbn/connector-schemas/http';
import type { QueryParamValue } from '@kbn/connector-schemas/http/schemas/v1';
import type { HttpFormDataField } from '@kbn/connector-schemas/http/types/v1';

export function renderParameterTemplates(
  logger: Logger,
  params: ActionParamsType,
  variables: Record<string, unknown>
): ActionParamsType {
  const renderedParams: ActionParamsType = { ...params };

  if (typeof params.body === 'string') {
    renderedParams.body = renderMustacheString(logger, params.body, variables, 'json');
  }

  if (params.form_data) {
    const renderedFormData: HttpFormDataField = {};
    for (const [key, entry] of Object.entries(params.form_data)) {
      renderedFormData[key] = {
        content: renderMustacheString(logger, entry.content, variables, 'json'),
        filename: renderMustacheString(logger, entry.filename, variables, 'json'),
        content_type: renderMustacheString(logger, entry.content_type, variables, 'json'),
      };
    }
    renderedParams.form_data = renderedFormData;
  }

  if (params.url) {
    renderedParams.url = renderMustacheString(logger, params.url, variables, 'json');
  }

  if (params.path) {
    renderedParams.path = renderMustacheString(logger, params.path, variables, 'json');
  }

  if (params.query) {
    const renderedQuery: Record<string, QueryParamValue> = {};
    for (const [key, value] of Object.entries(params.query)) {
      if (Array.isArray(value)) {
        renderedQuery[key] = value.map((v) =>
          typeof v === 'string' ? renderMustacheString(logger, v, variables, 'json') : v
        );
      } else if (typeof value === 'string') {
        renderedQuery[key] = renderMustacheString(logger, value, variables, 'json');
      } else {
        renderedQuery[key] = value;
      }
    }
    renderedParams.query = renderedQuery;
  }

  if (params.headers) {
    const renderedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(params.headers)) {
      renderedHeaders[key] = renderMustacheString(logger, value, variables, 'json');
    }
    renderedParams.headers = renderedHeaders;
  }

  return renderedParams;
}
