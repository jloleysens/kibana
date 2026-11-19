/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { GetAlertEntitiesStep } from '../workflows/step_types/get_alert_entities_step/get_alert_entities_step_runtime';
import { BuildExceptionEntriesFilterStep } from '../workflows/step_types/build_exception_entries_filter_step/build_exception_entries_filter_step_runtime';
import { MatchAttackFingerprintsStep } from '../workflows/step_types/match_attack_fingerprints/match_attack_fingerprints_step_runtime';
import { toApiEntries } from '../workflows/utils/to_api_entries';
import { toApiEntries as compatibleToApiEntries } from '../workflows/utils/exception_item';

it.each([
  ['security.getAlertEntities', new GetAlertEntitiesStep()],
  ['security.buildExceptionEntriesFilter', new BuildExceptionEntriesFilterStep()],
  [
    'security.matchAttackFingerprints',
    new MatchAttackFingerprintsStep({ canCreate: async () => false }),
  ],
] as const)('%s refuses missing executor-local context', async (_type, step) => {
  await expect(step.run('run', {}, {})).rejects.toThrow('executor-local handler context');
});

it('preserves the original public exception mapper export after the runtime-only move', () => {
  expect(toApiEntries).toBe(compatibleToApiEntries);
  expect(toApiEntries([{ field: 'host.name', operator: 'is', value: 'host' }])).toEqual([
    { field: 'host.name', type: 'match', operator: 'included', value: 'host' },
  ]);
});
