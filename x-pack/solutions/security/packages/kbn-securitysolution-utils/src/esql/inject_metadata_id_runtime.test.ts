/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { injectMetadataId } from '@kbn/securitysolution-esql-runtime';
import { injectMetadataId as fromRoot } from '../..';
import { injectMetadataId as fromOriginal } from './inject_metadata_id';
it('preserves the exact original metadata-injector identity through both compatibility exports', () => {
  expect(fromRoot).toBe(injectMetadataId);
  expect(fromOriginal).toBe(injectMetadataId);
});
