/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { httpServerMock } from '@kbn/core-http-server-mocks';
import { workflowDispatchCredentials } from './workflow_dispatch_credentials';

const environment = process.env;
beforeEach(() => {
  process.env = { ...environment };
  delete process.env.KBN_RUNNER_ES_NODE;
  delete process.env.KBN_RUNNER_INTERNAL_HEADERS;
});
afterEach(() => {
  process.env = environment;
});

it('requires no raw credentials in-process when direct worker configuration is absent', () => {
  expect(workflowDispatchCredentials(httpServerMock.createKibanaRequest())).toBeUndefined();
});

it('separates the configured internal credential from the restored execution identity', () => {
  process.env.KBN_RUNNER_ES_NODE = 'http://localhost:9200';
  process.env.KBN_RUNNER_INTERNAL_HEADERS = '{"authorization":"Basic internal"}';
  expect(
    workflowDispatchCredentials(
      httpServerMock.createKibanaRequest({ headers: { authorization: 'ApiKey execution' } })
    )
  ).toEqual({
    node: 'http://localhost:9200',
    internalHeaders: { authorization: 'Basic internal' },
    userHeaders: { authorization: 'ApiKey execution' },
  });
});

it('never exposes malformed credential text through parser errors', () => {
  process.env.KBN_RUNNER_ES_NODE = 'http://localhost:9200';
  process.env.KBN_RUNNER_INTERNAL_HEADERS = 'private credential text, not JSON';
  expect(() =>
    workflowDispatchCredentials(
      httpServerMock.createKibanaRequest({ headers: { authorization: 'ApiKey execution' } })
    )
  ).toThrow('Invalid worker internal authorization configuration');
});
