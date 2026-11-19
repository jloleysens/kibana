/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export type LaneBFamily = 'extensions' | 'cases' | 'inference';

/** Uses the same original business steps for ordinary Kibana and each worker backend. */
export const createLaneBWorkflow = (family: LaneBFamily, id: string, endpoint: string) => {
  const steps = {
    extensions: [
      {
        name: 'entities',
        type: 'security.getAlertEntities',
        with: { alert_ids: ['lane-b-native-alert'], entity_types: ['host'] },
      },
      {
        name: 'filters',
        type: 'security.buildExceptionEntriesFilter',
        with: { entries: [{ field: 'host.name', operator: 'is', value: 'lane-b-worker-host' }] },
      },
      {
        name: 'fingerprints',
        type: 'security.matchAttackFingerprints',
        with: {
          attacks: [
            {
              'kibana.alert.uuid':
                "{{ execution.id | remove: '-' | append: '00000000000000000000000000000000' }}",
              'kibana.alert.attack_discovery.title': id,
              'kibana.alert.attack_discovery.summary_markdown': 'Lane B quiet-phase proof',
              'kibana.alert.attack_discovery.alert_ids': ['lane-b-native-alert'],
              'kibana.alert.attack_discovery.mitre_attack_tactics': ['TA0008'],
            },
          ],
          parent_run_id: '{{ execution.id }}',
        },
      },
      {
        name: 'note',
        type: 'security.createNote',
        with: { document_id: '{{ execution.id }}', text: id },
      },
      {
        name: 'notes',
        type: 'security.getNotes',
        with: { document_id: '{{ execution.id }}' },
      },
    ],
    cases: [
      {
        name: 'create',
        type: 'cases.createCase',
        with: { title: id, description: 'Lane B quiet-phase proof', owner: 'cases' },
      },
      {
        name: 'update',
        type: 'cases.updateCase',
        with: { case_id: '{{ steps.create.output.case.id }}', updates: { title: `${id} updated` } },
      },
      {
        name: 'attach',
        type: 'cases.addComment',
        with: { case_id: '{{ steps.create.output.case.id }}', comment: id },
      },
      {
        name: 'find',
        type: 'cases.findCases',
        with: { owner: ['cases'], search: `"${id}"`, searchFields: ['title'], perPage: 100 },
      },
      {
        name: 'read',
        type: 'cases.getCase',
        with: { case_id: '{{ steps.create.output.case.id }}', include_comments: true },
      },
    ],
    inference: [
      {
        name: 'prompt',
        type: 'ai.prompt',
        'connector-id': endpoint,
        with: { prompt: 'Local business record' },
      },
      {
        name: 'summarize',
        type: 'ai.summarize',
        'connector-id': endpoint,
        with: { input: 'Local business record' },
      },
      {
        name: 'classify',
        type: 'ai.classify',
        'connector-id': endpoint,
        with: { input: 'Security alert', categories: ['Security', 'Other'] },
      },
    ],
  }[family];
  const document = {
    extensions: {
      entityId: '{{ steps.entities.output.entities[0].id }}',
      noteId: '{{ steps.note.output.note_id }}',
      fingerprintTitle: '{{ steps.fingerprints.output.reviews[0].title }}',
    },
    cases: {
      caseId: '{{ steps.create.output.case.id }}',
      title: '{{ steps.read.output.case.title }}',
    },
    inference: {
      prompt: '{{ steps.prompt.output.content }}',
      category: '{{ steps.classify.output.category }}',
    },
  }[family];
  return {
    version: '1',
    name: id,
    enabled: true,
    triggers: [{ type: 'manual' }],
    steps: [
      ...steps,
      {
        name: 'persist',
        type: 'elasticsearch.index',
        with: { index: 'lane-b-quiet-outcomes', document: { family, workflow: id, ...document } },
      },
    ],
  };
};
