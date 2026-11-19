/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { savedObjectsClientMock } from '@kbn/core-saved-objects-api-server-mocks';
import { ConnectorDashboardState } from './connector_dashboard_state';

const setup = (type = '.gen-ai', subAction = 'getDashboard') => {
  const client = savedObjectsClientMock.create();
  const controller = new AbortController();
  const attributes = { title: 'Original provider dashboard' };
  const build = jest.fn(() => attributes);
  const state = new ConnectorDashboardState(
    client,
    type,
    { subAction, subActionParams: { dashboardId: 'pinned-dashboard' } },
    controller.signal,
    build
  );
  return { client, controller, attributes, build, state };
};

it('pins reads and writes to the prepared dashboard and coordinator-owned provider template', async () => {
  const { client, state, build, attributes } = setup();
  await state.execute({ operation: 'get' });
  await state.execute({ operation: 'create' });
  expect(client.get).toHaveBeenCalledWith('dashboard', 'pinned-dashboard');
  expect(build).toHaveBeenCalledWith('pinned-dashboard');
  expect(client.create).toHaveBeenCalledWith('dashboard', attributes, {
    id: 'pinned-dashboard',
    overwrite: true,
  });
  expect(client.delete).not.toHaveBeenCalled();
});

it.each([
  ['.jenkins', 'getDashboard'],
  ['.gen-ai', 'run'],
])('rejects unprepared type/subaction %s/%s', async (type, subAction) => {
  const { client, state } = setup(type, subAction);
  await expect(state.execute({ operation: 'get' })).rejects.toThrow('not available');
  expect(client.get).not.toHaveBeenCalled();
});

it('preserves the original dashboard helper error fields without exporting raw service errors', async () => {
  const { client, state } = setup();
  client.get.mockRejectedValue(
    Object.assign(new Error('not found'), {
      output: { statusCode: 404, payload: { error: 'Not Found' } },
      privateField: 'not exported',
    })
  );
  expect(await state.execute({ operation: 'get' })).toEqual({
    error: { message: 'not found', statusCode: 404, error: 'Not Found' },
  });
});

it.each(['abort', 'finalize'])('rejects calls after %s', async (operation) => {
  const { controller, state, client } = setup();
  if (operation === 'abort') controller.abort();
  else state.close();
  await expect(state.execute({ operation: 'create' })).rejects.toThrow();
  expect(client.create).not.toHaveBeenCalled();
});
