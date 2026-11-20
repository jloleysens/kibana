/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { remotable } from '@kbn/core-remote-common';
import type { dataStringifyJsonStepCommonDefinition } from '../../../common/steps/data';
import type { RemoteWorkflowStep } from '../../remote/tokens';
import type { StepHandler } from '../../step_registry/types';

export const handleDataStringifyJsonStep: StepHandler<
  typeof dataStringifyJsonStepCommonDefinition.inputSchema,
  typeof dataStringifyJsonStepCommonDefinition.outputSchema,
  NonNullable<typeof dataStringifyJsonStepCommonDefinition.configSchema>
> = async (context) => {
  try {
    const source = context.config.source;
    const { pretty = false } = context.input;

    const jsonString = pretty ? JSON.stringify(source, null, 2) : JSON.stringify(source);

    if (jsonString === undefined) {
      return { error: new Error('Source cannot be serialized to JSON (e.g., functions)') };
    }

    return { output: jsonString };
  } catch (error) {
    if (error instanceof TypeError) {
      const isCircular = error.message.toLowerCase().includes('circular');
      const hint = isCircular ? ' (circular reference)' : '';
      return {
        error: new Error(`Cannot stringify source: ${error.message}${hint}`),
      };
    }
    return {
      error: new Error(error instanceof Error ? error.message : 'Failed to stringify to JSON'),
    };
  }
};

/** Executor-only contribution; authoring schemas never enter this implementation module. */
@remotable()
export class DataStringifyJsonStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('data.stringifyJson requires executor-local handler context');
    return handleDataStringifyJsonStep(
      handlerContext as Parameters<typeof handleDataStringifyJsonStep>[0]
    );
  }
}
