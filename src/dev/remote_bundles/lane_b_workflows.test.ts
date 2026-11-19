/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Liquid } from 'liquidjs';
import { createLaneBWorkflow } from './lane_b_workflows';

it.each(['extensions', 'cases', 'inference', 'conversation', 'attachments', 'rerank'] as const)(
  '%s retains a real persisted outcome',
  (family) => {
    const workflow = createLaneBWorkflow(family, 'proof', 'endpoint');
    expect(workflow.steps.at(-1)).toMatchObject({
      type: 'elasticsearch.index',
      with: { index: 'lane-b-quiet-outcomes', document: { family, workflow: 'proof' } },
    });
    expect(JSON.stringify(workflow)).not.toMatch(/authorization|api_key|password/);
  }
);

it('uses a fresh valid hex attack id each run instead of an empty fingerprint fast path', async () => {
  const fingerprint = createLaneBWorkflow('extensions', 'proof', 'endpoint').steps.find(
    ({ name }) => name === 'fingerprints'
  );
  expect(fingerprint).toBeDefined();
  const rendered = JSON.parse(
    await new Liquid().parseAndRender(JSON.stringify(fingerprint), {
      execution: { id: '12345678-1234-1234-1234-123456789abc' },
    })
  );
  expect(rendered.with.attacks).toHaveLength(1);
  expect(rendered.with.attacks[0]['kibana.alert.uuid']).toMatch(/^[a-f0-9]{64}$/);
});
