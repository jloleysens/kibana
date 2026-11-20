/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { resolve } from 'node:path';
import { build, stop } from 'esbuild';
import {
  conditionSchema,
  conditionSchemaStrict,
  isFilterCondition,
  isAndCondition,
  ALWAYS_CONDITION,
} from '.';

it('keeps the original recursive schema and type predicates', () => {
  const filter = { field: 'host.name', eq: 'worker-host' };
  const condition = { and: [filter, { not: ALWAYS_CONDITION }] };
  expect(conditionSchema.parse(condition)).toEqual(condition);
  expect(isFilterCondition(filter)).toBe(true);
  expect(isAndCondition(condition)).toBe(true);
  expect(
    conditionSchemaStrict.safeParse({ field: 'host.name', unsupported: 'operator' }).success
  ).toBe(false);
});

it('has no backedge to Streamlang authoring, UI converters or UI libraries', async () => {
  const bundle = await build({
    entryPoints: [resolve(__dirname, 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    Object.keys(bundle.metafile.inputs).filter((path) =>
      /kbn-streamlang\/|convert_for_ui|node_modules\/(?:@elastic\/eui|react(?:-dom)?|@emotion)\//.test(
        path
      )
    )
  ).toEqual([]);
});

afterAll(() => stop());
