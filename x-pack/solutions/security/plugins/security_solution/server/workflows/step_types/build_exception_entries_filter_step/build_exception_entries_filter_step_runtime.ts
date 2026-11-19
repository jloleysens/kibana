/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { ExecutionError } from '@kbn/workflows-runtime';
import type { estypes } from '@elastic/elasticsearch';
import type { EntriesArray } from '@kbn/securitysolution-io-ts-list-types';
import {
  buildExistsClause,
  buildMatchAnyClause,
  buildMatchClause,
  buildMatchWildcardClause,
} from '@kbn/lists-plugin/server/services/exception_lists/exception_clause_builders';
import { buildExceptionEntriesFilterStepCommonDefinition } from '../../../../common/workflows/step_types/build_exception_entries_filter_step/build_exception_entries_filter_step_common';
import { toApiEntries } from '../../utils/to_api_entries';

// Dispatches each API entry to the same clause builder the detection engine's own
// exception evaluation uses, so the backtested filter matches exactly what the
// created exception would suppress.
const buildClause = (entry: EntriesArray[number]): estypes.QueryDslQueryContainer => {
  switch (entry.type) {
    case 'match':
      return buildMatchClause(entry);
    case 'match_any':
      return buildMatchAnyClause(entry);
    case 'wildcard':
      return buildMatchWildcardClause(entry);
    case 'exists':
      return buildExistsClause(entry);
    default:
      throw new ExecutionError({
        type: 'ValidationError',
        message: `Unsupported exception entry type "${entry.type}" for filter building`,
      });
  }
};

export const handleBuildExceptionEntriesFilterStep: StepHandler<
  typeof buildExceptionEntriesFilterStepCommonDefinition.inputSchema,
  typeof buildExceptionEntriesFilterStepCommonDefinition.outputSchema
> = async (context) => {
  // The engine renders `context.input` from the `with` block without running
  // inputSchema.parse(), so parse here: it applies defaults, rejects unknown
  // operators and empty `entries` (which would otherwise build a filter that
  // excludes every document), and narrows the entry types for toApiEntries.
  const parsed = buildExceptionEntriesFilterStepCommonDefinition.inputSchema.safeParse(
    context.input
  );
  if (!parsed.success) {
    throw new ExecutionError({ type: 'ValidationError', message: parsed.error.message });
  }
  const { entries, existing_filters: existingFilters } = parsed.data;

  const clauses = toApiEntries(entries).map(buildClause);

  // bool.filter ANDs its clauses, matching how one exception item's entries all must
  // match for the exception to apply; the outer must_not excludes alerts that would
  // match, i.e. what the rule would produce with the exception in place.
  const negatedFilter = { bool: { must_not: { bool: { filter: clauses } } } };

  return { output: { filters: [...existingFilters, negatedFilter] } };
};

@remotable()
export class BuildExceptionEntriesFilterStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error(
        'security.buildExceptionEntriesFilter requires executor-local handler context'
      );
    const handler = handleBuildExceptionEntriesFilterStep;
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}
