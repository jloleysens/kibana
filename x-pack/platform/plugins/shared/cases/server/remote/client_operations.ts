/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { GetCasesClientFn } from '../client/types';
import { ActionSourceTypes, toActionSource } from '../../common/types/domain';
import type { CasesClientOperationsApi } from './client_operations_tokens';

const createCasesTransportError = (error: Error): Error => {
  const ErrorType =
    [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].find(
      (Constructor) => error instanceof Constructor
    ) ?? Error;
  const transportError =
    error instanceof AggregateError
      ? new AggregateError([], error.message)
      : new ErrorType(error.message);
  return Object.assign(transportError, { workflowCasesErrorName: error.name });
};

/** Binds enumerated Cases client operations to the original authenticated workflow client. */
@remotable()
export class CasesClientOperations implements CasesClientOperationsApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getCasesClient: GetCasesClientFn,
    private readonly isTemplatesEnabled: boolean,
    private readonly canAddAttachments: () => boolean
  ) {}

  async assertConditionalStep(
    scopeId: string,
    stepType: 'cases.addAttachments' | 'cases.setExtendedFields'
  ): Promise<void> {
    try {
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      this.scopes.get<KibanaRequest>(scopeId);
      const enabled =
        stepType === 'cases.addAttachments' ? this.canAddAttachments() : this.isTemplatesEnabled;
      if (!enabled) throw new Error(`${stepType} is not registered for this deployment`);
    } catch (error) {
      throw createCasesTransportError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async templatesEnabled(scopeId: string): Promise<boolean> {
    try {
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      this.scopes.get<KibanaRequest>(scopeId);
      return this.isTemplatesEnabled;
    } catch (error) {
      throw createCasesTransportError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async #call<T>(
    scopeId: string,
    operation: string,
    args: object,
    run: (client: Awaited<ReturnType<GetCasesClientFn>>) => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const state = this.scopes.getRunState(scopeId);
      const client = await this.getCasesClient(request, {
        actionSource: toActionSource({
          type: ActionSourceTypes.workflow,
          id: state.workflowId,
          name: state.workflowName,
          runId: state.workflowRunId,
        }),
      });
      signal.throwIfAborted();
      const result = await run(client);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createCasesTransportError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('cases_client_operation', {
        scopeId,
        stepType: operation,
        payloadBytes: Buffer.byteLength(JSON.stringify(args)),
        durationMs: performance.now() - start,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }

  caseGet(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseGet']>
  ): ReturnType<CasesClientOperationsApi['caseGet']> {
    return this.#call(scopeId, 'cases.get', args, (client) => client.cases.get(...args));
  }

  caseCreate(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseCreate']>
  ): ReturnType<CasesClientOperationsApi['caseCreate']> {
    return this.#call(scopeId, 'cases.create', args, (client) => client.cases.create(...args));
  }

  caseBulkGet(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseBulkGet']>
  ): ReturnType<CasesClientOperationsApi['caseBulkGet']> {
    return this.#call(scopeId, 'cases.bulkGet', args, (client) => client.cases.bulkGet(...args));
  }

  caseBulkUpdate(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseBulkUpdate']>
  ): ReturnType<CasesClientOperationsApi['caseBulkUpdate']> {
    return this.#call(scopeId, 'cases.bulkUpdate', args, (client) =>
      client.cases.bulkUpdate(...args)
    );
  }

  caseDelete(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseDelete']>
  ): ReturnType<CasesClientOperationsApi['caseDelete']> {
    return this.#call(scopeId, 'cases.delete', args, (client) => client.cases.delete(...args));
  }

  caseFind(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseFind']>
  ): ReturnType<CasesClientOperationsApi['caseFind']> {
    return this.#call(scopeId, 'cases.find', args, (client) => client.cases.find(...args));
  }

  caseSimilar(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseSimilar']>
  ): ReturnType<CasesClientOperationsApi['caseSimilar']> {
    return this.#call(scopeId, 'cases.similar', args, (client) => client.cases.similar(...args));
  }

  caseGetCasesByAlertID(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseGetCasesByAlertID']>
  ): ReturnType<CasesClientOperationsApi['caseGetCasesByAlertID']> {
    return this.#call(scopeId, 'cases.getCasesByAlertID', args, (client) =>
      client.cases.getCasesByAlertID(...args)
    );
  }

  caseBulkAddObservables(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseBulkAddObservables']>
  ): ReturnType<CasesClientOperationsApi['caseBulkAddObservables']> {
    return this.#call(scopeId, 'cases.bulkAddObservables', args, (client) =>
      client.cases.bulkAddObservables(...args)
    );
  }

  caseBulkDeleteObservables(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseBulkDeleteObservables']>
  ): ReturnType<CasesClientOperationsApi['caseBulkDeleteObservables']> {
    return this.#call(scopeId, 'cases.bulkDeleteObservables', args, (client) =>
      client.cases.bulkDeleteObservables(...args)
    );
  }

  caseDeleteObservable(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseDeleteObservable']>
  ): ReturnType<CasesClientOperationsApi['caseDeleteObservable']> {
    return this.#call(scopeId, 'cases.deleteObservable', args, (client) =>
      client.cases.deleteObservable(...args)
    );
  }

  caseUpdateObservable(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseUpdateObservable']>
  ): ReturnType<CasesClientOperationsApi['caseUpdateObservable']> {
    return this.#call(scopeId, 'cases.updateObservable', args, (client) =>
      client.cases.updateObservable(...args)
    );
  }

  caseReplaceCustomField(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['caseReplaceCustomField']>
  ): ReturnType<CasesClientOperationsApi['caseReplaceCustomField']> {
    return this.#call(scopeId, 'cases.replaceCustomField', args, (client) =>
      client.cases.replaceCustomField(...args)
    );
  }

  casePush(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['casePush']>
  ): ReturnType<CasesClientOperationsApi['casePush']> {
    return this.#call(scopeId, 'cases.push', args, (client) => client.cases.push(...args));
  }

  attachmentAdd(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['attachmentAdd']>
  ): ReturnType<CasesClientOperationsApi['attachmentAdd']> {
    return this.#call(scopeId, 'attachments.add', args, (client) =>
      client.attachments.add(...args)
    );
  }

  attachmentBulkCreate(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['attachmentBulkCreate']>
  ): ReturnType<CasesClientOperationsApi['attachmentBulkCreate']> {
    return this.#call(scopeId, 'attachments.bulkCreate', args, (client) =>
      client.attachments.bulkCreate(...args)
    );
  }

  attachmentBulkDelete(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['attachmentBulkDelete']>
  ): ReturnType<CasesClientOperationsApi['attachmentBulkDelete']> {
    return this.#call(scopeId, 'attachments.bulkDelete', args, (client) =>
      client.attachments.bulkDelete(...args)
    );
  }

  attachmentGetAll(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['attachmentGetAll']>
  ): ReturnType<CasesClientOperationsApi['attachmentGetAll']> {
    return this.#call(scopeId, 'attachments.getAll', args, (client) =>
      client.attachments.getAll(...args)
    );
  }

  configureGet(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['configureGet']>
  ): ReturnType<CasesClientOperationsApi['configureGet']> {
    return this.#call(scopeId, 'configure.get', args, (client) => client.configure.get(...args));
  }

  configureGetConnectors(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['configureGetConnectors']>
  ): ReturnType<CasesClientOperationsApi['configureGetConnectors']> {
    return this.#call(scopeId, 'configure.getConnectors', args, (client) =>
      client.configure.getConnectors(...args)
    );
  }

  templateGetTemplate(
    ...[scopeId, args]: Parameters<CasesClientOperationsApi['templateGetTemplate']>
  ): ReturnType<CasesClientOperationsApi['templateGetTemplate']> {
    return this.#call(scopeId, 'templates.getTemplate', args, (client) =>
      client.templates.getTemplate(...args)
    );
  }
}
