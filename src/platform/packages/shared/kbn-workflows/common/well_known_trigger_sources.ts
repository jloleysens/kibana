/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export {
  WORKFLOW_STEP_TRIGGER_SOURCE,
  AGENT_BUILDER_HOOK_TRIGGER_SOURCE,
  isWorkflowStepTriggered,
  getEventDrivenWorkflowTriggerEvidence,
  isWellKnownWorkflowTriggerSource,
  isEventDrivenWorkflowTriggerSource,
} from '@kbn/workflows-runtime';
export type {
  WellKnownWorkflowTriggerSource,
  EventDrivenWorkflowTriggerSourceInput,
} from '@kbn/workflows-runtime';
