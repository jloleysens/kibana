/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { WorkflowStepCatalog } from './step_catalog';
import type { RemoteWorkflowStep } from './tokens';

it('partitions step and connector kinds without constructing either contribution on discovery', async () => {
  const step = { run: jest.fn(async () => ({ output: 'step' })) };
  const connector = { run: jest.fn(async () => ({ status: 'ok', data: 'connector' })) };
  const createStep = jest.fn(() => step);
  const createConnector = jest.fn(() => connector);
  const catalog = new WorkflowStepCatalog(
    new Map<string, () => RemoteWorkflowStep>([
      ['data.example', createStep],
      ['example', createConnector],
    ]),
    new Map([
      ['data.example', 'workflows.step'],
      ['example', 'workflows.connector'],
    ])
  );
  expect(catalog.supports('data.example')).toBe(true);
  expect(catalog.supportsConnector('example')).toBe(true);
  expect(catalog.supports('example')).toBe(false);
  expect(catalog.supportsConnector('data.example')).toBe(false);
  expect(createStep).not.toHaveBeenCalled();
  expect(createConnector).not.toHaveBeenCalled();
  await expect(catalog.run('example', 'scope', {}, {})).rejects.toThrow('Unsupported remote step');
  await expect(catalog.runConnector('data.example', 'scope', {}, {})).rejects.toThrow(
    'Unsupported remote connector'
  );
  expect(createStep).not.toHaveBeenCalled();
  expect(createConnector).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  await expect(catalog.runConnector('example', 'scope', { input: 1 }, { signal })).resolves.toEqual(
    { status: 'ok', data: 'connector' }
  );
  expect(connector.run).toHaveBeenCalledWith('scope', { input: 1 }, { signal });
  expect(createStep).not.toHaveBeenCalled();
  await expect(catalog.run('data.example', 'scope', { with: 1 }, {})).resolves.toEqual({
    output: 'step',
  });
});

it('keeps legacy step-only catalogs working and refuses unknown kinds or missing contributions', async () => {
  const create = jest.fn(() => ({ run: jest.fn(async () => ({ output: 1 })) }));
  const legacy = new WorkflowStepCatalog(new Map([['old', create]]));
  expect(legacy.supports('old')).toBe(true);
  expect(legacy.supportsConnector('old')).toBe(false);
  await expect(legacy.run('old', 'scope', {}, {})).resolves.toEqual({ output: 1 });
  const other = new WorkflowStepCatalog(
    new Map([['other', create]]),
    new Map([['other', 'other.kind']])
  );
  expect(other.supports('other')).toBe(false);
  expect(other.supportsConnector('other')).toBe(false);
  await expect(other.run('missing', 'scope', {}, {})).rejects.toThrow('Unsupported remote step');
  await expect(other.runConnector('missing', 'scope', {}, {})).rejects.toThrow(
    'Unsupported remote connector'
  );
});
