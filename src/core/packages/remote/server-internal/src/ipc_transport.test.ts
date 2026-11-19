/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcTransport } from './ipc_transport';

class Channel extends EventEmitter {
  send = jest.fn((_message: object, callback: (error: Error | null) => void) => {
    callback(null);
    return true;
  });
}

describe('IpcTransport', () => {
  it('prices complete JSON envelopes without recording payload or credential text', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'remote-wire-'));
    const previous = process.env.KBN_REMOTE_WIRE_LOG;
    const transport = new IpcTransport(new Channel());
    try {
      const path = join(directory, 'wire.jsonl');
      process.env.KBN_REMOTE_WIRE_LOG = path;
      const payload = JSON.stringify({ authorization: 'secret', text: '£' });
      await transport.send(payload);
      const line = readFileSync(path, 'utf8');
      expect(JSON.parse(line)).toEqual({
        at: expect.any(Number),
        pid: process.pid,
        payloadBytes: Buffer.byteLength(payload),
        envelopeBytes: Buffer.byteLength(JSON.stringify({ kind: 'remote-seam', payload })) + 1,
      });
      expect(line).not.toContain('secret');
      expect(line).not.toContain('authorization');
    } finally {
      transport.abort(new Error('test complete'));
      if (previous === undefined) delete process.env.KBN_REMOTE_WIRE_LOG;
      else process.env.KBN_REMOTE_WIRE_LOG = previous;
      rmSync(directory, { recursive: true });
    }
  });

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
    expect(transport.signal.aborted).toBe(true);
    expect(transport.signal.reason.message).toContain('disconnected');
  });

  it('rejects malformed seam envelopes without affecting ordinary IPC listeners', async () => {
    const channel = new Channel();
    const transport = new IpcTransport(channel);
    const pending = transport.receive();
    channel.emit('message', { kind: 'remote-seam', payload: 42 });
    await expect(pending).rejects.toThrow('invalid frame');
  });
});

it.each(['callback', 'throw'] as const)(
  'ends the IPC transport lifetime on a send %s error',
  async (mode) => {
    const channel = new Channel();
    channel.send.mockImplementation((_message, callback) => {
      const error = new Error('broken pipe');
      if (mode === 'throw') throw error;
      callback(error);
      return false;
    });
    const transport = new IpcTransport(channel);
    const aborted = jest.fn();
    transport.signal.addEventListener('abort', aborted);
    await expect(transport.send('frame')).rejects.toThrow('broken pipe');
    transport.abort(new Error('second close'));
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(transport.signal.reason.message).toBe('broken pipe');
    expect(channel.listenerCount('message')).toBe(0);
    expect(channel.listenerCount('disconnect')).toBe(0);
  }
);

describe('measurement-only per-direction message delay', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('delays outbound frames once without serializing independent pipelined frames', async () => {
    const channel = new Channel();
    const transport = new IpcTransport(channel, 30);
    try {
      const sends = [transport.send('first'), transport.send('second')];
      jest.advanceTimersByTime(29);
      expect(channel.send).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await Promise.all(sends);
      expect(channel.send.mock.calls.map(([message]) => message)).toEqual([
        { kind: 'remote-seam', payload: 'first' },
        { kind: 'remote-seam', payload: 'second' },
      ]);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      transport.abort(new Error('test complete'));
    }
  });

  it('adds one delay on the request and another on the response, not on receive', async () => {
    const coordinatorChannel = new Channel();
    const workerChannel = new Channel();
    coordinatorChannel.send.mockImplementation((message, callback) => {
      workerChannel.emit('message', message);
      callback(null);
      return true;
    });
    workerChannel.send.mockImplementation((message, callback) => {
      coordinatorChannel.emit('message', message);
      callback(null);
      return true;
    });
    const coordinator = new IpcTransport(coordinatorChannel, 5);
    const worker = new IpcTransport(workerChannel, 5);
    try {
      const request = coordinator.send('request');
      const observed = jest.fn();
      const received = worker.receive().then(observed);
      jest.advanceTimersByTime(5);
      await request;
      await received;
      expect(observed).toHaveBeenCalledWith('request');
      const response = worker.send('response');
      const answered = jest.fn();
      const answer = coordinator.receive().then(answered);
      jest.advanceTimersByTime(4);
      expect(answered).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await response;
      await answer;
      expect(answered).toHaveBeenCalledWith('response');
    } finally {
      coordinator.abort(new Error('test complete'));
      worker.abort(new Error('test complete'));
    }
  });

  it('rejects pending sends immediately on teardown, clears timers and never transmits late', async () => {
    const channel = new Channel();
    const transport = new IpcTransport(channel, 30);
    const sent = transport.send('never send');
    const failure = new Error('lease ended');
    transport.abort(failure);
    await expect(sent).rejects.toBe(failure);
    await expect(transport.send('also never')).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(30);
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.listenerCount('message')).toBe(0);
  });

  it.each([-1, 1.5, 1001, NaN])('rejects invalid delay %s before installing listeners', (delay) => {
    const channel = new Channel();
    expect(() => new IpcTransport(channel, delay)).toThrow('KBN_REMOTE_MESSAGE_DELAY_MS');
    expect(channel.eventNames()).toEqual([]);
  });

  it('reads opt-in delay from the environment; the absent setting sends synchronously', async () => {
    const previous = process.env.KBN_REMOTE_MESSAGE_DELAY_MS;
    const channel = new Channel();
    let transport: IpcTransport | undefined;
    try {
      delete process.env.KBN_REMOTE_MESSAGE_DELAY_MS;
      transport = new IpcTransport(channel);
      await transport.send('no delay');
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      transport.abort(new Error('next profile'));
      process.env.KBN_REMOTE_MESSAGE_DELAY_MS = '1';
      transport = new IpcTransport(channel);
      const sent = transport.send('delayed');
      expect(channel.send).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      await sent;
      expect(channel.send).toHaveBeenCalledTimes(2);
    } finally {
      transport?.abort(new Error('test complete'));
      if (previous === undefined) delete process.env.KBN_REMOTE_MESSAGE_DELAY_MS;
      else process.env.KBN_REMOTE_MESSAGE_DELAY_MS = previous;
    }
  });
});
