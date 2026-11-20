/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { KiOperationsToken, type KiOperationsApi } from './ki_tokens';
import { KiStep } from './ki_step';

export class UpdateKiStep extends KiStep {
  constructor(@inject(KiOperationsToken) api: KiOperationsApi) {
    super(api, 'update');
  }
}
