/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import type { NativeActionsApi } from './types';
export const NativeActionsToken = createToken<NativeActionsApi>('actions.native');
export const SpecRuntimeToken = createToken<
  SpecRuntimeApi &
    Pick<import('./spec_runtime_impl').SpecRuntime, 'runLegacy' | 'runLocal' | 'runClassic'>
>('actions.specRuntime');

export const WorkflowConnectorKind = createToken<unknown>('workflows.connector');
