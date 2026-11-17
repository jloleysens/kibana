/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { appendFileSync } from 'node:fs';
import { isMainThread, threadId } from 'node:worker_threads';
import { inject } from 'inversify';
import { remotable } from '@kbn/core-remote-common';
import type { DemoCatalog } from './catalog';
import { DemoCatalogToken, EchoToken, DemoValueToken, type EchoApi } from './tokens';

@remotable()
export class Root {
  private readonly abortController = new AbortController();

  async untilDisposed(eventsPath?: string): Promise<void> {
    const record = (event: string) => {
      this.value.label(event);
      if (eventsPath) appendFileSync(eventsPath, event + '\n');
    };
    record('started');
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => record('sideEffect'), 5);
      this.abortController.signal.addEventListener(
        'abort',
        () => {
          clearInterval(timer);
          record('aborted');
          resolve();
        },
        { once: true }
      );
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.abortController.abort(new Error('Executor disposed'));
  }

  constructor(
    @inject(EchoToken) private readonly echo: EchoApi,
    @inject(DemoCatalogToken) private readonly catalog: DemoCatalog,
    @inject(DemoValueToken) private readonly value: { label(event?: string): string }
  ) {}

  async run(request: {
    scopeId: string;
    steps?: Array<{ type: string; with?: unknown }>;
  }): Promise<{
    outputs: unknown[];
    executor: { threadId: number; isMainThread: boolean };
    coordinator: { threadId: number; isMainThread: boolean; marker: string };
  }> {
    const outputs = [];
    for (const step of request.steps ?? []) {
      outputs.push(await this.catalog.run(step.type, request.scopeId, step.with));
    }
    const coordinator = await this.echo.where(request.scopeId);
    return {
      outputs,
      executor: { threadId, isMainThread },
      coordinator,
    };
  }

  hasDispatchEnvironment(): boolean {
    return process.env.KBN_RUNNER_INTERNAL_HEADERS !== undefined;
  }

  bindingLabel(): string {
    return this.value.label();
  }

  pid(): number {
    return process.pid;
  }

  copy(value: { marker: string }): { marker: string } {
    return value;
  }

  async block(milliseconds: number): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < milliseconds) {
      // Synchronous block of this thread only.
    }
    return Date.now() - start;
  }
}
