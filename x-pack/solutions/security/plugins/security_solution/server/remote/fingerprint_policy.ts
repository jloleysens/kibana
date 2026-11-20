/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { isFingerprintCreateAllowed } from '../workflows/step_types/match_attack_fingerprints/match_attack_fingerprints';
import type { FingerprintPolicyApi } from './tokens';

/** Reads AlertZero's live template-installation guard without exporting or replacing its registry. */
@remotable()
export class FingerprintPolicy implements FingerprintPolicyApi {
  constructor(private readonly scopes: ScopeLookup) {}
  async canCreate(scopeId: string): Promise<boolean> {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.get<KibanaRequest>(scopeId);
    return isFingerprintCreateAllowed();
  }
}
