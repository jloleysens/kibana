/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

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

/** Multiplexes JSON-string RPC frames without consuming init, ready or other fork messages. */
export class IpcTransport implements RpcTransport {
  readonly encodingLevel = 'string' as const;
  private readonly queue: string[] = [];
  private pending?: { resolve: (message: string) => void; reject: (error: Error) => void };
  private error?: Error;

  constructor(private readonly channel: IpcChannel) {
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
    return new Promise((resolve, reject) => {
      this.channel.send({ kind: 'remote-seam', payload }, (error) =>
        error ? reject(error) : resolve()
      );
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
    this.pending?.reject(this.error);
    this.pending = undefined;
  }
}
