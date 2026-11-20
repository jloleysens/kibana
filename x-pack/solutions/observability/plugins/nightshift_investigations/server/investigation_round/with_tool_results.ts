/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InvestigationToolCall } from '../decision_trees/accessed_trees';

export const withToolResults = (
  toolCalls: readonly InvestigationToolCall[],
  toolResults: ReadonlyArray<{ tool_call_id: string; results: unknown[] }>
): InvestigationToolCall[] => {
  if (toolResults.length === 0) {
    return [...toolCalls];
  }
  const resultsById = new Map(
    toolResults.map(({ tool_call_id: toolCallId, results }) => [toolCallId, results])
  );
  return toolCalls.map((call) => {
    const results = call.tool_call_id ? resultsById.get(call.tool_call_id) : undefined;
    return results ? { ...call, results } : call;
  });
};
