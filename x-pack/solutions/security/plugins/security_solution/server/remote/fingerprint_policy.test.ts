/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FingerprintPolicy } from './fingerprint_policy';
import { setFingerprintCreateAllowed } from '../workflows/step_types/match_attack_fingerprints/match_attack_fingerprints';

it('reads the original live template guard on every scoped call and refuses closed/foreign scopes', async () => {
  const controller = new AbortController();
  const policy = new FingerprintPolicy({
    get: jest.fn().mockImplementation((scope: string) => {
      if (scope !== 'run') throw new Error('Foreign scope');
      return {};
    }),
    getAbortSignal: () => controller.signal,
    getRunState: () => {
      throw new Error('not used in this test');
    },
    getRunDefinitionFacts: () => {
      throw new Error('not used in this test');
    },
    resolveStepType: () => {
      throw new Error('not used in this test');
    },
    resolveStepOutputLimit: () => {
      throw new Error('not used in this test');
    },
    admitChild: () => {
      throw new Error('not used in this test');
    },
  });
  try {
    let installed = false;
    setFingerprintCreateAllowed(() => installed);
    await expect(policy.canCreate('run')).resolves.toBe(false);
    installed = true;
    await expect(policy.canCreate('run')).resolves.toBe(true);
    await expect(policy.canCreate('foreign')).rejects.toThrow('Foreign scope');
    controller.abort();
    await expect(policy.canCreate('run')).rejects.toThrow();
  } finally {
    setFingerprintCreateAllowed(true);
  }
});
