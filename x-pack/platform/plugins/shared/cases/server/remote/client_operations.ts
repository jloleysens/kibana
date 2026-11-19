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
import type { ActionSource } from '../../common/types/domain';
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
    source: ActionSource | undefined,
    run: (client: Awaited<ReturnType<GetCasesClientFn>>) => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const client = await this.getCasesClient(
        request,
        source ? { actionSource: source } : undefined
      );
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
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseGet']>
  ): ReturnType<CasesClientOperationsApi['caseGet']> {
    return this.#call(scopeId, 'cases.get', args, source, (client) => client.cases.get(...args));
  }

  caseCreate(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseCreate']>
  ): ReturnType<CasesClientOperationsApi['caseCreate']> {
    return this.#call(scopeId, 'cases.create', args, source, (client) =>
      client.cases.create(...args)
    );
  }

  caseBulkGet(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseBulkGet']>
  ): ReturnType<CasesClientOperationsApi['caseBulkGet']> {
    return this.#call(scopeId, 'cases.bulkGet', args, source, (client) =>
      client.cases.bulkGet(...args)
    );
  }

  caseBulkUpdate(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseBulkUpdate']>
  ): ReturnType<CasesClientOperationsApi['caseBulkUpdate']> {
    return this.#call(scopeId, 'cases.bulkUpdate', args, source, (client) =>
      client.cases.bulkUpdate(...args)
    );
  }

  caseDelete(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseDelete']>
  ): ReturnType<CasesClientOperationsApi['caseDelete']> {
    return this.#call(scopeId, 'cases.delete', args, source, (client) =>
      client.cases.delete(...args)
    );
  }

  caseFind(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseFind']>
  ): ReturnType<CasesClientOperationsApi['caseFind']> {
    return this.#call(scopeId, 'cases.find', args, source, (client) => client.cases.find(...args));
  }

  caseSimilar(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseSimilar']>
  ): ReturnType<CasesClientOperationsApi['caseSimilar']> {
    return this.#call(scopeId, 'cases.similar', args, source, (client) =>
      client.cases.similar(...args)
    );
  }

  caseGetCasesByAlertID(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseGetCasesByAlertID']>
  ): ReturnType<CasesClientOperationsApi['caseGetCasesByAlertID']> {
    return this.#call(scopeId, 'cases.getCasesByAlertID', args, source, (client) =>
      client.cases.getCasesByAlertID(...args)
    );
  }

  caseBulkAddObservables(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseBulkAddObservables']>
  ): ReturnType<CasesClientOperationsApi['caseBulkAddObservables']> {
    return this.#call(scopeId, 'cases.bulkAddObservables', args, source, (client) =>
      client.cases.bulkAddObservables(...args)
    );
  }

  caseBulkDeleteObservables(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseBulkDeleteObservables']>
  ): ReturnType<CasesClientOperationsApi['caseBulkDeleteObservables']> {
    return this.#call(scopeId, 'cases.bulkDeleteObservables', args, source, (client) =>
      client.cases.bulkDeleteObservables(...args)
    );
  }

  caseDeleteObservable(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseDeleteObservable']>
  ): ReturnType<CasesClientOperationsApi['caseDeleteObservable']> {
    return this.#call(scopeId, 'cases.deleteObservable', args, source, (client) =>
      client.cases.deleteObservable(...args)
    );
  }

  caseUpdateObservable(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseUpdateObservable']>
  ): ReturnType<CasesClientOperationsApi['caseUpdateObservable']> {
    return this.#call(scopeId, 'cases.updateObservable', args, source, (client) =>
      client.cases.updateObservable(...args)
    );
  }

  caseReplaceCustomField(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['caseReplaceCustomField']>
  ): ReturnType<CasesClientOperationsApi['caseReplaceCustomField']> {
    return this.#call(scopeId, 'cases.replaceCustomField', args, source, (client) =>
      client.cases.replaceCustomField(...args)
    );
  }

  casePush(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['casePush']>
  ): ReturnType<CasesClientOperationsApi['casePush']> {
    return this.#call(scopeId, 'cases.push', args, source, (client) => client.cases.push(...args));
  }

  attachmentAdd(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['attachmentAdd']>
  ): ReturnType<CasesClientOperationsApi['attachmentAdd']> {
    return this.#call(scopeId, 'attachments.add', args, source, (client) =>
      client.attachments.add(...args)
    );
  }

  attachmentBulkCreate(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['attachmentBulkCreate']>
  ): ReturnType<CasesClientOperationsApi['attachmentBulkCreate']> {
    return this.#call(scopeId, 'attachments.bulkCreate', args, source, (client) =>
      client.attachments.bulkCreate(...args)
    );
  }

  attachmentBulkDelete(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['attachmentBulkDelete']>
  ): ReturnType<CasesClientOperationsApi['attachmentBulkDelete']> {
    return this.#call(scopeId, 'attachments.bulkDelete', args, source, (client) =>
      client.attachments.bulkDelete(...args)
    );
  }

  attachmentGetAll(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['attachmentGetAll']>
  ): ReturnType<CasesClientOperationsApi['attachmentGetAll']> {
    return this.#call(scopeId, 'attachments.getAll', args, source, (client) =>
      client.attachments.getAll(...args)
    );
  }

  configureGet(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['configureGet']>
  ): ReturnType<CasesClientOperationsApi['configureGet']> {
    return this.#call(scopeId, 'configure.get', args, source, (client) =>
      client.configure.get(...args)
    );
  }

  configureGetConnectors(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['configureGetConnectors']>
  ): ReturnType<CasesClientOperationsApi['configureGetConnectors']> {
    return this.#call(scopeId, 'configure.getConnectors', args, source, (client) =>
      client.configure.getConnectors(...args)
    );
  }

  templateGetTemplate(
    ...[scopeId, args, source]: Parameters<CasesClientOperationsApi['templateGetTemplate']>
  ): ReturnType<CasesClientOperationsApi['templateGetTemplate']> {
    return this.#call(scopeId, 'templates.getTemplate', args, source, (client) =>
      client.templates.getTemplate(...args)
    );
  }
}
