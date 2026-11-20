/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { errors } from '@elastic/elasticsearch';
import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { ExecutorLog } from './executor_log';
import type { WorkflowControlApi, WorkflowDataPlaneApi } from './tokens';

const setup = () => {
  const client = elasticsearchServiceMock.createElasticsearchClient();
  client.bulk.mockResolvedValue({ errors: false, took: 1, items: [] });
  const control: jest.Mocked<WorkflowControlApi> = {
    persistence: jest.fn(),
    initializeLogs: jest.fn().mockResolvedValue(undefined),
    info: jest.fn(),
    scheduleResume: jest.fn(),
    executeConnector: jest.fn(),
  };
  const data: WorkflowDataPlaneApi = {
    open: jest.fn(),
    close: jest.fn(),
    internal: () => client,
    user: () => client,
  };
  return { client, control, log: new ExecutorLog(data, control) };
};

it('initializes coordinator-owned stream metadata once, then writes event bytes directly to ES', async () => {
  const { client, control, log } = setup();
  const event = { '@timestamp': '2026-11-17T00:00:00Z', message: 'tenant event' };
  await log.write([event]);
  await log.write([event]);
  expect(control.initializeLogs).toHaveBeenCalledTimes(1);
  expect(client.bulk).toHaveBeenCalledTimes(2);
  expect(client.bulk).toHaveBeenCalledWith({
    index: '.workflows-execution-data-stream-logs',
    operations: [{ create: {} }, event],
  });
  expect(control.info).not.toHaveBeenCalled();
});

it('retries failed metadata initialization on a later flush without caching its rejection', async () => {
  const { client, control, log } = setup();
  control.initializeLogs.mockRejectedValueOnce(new Error('initialization unavailable'));
  await expect(log.write([{}])).rejects.toThrow('initialization unavailable');
  expect(client.bulk).not.toHaveBeenCalled();
  await log.write([{}]);
  expect(control.initializeLogs).toHaveBeenCalledTimes(2);
  expect(client.bulk).toHaveBeenCalledTimes(1);
});

it('reports write failure without forwarding tenant event payloads into coordinator diagnostics', async () => {
  const { client, control, log } = setup();
  client.bulk.mockRejectedValue(new Error('bulk write failed: private tenant value'));
  await expect(log.write([{ message: 'private tenant value' }])).rejects.toThrow(
    'bulk write failed'
  );
  expect(control.info).toHaveBeenCalledWith('Executor log persistence failed after retries');
});

it('preserves original DataStreamClient item-error semantics without inventing a retry', async () => {
  const { client, control, log } = setup();
  client.bulk.mockResolvedValue({ errors: true, took: 1, items: [] });
  await log.write([{ message: 'tenant event' }]);
  expect(client.bulk).toHaveBeenCalledTimes(1);
  expect(control.info).not.toHaveBeenCalled();
});

it('uses the original bounded transient retry before reporting payload-free failure', async () => {
  jest.useFakeTimers();
  try {
    const { client, control, log } = setup();
    client.bulk.mockRejectedValue(new errors.ConnectionError('private tenant value'));
    const failed = expect(log.write([{ message: 'private tenant value' }])).rejects.toThrow(
      'private tenant value'
    );
    await jest.runAllTimersAsync();
    await failed;
    expect(client.bulk).toHaveBeenCalledTimes(4);
    expect(control.info).toHaveBeenCalledTimes(1);
    expect(control.info).toHaveBeenCalledWith('Executor log persistence failed after retries');
  } finally {
    jest.useRealTimers();
  }
});

it('resolves the active run client again when a reused host flushes another run', async () => {
  const first = elasticsearchServiceMock.createElasticsearchClient();
  const second = elasticsearchServiceMock.createElasticsearchClient();
  const internal = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { control } = setup();
  const data: WorkflowDataPlaneApi = {
    open: jest.fn(),
    close: jest.fn(),
    internal,
    user: () => second,
  };
  const log = new ExecutorLog(data, control);
  const event = { '@timestamp': '2026-11-20T00:00:00Z', message: 'run-local client' };
  await log.write([event]);
  await log.write([event]);
  expect(first.bulk).toHaveBeenCalledTimes(1);
  expect(second.bulk).toHaveBeenCalledTimes(1);
  expect(control.initializeLogs).toHaveBeenCalledTimes(1);
});
