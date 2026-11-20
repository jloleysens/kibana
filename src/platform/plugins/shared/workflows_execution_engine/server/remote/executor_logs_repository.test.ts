/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { DataStreamClient } from '@kbn/data-streams';
import { createExecutorLogClient } from './executor_logs_repository';
import { noopLogger } from './noop_logger';
import { createLogs } from '../repositories/logs_repository/create_logs';
import {
  logsRepositoryDataStreamDefinition,
  type WorkflowLogEvent,
} from '../repositories/logs_repository/data_stream';

const event = { '@timestamp': '2026-11-20T00:00:00Z', message: 'unaltered tenant value' };

it.each([
  [event],
  [{ ...event, _id: 'id-1', spaceId: 'ops' }],
  [{ ...event, _id: '' }],
  Array.from({ length: 500 }, (_, index) => ({ ...event, _id: String(index), spaceId: 'default' })),
])(
  'matches the original client request byte-for-byte through the shared write path',
  async (...documents) => {
    const originalTransport = elasticsearchServiceMock.createElasticsearchClient();
    const nativeTransport = elasticsearchServiceMock.createElasticsearchClient();
    const original = DataStreamClient.fromDefinition({
      dataStream: logsRepositoryDataStreamDefinition,
      elasticsearchClient: originalTransport,
    });
    const native = createExecutorLogClient(nativeTransport);
    await createLogs(async () => original, noopLogger(), documents as WorkflowLogEvent[]);
    await createLogs(async () => native, noopLogger(), documents as WorkflowLogEvent[]);
    expect(JSON.stringify(nativeTransport.bulk.mock.calls)).toBe(
      JSON.stringify(originalTransport.bulk.mock.calls)
    );
  }
);

it('matches original create options and reserved document ID validation', async () => {
  const client = elasticsearchServiceMock.createElasticsearchClient();
  const native = createExecutorLogClient(client);
  const original = DataStreamClient.fromDefinition({
    dataStream: logsRepositoryDataStreamDefinition,
    elasticsearchClient: client,
  });
  const request = { documents: [event], refresh: 'wait_for' as const, timeout: '30s' };
  await original.create(request);
  await native.create(request);
  expect(JSON.stringify(client.bulk.mock.calls[0])).toBe(JSON.stringify(client.bulk.mock.calls[1]));
  const invalid = { documents: [{ ...event, _id: 'space::forged' }] };
  await expect(native.create(invalid)).rejects.toThrow(
    "Invalid document ID: IDs cannot contain '::'. This separator is reserved for system use."
  );
  await expect(original.create(invalid)).rejects.toThrow(
    "Invalid document ID: IDs cannot contain '::'. This separator is reserved for system use."
  );
});
