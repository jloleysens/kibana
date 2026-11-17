/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { EventEmitter } from 'node:events';
import { IpcTransport } from './ipc_transport';

class Channel extends EventEmitter {
  send = jest.fn((_message: object, callback: (error: Error | null) => void) => {
    callback(null);
    return true;
  });
}

describe('IpcTransport', () => {
  it('ignores init/ready messages and preserves frame order across buffered receives', async () => {
    const channel = new Channel();
    const transport = new IpcTransport(channel);
    const observed = jest.fn();
    channel.on('message', observed);
    channel.emit('message', { kind: 'init' });
    channel.emit('message', { kind: 'ready' });
    channel.emit('message', { kind: 'remote-seam', payload: 'first' });
    await expect(transport.receive()).resolves.toBe('first');
    const next = transport.receive();
    channel.emit('message', { kind: 'remote-seam', payload: 'second' });
    await expect(next).resolves.toBe('second');
    await transport.send('third');
    expect(channel.send).toHaveBeenCalledWith(
      { kind: 'remote-seam', payload: 'third' },
      expect.any(Function)
    );
    expect(observed).toHaveBeenCalledTimes(4);
    transport.abort(new Error('test complete'));
  });

  it('rejects on disconnect and removes only its own listeners', async () => {
    const channel = new Channel();
    const otherListener = jest.fn();
    channel.on('message', otherListener);
    const transport = new IpcTransport(channel);
    const pending = transport.receive();
    channel.emit('disconnect');
    await expect(pending).rejects.toThrow('disconnected');
    await expect(transport.send('late')).rejects.toThrow('disconnected');
    expect(channel.listeners('message')).toEqual([otherListener]);
    expect(channel.listenerCount('disconnect')).toBe(0);
  });

  it('rejects malformed seam envelopes without affecting ordinary IPC listeners', async () => {
    const channel = new Channel();
    const transport = new IpcTransport(channel);
    const pending = transport.receive();
    channel.emit('message', { kind: 'remote-seam', payload: 42 });
    await expect(pending).rejects.toThrow('invalid frame');
  });
});
