/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Client } from '@elastic/elasticsearch';
import { ExecutorDataPlane } from './executor_data_plane';

const mockClose = jest.fn().mockResolvedValue(undefined);

jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn().mockImplementation(() => ({ close: mockClose })),
}));

const credentials = {
  node: 'http://localhost:9200',
  internalHeaders: { authorization: 'Basic internal' },
  userHeaders: { authorization: 'ApiKey scoped' },
};

beforeEach(() => jest.clearAllMocks());

it('binds distinct dispatch identities, enforces one active worker lease and releases client references', async () => {
  const data = new ExecutorDataPlane();
  await data.open('run', credentials);
  expect(data.internal('run')).not.toBe(data.user('run'));
  expect(jest.mocked(Client).mock.calls.map(([options]) => options?.headers)).toEqual([
    { authorization: 'Basic internal', 'x-elastic-product-origin': 'kibana' },
    { authorization: 'ApiKey scoped', 'x-elastic-product-origin': 'kibana' },
  ]);
  await expect(data.open('other', credentials)).rejects.toThrow('active workflow lease');
  await data.close('run');
  expect(mockClose).toHaveBeenCalledTimes(2);
  expect(() => data.user('run')).toThrow('scope is closed');
  expect(() => data.internal()).toThrow('No unique active workflow lease');
  await data.open('next', credentials);
  await data.close('next');
  expect(Client).toHaveBeenCalledTimes(4);
  expect(mockClose).toHaveBeenCalledTimes(4);
});

it('refuses missing credentials before loading or constructing clients', async () => {
  const data = new ExecutorDataPlane();
  await expect(data.open('run')).rejects.toThrow('separate internal and run-user');
  expect(Client).not.toHaveBeenCalled();
});

it('reserves the worker lease before awaiting the first lazy client import', async () => {
  const data = new ExecutorDataPlane();
  const first = data.open('first', credentials);
  await expect(data.open('second', credentials)).rejects.toThrow('active workflow lease');
  await first;
  await data.close('first');
});
