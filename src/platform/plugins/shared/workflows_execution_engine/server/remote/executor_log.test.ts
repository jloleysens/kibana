/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { ExecutorLog } from './executor_log';
import type { WorkflowControlApi, WorkflowDataPlaneApi } from './tokens';

const setup = () => {
  const client = elasticsearchServiceMock.createElasticsearchClient();
  client.bulk.mockResolvedValue({ errors: false, took: 1, items: [] });
  const control: jest.Mocked<WorkflowControlApi> = {
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
    operations: [{ create: { _index: '.workflows-execution-data-stream-logs' } }, event],
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
  client.bulk.mockResolvedValue({ errors: true, took: 1, items: [] });
  await expect(log.write([{ message: 'private tenant value' }])).rejects.toThrow(
    'bulk write failed'
  );
  expect(control.info).toHaveBeenCalledWith('Executor log bulk write failed');
});
