/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
import {
  NightshiftModelBlockedError,
  NightshiftModelNotFoundError,
} from '@kbn/significant-events-runtime';
import {
  NightshiftModelBlockedError as rootBlocked,
  NightshiftModelNotFoundError as rootNotFound,
} from '..';
import { NightshiftModelBlockedError as internalBlocked } from './nightshift_model_blocked_error';
import { NightshiftModelNotFoundError as internalNotFound } from './nightshift_model_not_found_error';

it('preserves original model error constructors through the schema root and internal exports', () => {
  expect(rootBlocked).toBe(NightshiftModelBlockedError);
  expect(internalBlocked).toBe(rootBlocked);
  expect(rootNotFound).toBe(NightshiftModelNotFoundError);
  expect(internalNotFound).toBe(rootNotFound);
  expect(new rootBlocked('model', 'default')).toBeInstanceOf(internalBlocked);
  expect(new rootNotFound('model')).toBeInstanceOf(internalNotFound);
});
it('keeps the complete runtime public root dependency-free with only its own scalar and error inputs', () => {
  const directory = resolve(__dirname, '../../kbn-significant-events-runtime');
  const result = buildSync({
    entryPoints: [resolve(directory, 'index.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs).map((path) => resolve(path));
  expect(inputs.sort()).toEqual(
    ['index.ts', 'nightshift_model_blocked_error.ts', 'nightshift_model_not_found_error.ts']
      .map((path) => resolve(directory, path))
      .sort()
  );
  expect(result.outputFiles[0].contents.length).toBeLessThan(8000);
});
