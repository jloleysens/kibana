/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/** Seeded alerts walked by the kitchen-sink workflow. Fifty keeps the run realistic and over 150 step executions. */
export const BIG_WORKFLOW_ALERT_COUNT = 50;

export const BIG_WORKFLOW_ALERTS_INDEX = 'big_workflow_alerts';
export const BIG_WORKFLOW_FINDINGS_INDEX = 'big_workflow_findings';
export const BIG_WORKFLOW_OUTCOMES_INDEX = 'big_workflow_outcomes';

export interface BigWorkflowAlert {
  host: string;
  severity: 'high' | 'low';
  message: string;
}

/** Stable alert documents. Fixed ids and timestamps keep cross-mode output comparison honest. */
export const bigWorkflowAlerts = (): BigWorkflowAlert[] =>
  Array.from({ length: BIG_WORKFLOW_ALERT_COUNT }, (_, index) => {
    const host = `host-${String(index).padStart(2, '0')}`;
    const severity = index % 2 === 0 ? 'high' : 'low';
    return {
      host,
      severity,
      message: `${severity} authentication failure on ${host}`,
    };
  });

export interface BigWorkflowTargets {
  childId: string;
  endpoint: string;
  slackConnectorId: string;
}

/** Synchronous child used by the kitchen-sink handoff. It only acknowledges the parent summary. */
export const createBigWorkflowChild = (id: string) => ({
  version: '1',
  name: `${id}-child`,
  enabled: true,
  description: 'Acknowledges a triage summary for the parent investigation workflow.',
  triggers: [
    {
      type: 'manual',
      inputs: {
        properties: { summary: { type: 'string' } },
        additionalProperties: false,
      },
    },
  ],
  steps: [
    {
      name: 'acknowledge',
      type: 'data.set',
      with: { summary: '{{ inputs.summary }}', handled_by: 'triage-child' },
    },
  ],
});

/**
 * Realistic triage workflow: search a seeded alert index, branch per alert, write findings,
 * notify Slack, call a local catalogue and a once-failing webhook, ask a local model, open a case,
 * and hand off to a synchronous child workflow.
 */
export const createBigWorkflow = (id: string, targets: BigWorkflowTargets) => ({
  version: '1',
  name: id,
  enabled: true,
  description:
    'Triage seeded authentication alerts, persist findings, and notify the response channel.',
  tags: ['big-workflow', 'triage'],
  consts: {
    alertsIndex: BIG_WORKFLOW_ALERTS_INDEX,
    findingsIndex: BIG_WORKFLOW_FINDINGS_INDEX,
    outcomesIndex: BIG_WORKFLOW_OUTCOMES_INDEX,
  },
  triggers: [{ type: 'manual' }],
  steps: [
    {
      name: 'searchAlerts',
      type: 'elasticsearch.search',
      with: {
        index: '{{ consts.alertsIndex }}',
        size: BIG_WORKFLOW_ALERT_COUNT,
        sort: [{ host: 'asc' }],
        query: { match_all: {} },
      },
    },
    {
      name: 'countAlerts',
      type: 'elasticsearch.esql.query',
      with: {
        query: `FROM ${BIG_WORKFLOW_ALERTS_INDEX} | STATS alert_count = COUNT(*) | KEEP alert_count`,
      },
    },
    {
      name: 'project',
      type: 'data.map',
      items: '${{ steps.searchAlerts.output.hits.hits }}',
      with: {
        fields: {
          host: '{{ item._source.host }}',
          severity: '{{ item._source.severity }}',
          message: '{{ item._source.message }}',
        },
      },
    },
    {
      name: 'highs',
      type: 'data.filter',
      items: '${{ steps.project.output }}',
      with: { condition: 'item.severity: high' },
    },
    {
      name: 'triage',
      type: 'foreach',
      foreach: '${{ steps.project.output }}',
      steps: [
        {
          name: 'label',
          type: 'data.set',
          with: {
            host: '{{ foreach.item.host }}',
            severity: '{{ foreach.item.severity }}',
          },
        },
        {
          name: 'gate',
          type: 'if',
          condition: '${{ foreach.item.severity == "high" }}',
          steps: [
            {
              name: 'prioritise',
              type: 'data.set',
              with: { priority: 'p1', host: '{{ foreach.item.host }}' },
            },
          ],
          else: [
            {
              name: 'defer',
              type: 'data.set',
              with: { priority: 'p3', host: '{{ foreach.item.host }}' },
            },
          ],
        },
        {
          name: 'shape',
          type: 'data.map',
          items: '${{ foreach.item }}',
          with: {
            fields: {
              host: '{{ item.host }}',
              severity: '{{ item.severity }}',
              priority: '{% if item.severity == "high" %}p1{% else %}p3{% endif %}',
            },
          },
        },
      ],
    },
    {
      name: 'recordFindings',
      type: 'elasticsearch.bulk',
      with: {
        index: '{{ consts.findingsIndex }}',
        refresh: 'wait_for',
        operations: [
          {
            kind: 'triage-summary',
            high_alerts: '{{ steps.highs.output | size }}',
            source: 'big-workflow',
          },
        ],
      },
    },
    {
      name: 'notify',
      type: 'slack2.sendMessage',
      'connector-id': targets.slackConnectorId,
      with: {
        channel: 'C123',
        text: 'Triage complete for {{ steps.highs.output | size }} high alerts',
      },
    },
    {
      name: 'ask',
      type: 'ai.prompt',
      'connector-id': targets.endpoint,
      with: { prompt: 'Summarise the authentication triage in one sentence.' },
    },
    {
      name: 'openCase',
      type: 'cases.createCase',
      with: {
        title: 'Big workflow authentication triage',
        description: 'Opened from the kitchen-sink triage workflow.',
        owner: 'cases',
      },
    },
    {
      name: 'handoff',
      type: 'workflow.execute',
      with: {
        'workflow-id': targets.childId,
        inputs: { summary: 'Triage complete for {{ steps.highs.output | size }} high alerts' },
      },
    },
    {
      name: 'confirmDelivery',
      type: 'slack2.sendMessage',
      'connector-id': targets.slackConnectorId,
      with: {
        channel: 'C123',
        text: 'confirm-delivery of the triage summary for {{ steps.highs.output | size }} high alerts',
      },
      'on-failure': {
        retry: { 'max-attempts': 2, delay: '1s' },
      },
    },
    {
      name: 'persist',
      type: 'elasticsearch.index',
      with: {
        index: '{{ consts.outcomesIndex }}',
        refresh: 'wait_for',
        document: {
          workflow: id,
          highAlerts: '{{ steps.highs.output | size }}',
          caseTitle: '{{ steps.openCase.output.case.title }}',
          childSummary: '{{ steps.handoff.output.summary }}',
          model: '{{ steps.ask.output.content }}',
          confirmed: '{{ steps.confirmDelivery.output.message.text }}',
        },
      },
    },
  ],
});
