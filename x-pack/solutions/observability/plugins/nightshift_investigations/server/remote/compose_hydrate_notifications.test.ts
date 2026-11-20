/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { composeHydrateNotificationsStepDefinition } from '../step_definitions/compose_hydrate_notifications';
import { composeHydrateNotificationsHandler } from './compose_hydrate_notifications';
import { ComposeHydrateNotificationsStep } from './compose_hydrate_notifications_step';

it('shares the original handler with the authoring definition, without a coordinator business service', () => {
  expect(composeHydrateNotificationsStepDefinition().handler).toBe(
    composeHydrateNotificationsHandler
  );
});

it('requires an executor-local handler context', async () => {
  await expect(new ComposeHydrateNotificationsStep().run('scope', {}, {})).rejects.toThrow(
    'context'
  );
});
