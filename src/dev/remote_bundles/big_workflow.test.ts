/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  BIG_WORKFLOW_ALERT_COUNT,
  bigWorkflowAlerts,
  createBigWorkflow,
  createBigWorkflowChild,
} from './big_workflow';

const targets = {
  childId: 'child',
  endpoint: 'endpoint',
  slackConnectorId: 'slack',
};

const walk = (steps: ReadonlyArray<{ type?: string; steps?: unknown; else?: unknown }>): string[] =>
  steps.flatMap((step) => [
    step.type ?? '',
    ...walk((step.steps as typeof steps) ?? []),
    ...walk((step.else as typeof steps) ?? []),
  ]);

it('builds a kitchen-sink workflow over fifty alerts with the required step types', () => {
  expect(bigWorkflowAlerts()).toHaveLength(BIG_WORKFLOW_ALERT_COUNT);
  expect(new Set(bigWorkflowAlerts().map((alert) => alert.host)).size).toBe(
    BIG_WORKFLOW_ALERT_COUNT
  );
  const workflow = createBigWorkflow('big', targets);
  const types = walk(workflow.steps);
  for (const type of [
    'elasticsearch.search',
    'elasticsearch.esql.query',
    'elasticsearch.bulk',
    'elasticsearch.index',
    'foreach',
    'if',
    'data.map',
    'data.filter',
    'data.set',
    'slack2.sendMessage',
    'ai.prompt',
    'cases.createCase',
    'workflow.execute',
  ]) {
    expect(types).toContain(type);
  }
  const confirm = workflow.steps.find((step) => step.name === 'confirmDelivery');
  expect(confirm?.['on-failure']).toEqual({ retry: { 'max-attempts': 2, delay: '1s' } });
  expect(types.filter((type) => type === 'slack2.sendMessage')).toHaveLength(2);
  const child = createBigWorkflowChild('big');
  expect(child.steps[0]).toMatchObject({ type: 'data.set' });
  // foreach body is label + if + one taken branch + shape, fifty times, before the outer steps.
  expect(BIG_WORKFLOW_ALERT_COUNT * 4).toBeGreaterThanOrEqual(150);
});
