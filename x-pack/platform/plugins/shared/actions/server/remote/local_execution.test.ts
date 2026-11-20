/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { PassThrough, Readable } from 'node:stream';
import { loggerMock } from '@kbn/logging-mocks';
import type { ActionRuntimeResult } from '../lib/execute_action';
import { getGenAiTokenTracking } from '../lib/token_tracking/gen_ai_token_tracking';
import { createLocalConnectorExecution } from './local_execution';

const logger = loggerMock.create();
const chunks = [
  'data: {"choices":[{"delta":{"content":"native stream"}}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":6,"total_tokens":18}}\n\n',
  'data: [DONE]\n\n',
];
const runtime = (data: Readable): ActionRuntimeResult => ({
  result: { status: 'ok', actionId: 'connector', data },
  validatedParams: {
    subAction: 'stream',
    subActionParams: { body: JSON.stringify({ messages: [{ role: 'user', content: 'Local' }] }) },
  },
  errorType: 'other',
  executionStartedAt: 1,
  executionCompletedAt: 2,
  handlerStarted: true,
});
const setup = async (source: Readable, controller = new AbortController()) => {
  const enqueue = jest.fn();
  const onFinalized = jest.fn();
  const execution = await createLocalConnectorExecution({
    runtime: runtime(source),
    actionTypeId: '.gen-ai',
    logger,
    signal: controller.signal,
    abortExecution: () => controller.abort(new Error('Local run completed')),
    onFinalized,
    enqueue,
  });
  const stream = execution.result.data;
  if (!(stream instanceof Readable)) throw new Error('Must return a live local stream');
  return { execution, stream, enqueue, onFinalized, controller };
};

it('returns live data and exactly the original token usage, finalizing once after consumption', async () => {
  const original = runtime(Readable.from(chunks));
  const usage = await getGenAiTokenTracking({
    actionTypeId: '.gen-ai',
    logger,
    result: original.result,
    validatedParams: original.validatedParams,
  });
  const { execution, stream, enqueue, onFinalized } = await setup(Readable.from(chunks));
  let content = '';
  for await (const chunk of stream) content += chunk;
  expect(content).toBe(chunks.join(''));
  expect(enqueue).not.toHaveBeenCalled();
  await Promise.all([execution.finalize(), execution.finalize()]);
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(enqueue.mock.calls[0][0].genAiTokenTracking).toEqual(usage);
  expect(enqueue.mock.calls[0][0].result.data).toEqual({ type: 'local-stream', consumed: true });
  expect(onFinalized).toHaveBeenCalledTimes(1);
});

it('aborts an unconsumed stream at run completion and still finalizes once', async () => {
  const source = new PassThrough();
  const { execution, controller, enqueue } = await setup(source);
  source.write(chunks[0]);
  await Promise.all([execution.finalize(), execution.finalize()]);
  expect(controller.signal.aborted).toBe(true);
  expect(source.destroyed).toBe(true);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it('surfaces the original mid-stream error to the caller and finalizes once', async () => {
  const source = new PassThrough();
  const { execution, stream, enqueue } = await setup(source);
  const consume = async () => {
    for await (const chunk of stream) void chunk;
  };
  const consumed = consume();
  const failure = new Error('Original upstream stream failed');
  source.destroy(failure);
  await expect(consumed).rejects.toBe(failure);
  await Promise.all([execution.finalize(), execution.finalize()]);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it('surfaces scoped abort while the consumer is active and finalizes once', async () => {
  const source = new PassThrough();
  const { execution, stream, enqueue, controller } = await setup(source);
  const consume = async () => {
    for await (const chunk of stream) void chunk;
  };
  const consumed = consume();
  const failure = new Error('Original scoped abort');
  controller.abort(failure);
  await expect(consumed).rejects.toBe(failure);
  await Promise.all([execution.finalize(), execution.finalize()]);
  expect(enqueue).toHaveBeenCalledTimes(1);
});
