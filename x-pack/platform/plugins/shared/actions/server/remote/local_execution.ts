/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { PassThrough, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { Logger } from '@kbn/core/server';
import type { ActionRuntimeResult } from '../lib/execute_action';

export interface LocalConnectorExecution {
  readonly result: ActionRuntimeResult['result'];
  finalize(): Promise<void>;
}

/** Keeps inference streams local and finalizes their original token tracking exactly once after consumption. */
export const createLocalConnectorExecution = async ({
  runtime,
  actionTypeId,
  logger,
  signal,
  enqueue,
  abortExecution,
  onFinalized,
}: {
  runtime: ActionRuntimeResult;
  actionTypeId: string;
  logger: Logger;
  signal?: AbortSignal;
  enqueue: (runtime: ActionRuntimeResult) => void;
  abortExecution(): void;
  onFinalized(): void;
}): Promise<LocalConnectorExecution> => {
  const { getGenAiTokenTracking } = await import('../lib/token_tracking/gen_ai_token_tracking');
  const original = runtime.result.data;
  const direct = original instanceof Readable ? original : undefined;
  const consumerTee = direct ? new PassThrough() : undefined;
  const tokenTee = direct ? new PassThrough() : undefined;
  const consumer =
    consumerTee ??
    (original &&
    typeof original === 'object' &&
    'stream' in original &&
    original.stream instanceof Readable
      ? original.stream
      : undefined);
  const tokenStream =
    tokenTee ??
    (original &&
    typeof original === 'object' &&
    'tokenStream' in original &&
    original.tokenStream instanceof Readable
      ? original.tokenStream
      : undefined);
  const result = direct ? { ...runtime.result, data: consumer } : runtime.result;
  const trackingResult = direct ? { ...runtime.result, data: tokenStream } : runtime.result;
  // Observe before returning: a fast abort/error must not become an unhandled stream error.
  const consumed = consumer
    ? finished(consumer).then(
        () => {},
        () => {}
      )
    : Promise.resolve();
  const abort = () => {
    abortExecution();
    const error =
      signal?.reason instanceof Error
        ? signal.reason
        : new Error('Local connector stream closed at run completion');
    if (direct) {
      direct.unpipe();
      direct.destroy();
      tokenTee?.end();
    } else {
      tokenStream?.destroy();
    }
    consumer?.destroy(error);
  };
  if (direct && consumerTee && tokenTee) {
    direct.on('error', (error) => {
      consumerTee.destroy(error);
      tokenTee.end();
    });
    direct.pipe(consumerTee);
    direct.pipe(tokenTee);
  }
  const tracking =
    runtime.result.status === 'ok'
      ? getGenAiTokenTracking({
          actionTypeId,
          logger,
          result: trackingResult,
          validatedParams: runtime.validatedParams,
        }).catch((error) => {
          logger.error('Failed to calculate tokens from streaming response');
          logger.error(error);
          return null;
        })
      : Promise.resolve(null);
  // The original tracker intentionally turns token-parser failures into null; retain that policy.
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let completion: Promise<void> | undefined;
  const finalize = (): Promise<void> =>
    (completion ??= (async () => {
      try {
        if (consumer && !consumer.readableEnded) abort();
        await consumed;
        const genAiTokenTracking = await tracking;
        const safeResult: ActionRuntimeResult['result'] = JSON.parse(
          JSON.stringify(result, (_key, value) =>
            value instanceof Readable
              ? { type: 'local-stream', consumed: value.readableEnded }
              : value
          )
        );
        enqueue({
          ...runtime,
          result: safeResult,
          genAiTokenTracking,
          validatedParams: JSON.parse(
            JSON.stringify(runtime.validatedParams, (_key, value) =>
              value instanceof AbortSignal ? undefined : value
            )
          ),
        });
      } finally {
        signal?.removeEventListener('abort', abort);
        onFinalized();
      }
    })());
  return { result, finalize };
};
