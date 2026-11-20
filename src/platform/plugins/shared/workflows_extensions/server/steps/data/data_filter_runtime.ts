/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { remotable } from '@kbn/core-remote-common';

import { decodeKqlTemplateValues, evaluateKql } from '@kbn/eval-kql';
import { parseKqlCondition, renderKqlCondition } from './kql_utils';
import type { dataFilterStepCommonDefinition } from '../../../common/steps/data';
import type { RemoteWorkflowStep } from '../../remote/tokens';
import type { StepHandler } from '../../step_registry/types';

export const handleDataFilterStep: StepHandler<
  typeof dataFilterStepCommonDefinition.inputSchema,
  typeof dataFilterStepCommonDefinition.outputSchema,
  NonNullable<typeof dataFilterStepCommonDefinition.configSchema>
> = async (context) => {
  try {
    const items = context.config.items;
    const { limit } = context.input;
    const condition = renderKqlCondition(context.contextManager, context.rawInput.condition);

    if (!Array.isArray(items)) {
      context.logger.error(`Input items has invalid type: ${typeof items}`);
      return {
        error: new Error(
          `Expected items to be an array, but received ${typeof items}. Please provide an array to filter.`
        ),
      };
    }

    if (!condition || condition.trim() === '') {
      context.logger.debug('No condition provided, returning all items');
      return { output: items };
    }

    context.logger.debug(
      `Filtering ${items.length} item(s) with condition: ${decodeKqlTemplateValues(condition)}${
        limit ? ` (limit: ${limit})` : ''
      }`
    );

    const kqlAst = parseKqlCondition(condition);
    const filteredItems: unknown[] = [];
    let matchedCount = 0;

    for (let index = 0; index < items.length; index++) {
      const item = items[index];

      if (context.abortSignal?.aborted) {
        context.logger.warn('Filter operation aborted by signal');
        return { error: new Error('Operation was aborted') };
      }

      if (item === null || typeof item !== 'object') {
        // A non-object item (e.g. `null` or a scalar) cannot satisfy an
        // `item.<field>` condition. KQL now evaluates such a path to a
        // non-match rather than throwing, so warn explicitly here to
        // preserve the visibility operators expect when a malformed item is
        // skipped.
        context.logger.warn(
          `Skipping non-object item at index ${index} (received ${
            item === null ? 'null' : typeof item
          })`
        );
      } else {
        try {
          const matches = evaluateKql(kqlAst, { item, index });

          if (matches) {
            filteredItems.push(item);
            matchedCount++;

            if (limit && matchedCount >= limit) {
              context.logger.debug(`Reached limit of ${limit} matches, stopping filter`);
              break;
            }
          }
        } catch (error) {
          context.logger.warn(`Failed to evaluate condition for item at index ${index}`, error);
        }
      }
    }

    context.logger.debug(`Filtered ${matchedCount} item(s) from ${items.length} total`);

    return { output: filteredItems };
  } catch (error) {
    context.logger.error('Failed to filter items', error);
    return {
      error: new Error(error instanceof Error ? error.message : 'Failed to filter items'),
    };
  }
};

/** Executor-only contribution; authoring schemas never enter this implementation module. */
@remotable()
export class DataFilterStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext) throw new Error('data.filter requires executor-local handler context');
    return handleDataFilterStep(handlerContext as Parameters<typeof handleDataFilterStep>[0]);
  }
}
