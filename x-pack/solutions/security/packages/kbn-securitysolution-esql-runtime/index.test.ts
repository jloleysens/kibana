/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { buildSync, stop } from 'esbuild';
import { injectMetadataId } from '.';
afterAll(() => stop());
it('retains original metadata normalization through the runtime-only public root', () => {
  expect(injectMetadataId('FROM logs* | KEEP message')).toBe(
    'FROM logs* METADATA _id | KEEP message, _id'
  );
});
it('keeps authoring autocomplete, UI and aggregate lodash out of the complete public closure', () => {
  const result = buildSync({
    entryPoints: [require.resolve('.')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  for (const input of Object.keys(result.metafile.inputs))
    expect(input).not.toMatch(
      /(?:kbn-securitysolution-utils|kbn-esql-language|kbn-esql-utils|@elastic\/eui|react\/|@emotion\/|lodash\/(?:lodash|fp)\.js)/
    );
});
