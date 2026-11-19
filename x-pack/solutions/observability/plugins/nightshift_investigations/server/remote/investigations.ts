/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { GetInvestigationsClient } from '../routes/types';
import type { InvestigationLocator } from '../../common/locators';
import type { InvestigationsApi, InvestigationRenderingInput } from './investigations_tokens';
import { createInvestigationTransportError } from './investigation_errors';

/** Original request-scoped investigation operations; no worker-selected run or Space. */
@remotable()
export class Investigations implements InvestigationsApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getClient: GetInvestigationsClient,
    private readonly locator: Pick<InvestigationLocator, 'getRedirectUrl'>
  ) {}

  async getRenderingInput(
    scopeId: string,
    investigationId: string
  ): Promise<InvestigationRenderingInput> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { spaceId } = this.scopes.getRunState(scopeId);
      const investigation = await this.getClient(request, spaceId).getNotifiableInvestigation(
        investigationId
      );
      signal.throwIfAborted();
      return {
        investigation,
        redirectUrl: this.locator.getRedirectUrl({ investigationId }, { spaceId }),
      };
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_rendering_input', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify({ investigationId })),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }

  async followUpRecoveredAlert(
    scopeId: string,
    input: Parameters<InvestigationsApi['followUpRecoveredAlert']>[1]
  ): ReturnType<InvestigationsApi['followUpRecoveredAlert']> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { spaceId } = this.scopes.getRunState(scopeId);
      // Copy only the original resource input; extra worker-authored provenance is never passed.
      const {
        alertUuid,
        alertId,
        alertStart,
        recoveredAt,
        ruleId,
        ruleName,
        ruleTypeId,
        ruleTags,
      } = input;
      const result = await this.getClient(request, spaceId).followUpRecoveredAlert({
        alertUuid,
        alertId,
        alertStart,
        recoveredAt,
        ruleId,
        ruleName,
        ruleTypeId,
        ruleTags,
      });
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_recovered_alert', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify(input)),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}
