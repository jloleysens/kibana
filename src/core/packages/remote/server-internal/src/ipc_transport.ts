/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { appendFileSync } from 'node:fs';
import type { RpcTransport } from 'capnweb';

interface IpcEnvelope {
  kind: 'remote-seam';
  payload: string | null;
}

export interface IpcChannel {
  send(message: IpcEnvelope, callback: (error: Error | null) => void): boolean;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'disconnect', listener: () => void): void;
  off(event: 'message', listener: (message: unknown) => void): void;
  off(event: 'disconnect', listener: () => void): void;
}

/** Validates the opt-in outbound IPC delay used only for network-sensitivity measurements. */
export const getIpcMessageDelayMs = (
  value = Number(process.env.KBN_REMOTE_MESSAGE_DELAY_MS ?? 0)
): number => {
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    throw new Error('KBN_REMOTE_MESSAGE_DELAY_MS must be an integer between 0 and 1000');
  }
  return value;
};

/** Multiplexes JSON-string RPC frames without consuming init, ready or other fork messages. */
export class IpcTransport implements RpcTransport {
  readonly encodingLevel = 'string' as const;
  private readonly queue: string[] = [];
  private pending?: { resolve: (message: string) => void; reject: (error: Error) => void };
  private error?: Error;
  private readonly controller = new AbortController();
  private readonly delayed = new Set<{
    timer: ReturnType<typeof setTimeout>;
    reject: (error: Error) => void;
  }>();
  readonly signal = this.controller.signal;

  constructor(
    private readonly channel: IpcChannel,
    // Measurement-only outbound delay; both peers apply it, once per message direction.
    private readonly messageDelayMs = getIpcMessageDelayMs()
  ) {
    getIpcMessageDelayMs(messageDelayMs);
    channel.on('message', this.onMessage);
    channel.on('disconnect', this.onDisconnect);
  }

  private readonly onMessage = (message: unknown): void => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('kind' in message) ||
      message.kind !== 'remote-seam'
    )
      return;
    if (!('payload' in message) || typeof message.payload !== 'string') {
      this.abort(new Error('Remote IPC session closed or sent an invalid frame'));
      return;
    }
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve(message.payload);
    } else this.queue.push(message.payload);
  };

  private readonly onDisconnect = (): void =>
    this.abort(new Error('Remote IPC channel disconnected'));

  send(payload: string): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (this.messageDelayMs === 0) return this.sendNow(payload);
    return new Promise((resolve, reject) => {
      const pending = {
        timer: setTimeout(() => {
          this.delayed.delete(pending);
          this.sendNow(payload).then(resolve, reject);
        }, this.messageDelayMs),
        reject,
      };
      this.delayed.add(pending);
    });
  }

  private sendNow(payload: string): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    const log = process.env.KBN_REMOTE_WIRE_LOG;
    if (log) {
      appendFileSync(
        log,
        JSON.stringify({
          at: performance.timeOrigin + performance.now(),
          pid: process.pid,
          payloadBytes: Buffer.byteLength(payload),
          envelopeBytes: Buffer.byteLength(JSON.stringify({ kind: 'remote-seam', payload })) + 1,
        }) + '\n'
      );
    }
    return new Promise((resolve, reject) => {
      try {
        this.channel.send({ kind: 'remote-seam', payload }, (error) => {
          if (error) {
            this.abort(error);
            reject(error);
          } else resolve();
        });
      } catch (error) {
        this.abort(error);
        reject(error);
      }
    });
  }

  receive(): Promise<string> {
    if (this.error) return Promise.reject(this.error);
    const message = this.queue.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  abort(reason: unknown): void {
    if (this.error) return;
    this.error = reason instanceof Error ? reason : new Error(String(reason));
    this.channel.off('message', this.onMessage);
    this.channel.off('disconnect', this.onDisconnect);
    this.queue.length = 0;
    for (const { timer, reject } of this.delayed) {
      clearTimeout(timer);
      reject(this.error);
    }
    this.delayed.clear();
    this.pending?.reject(this.error);
    this.pending = undefined;
    this.controller.abort(this.error);
  }
}
