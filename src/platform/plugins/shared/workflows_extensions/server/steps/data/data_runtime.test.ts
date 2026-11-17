/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { DataAggregateStep } from './data_aggregate_runtime';
import { DataConcatStep } from './data_concat_runtime';
import { DataDedupeStep } from './data_dedupe_runtime';
import { DataFilterStep } from './data_filter_runtime';
import { DataFindStep } from './data_find_runtime';
import { DataMapStep } from './data_map_runtime';
import { DataParseJsonStep } from './data_parse_json_runtime';
import { DataRegexExtractStep } from './data_regex_extract_runtime';
import { DataRegexReplaceStep } from './data_regex_replace_runtime';
import { DataStringifyJsonStep } from './data_stringify_json_runtime';

it.each([
  ['data.aggregate', new DataAggregateStep()],
  ['data.concat', new DataConcatStep()],
  ['data.dedupe', new DataDedupeStep()],
  ['data.filter', new DataFilterStep()],
  ['data.find', new DataFindStep()],
  ['data.map', new DataMapStep()],
  ['data.parseJson', new DataParseJsonStep()],
  ['data.regexExtract', new DataRegexExtractStep()],
  ['data.regexReplace', new DataRegexReplaceStep()],
  ['data.stringifyJson', new DataStringifyJsonStep()],
])('%s requires a local context, not a serialized snapshot', async (_type, step) => {
  await expect(step.run('scope-1', {}, {})).rejects.toThrow(
    'requires executor-local handler context'
  );
});
