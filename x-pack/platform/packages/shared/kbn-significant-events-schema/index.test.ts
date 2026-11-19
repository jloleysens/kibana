/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { resolve } from 'node:path';
import { build, stop } from 'esbuild';
import { ALWAYS_CONDITION, conditionSchema } from '@kbn/streamlang-conditions';
import { baseFeatureSchema, featureSchema, MAX_TEXT_LENGTH } from '.';
import { baseFeatureSchema as originalBaseFeatureSchema } from './src/feature';
import { MAX_TEXT_LENGTH as originalMaxTextLength } from './src/significant_events/constants';

it('preserves the public constants and feature schema identities', () => {
  expect(MAX_TEXT_LENGTH).toBe(originalMaxTextLength);
  expect(MAX_TEXT_LENGTH).toBe(10_000);
  expect(baseFeatureSchema).toBe(originalBaseFeatureSchema);
  expect(baseFeatureSchema.shape.filter.unwrap()).toBe(conditionSchema);
  const feature = {
    id: 'host',
    uuid: 'host-uuid',
    source_id: 'source',
    type: 'infrastructure',
    description: 'A host',
    properties: {},
    confidence: 90,
    filter: { and: [{ field: 'host.name', eq: 'worker-host' }, { not: ALWAYS_CONDITION }] },
  };
  expect(featureSchema.parse(feature)).toEqual(feature);
  expect(featureSchema.safeParse({ ...feature, filter: { unsupported: true } }).success).toBe(
    false
  );
  expect(
    featureSchema.safeParse({ ...feature, description: 'x'.repeat(MAX_TEXT_LENGTH + 1) }).success
  ).toBe(false);
});

it('keeps the entire public barrel server-safe without Streamlang authoring or aggregate lodash', async () => {
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
      /kbn-streamlang\/|convert_for_ui|node_modules\/(?:@elastic\/eui|react(?:-dom)?|@emotion)\/|node_modules\/lodash\/(?:lodash|index)\.js$/.test(
        path
      )
    )
  ).toEqual([]);
});

afterAll(() => stop());
