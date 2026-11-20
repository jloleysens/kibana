/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ExecutionError } from '@kbn/workflows-runtime';
import { CONTEXT_ENGINE_ENABLED_SETTING_ID } from '@kbn/management-settings-ids';

/** Fails the step when the Context Engine setting is off in this space. */
export const assertContextEngineEnabled = async (
  isContextEngineEnabled: (spaceId: string) => Promise<boolean>,
  spaceId: string
): Promise<void> => {
  if (!(await isContextEngineEnabled(spaceId))) {
    throw new ExecutionError({
      type: 'FeatureDisabledError',
      message: `Context Engine is disabled. Enable the '${CONTEXT_ENGINE_ENABLED_SETTING_ID}' advanced setting to use this step.`,
    });
  }
};

/** Fails the step when the feedback loop advanced setting is off. */
export const assertFeedbackLoopEnabled = async (
  isFeedbackLoopEnabled: () => Promise<boolean>
): Promise<void> => {
  if (!(await isFeedbackLoopEnabled())) {
    throw new ExecutionError({
      type: 'FeatureDisabledError',
      message:
        'The Context Engine feedback loop is disabled. Enable it in advanced settings to use this step.',
    });
  }
};
