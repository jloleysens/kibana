/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import axios from 'axios';
import { createGcpTokenTransport } from './gcp_token_transport';
import { GCP_TOKEN_URL } from './gcp_jwt_helpers';

it('uses the supplied policy-bound HTTP client, pins the token URL, strips API authorization and preserves raw response semantics', async () => {
  const client = axios.create();
  const request = jest
    .spyOn(client, 'request')
    .mockResolvedValue({ status: 400, data: '{"error":"invalid_grant"}' });
  const ensureUriAllowed = jest.fn();
  const transport = createGcpTokenTransport(client, { ensureUriAllowed });
  const response = await transport('assertion=fake');
  expect(ensureUriAllowed).toHaveBeenCalledWith(GCP_TOKEN_URL);
  expect(request).toHaveBeenCalledWith({
    url: GCP_TOKEN_URL,
    method: 'POST',
    data: 'assertion=fake',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: undefined },
    responseType: 'text',
    validateStatus: expect.any(Function),
  });
  expect(response.ok).toBe(false);
  expect(response.status).toBe(400);
  expect(await response.text()).toBe('{"error":"invalid_grant"}');
  expect(await response.json()).toEqual({ error: 'invalid_grant' });
});

it('rejects a denied token endpoint before starting any HTTP request', async () => {
  const client = axios.create();
  const request = jest.spyOn(client, 'request');
  const failure = new Error('host denied');
  await expect(
    createGcpTokenTransport(client, {
      ensureUriAllowed: () => {
        throw failure;
      },
    })('assertion=fake')
  ).rejects.toBe(failure);
  expect(request).not.toHaveBeenCalled();
});

it('does not turn invalid token JSON into a successful parsed string', async () => {
  const client = axios.create();
  jest.spyOn(client, 'request').mockResolvedValue({ status: 200, data: 'invalid JSON' });
  const response = await createGcpTokenTransport(client)('assertion=fake');
  await expect(response.json()).rejects.toThrow(SyntaxError);
});
