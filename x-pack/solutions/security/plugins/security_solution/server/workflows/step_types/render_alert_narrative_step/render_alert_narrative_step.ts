/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { renderAlertNarrativeStepCommonDefinition } from '../../../../common/workflows/step_types/render_alert_narrative_step/render_alert_narrative_step_common';
import { handleRenderAlertNarrativeStep } from './render_alert_narrative_step_runtime';

export const renderAlertNarrativeStepDefinition = createServerStepDefinition({
  ...renderAlertNarrativeStepCommonDefinition,
  handler: handleRenderAlertNarrativeStep,
});
