/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  ServerHandlerStepDefinition,
  ServerPollStepDefinition,
} from '@kbn/workflows-extensions/server';
import type { RunStepResult } from '../node_implementation';

export interface CustomStepDefinitionHandler {
  onCancel(input: unknown, rawInput: unknown, config: Record<string, unknown>): Promise<void>;
  run(input: unknown, rawInput: unknown, config: Record<string, unknown>): Promise<RunStepResult>;
}

interface RuntimeStepConfig {
  readonly configKeys?: readonly string[];
  readonly configSchema?: ServerHandlerStepDefinition['configSchema'];
}

export type RuntimeHandlerStepDefinition = Pick<
  ServerHandlerStepDefinition,
  'id' | 'handler' | 'onCancel'
> &
  RuntimeStepConfig;
export type RuntimePollStepDefinition = Pick<
  ServerPollStepDefinition,
  'id' | 'start' | 'poll' | 'policy' | 'ceilings' | 'onCancel'
> &
  RuntimeStepConfig;
export type RuntimeStepDefinition = RuntimeHandlerStepDefinition | RuntimePollStepDefinition;
