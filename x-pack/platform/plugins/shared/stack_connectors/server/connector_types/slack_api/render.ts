/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { renderMustacheString } from '@kbn/actions-plugin/server/lib/mustache_renderer';
import type { SlackApiParams } from '@kbn/connector-schemas/slack_api';

export const renderParameterTemplates = (
  logger: Logger,
  params: SlackApiParams,
  variables: Record<string, unknown>
) => {
  if (params.subAction === 'postBlockkit') {
    return {
      subAction: params.subAction,
      subActionParams: {
        ...params.subActionParams,
        text: renderMustacheString(logger, params.subActionParams.text, variables, 'json'),
      },
    };
  }

  if (params.subAction === 'validChannelId') {
    return params;
  }

  const text = params.subActionParams !== null ? params.subActionParams.text : '';
  return {
    subAction: 'postMessage' as const,
    subActionParams: {
      ...params.subActionParams,
      text: renderMustacheString(logger, text, variables, 'slack'),
    },
  };
};
