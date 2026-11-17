/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { WorkflowStep, WorkflowStepCatalogToken } from './tokens';

export { WorkflowStep, WorkflowStepCatalogToken } from './tokens';
export type { RemoteStepContext, RemoteWorkflowStep, WorkflowStepCatalogApi } from './tokens';

export const remoteModule: RemoteModule = {
  contributions: [
    {
      kind: WorkflowStep,
      stepType: 'data.aggregate',
      modulePath: require.resolve('../steps/data/data_aggregate_runtime'),
      exportName: 'DataAggregateStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.concat',
      modulePath: require.resolve('../steps/data/data_concat_runtime'),
      exportName: 'DataConcatStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.dedupe',
      modulePath: require.resolve('../steps/data/data_dedupe_runtime'),
      exportName: 'DataDedupeStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.filter',
      modulePath: require.resolve('../steps/data/data_filter_runtime'),
      exportName: 'DataFilterStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.find',
      modulePath: require.resolve('../steps/data/data_find_runtime'),
      exportName: 'DataFindStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.map',
      modulePath: require.resolve('../steps/data/data_map_runtime'),
      exportName: 'DataMapStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.parseJson',
      modulePath: require.resolve('../steps/data/data_parse_json_runtime'),
      exportName: 'DataParseJsonStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.regexExtract',
      modulePath: require.resolve('../steps/data/data_regex_extract_runtime'),
      exportName: 'DataRegexExtractStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.regexReplace',
      modulePath: require.resolve('../steps/data/data_regex_replace_runtime'),
      exportName: 'DataRegexReplaceStep',
    },
    {
      kind: WorkflowStep,
      stepType: 'data.stringifyJson',
      modulePath: require.resolve('../steps/data/data_stringify_json_runtime'),
      exportName: 'DataStringifyJsonStep',
    },
  ],
  providers: [
    {
      token: WorkflowStepCatalogToken,
      placement: 'executor',
      role: 'catalog',
      modulePath: require.resolve('./step_catalog'),
      exportName: 'WorkflowStepCatalog',
    },
  ],
};
