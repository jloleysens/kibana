/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export type LaneBFamily =
  | 'extensions'
  | 'cases'
  | 'inference'
  | 'conversation'
  | 'attachments'
  | 'rerank'
  | 'agent'
  | 'nightshift'
  | 'nightshift_model'
  | 'nightshift_recovery'
  | 'nightshift_trees'
  | 'nightshift_agents'
  | 'nightshift_render'
  | 'nightshift_sandbox'
  | 'nightshift_tree_hydrate'
  | 'nightshift_cortex_hydrate'
  | 'nightshift_memory_hydrate'
  | 'nightshift_reinforce'
  | 'nightshift_notifications'
  | 'nightshift_failure'
  | 'nightshift_trigger'
  | 'nightshift_cortex_optimize'
  | 'nightshift_memory_optimize';

/** Uses the same original business steps for ordinary Kibana and each worker backend. */
export const createLaneBWorkflow = (family: LaneBFamily, id: string, endpoint: string) => {
  const steps = {
    nightshift_cortex_optimize: [
      {
        name: 'optimize',
        type: 'nightshift.cortexOptimize',
        with: {
          agent_id: 'nightshift.investigation',
          connector_id: endpoint,
          prompt: 'lane-b-optimize-' + id,
          response: 'Verified optimizer observation ' + id,
          tool_calls: [0, 1, 2].map((index) => ({
            tool_id: 'nightshift_sandbox_bash',
            tool_call_id: 'evidence-' + index,
            params: { command: 'cat /tmp/verified-evidence' },
          })),
          tool_results: [0, 1, 2].map((index) => ({
            tool_call_id: 'evidence-' + index,
            results: [{ type: 'other', data: { stdout: 'Verified optimizer observation ' + id } }],
          })),
        },
      },
    ],
    nightshift_memory_optimize: [
      {
        name: 'optimize',
        type: 'nightshift.memoryOptimize',
        with: {
          agent_id: 'nightshift.investigation',
          connector_id: endpoint,
          prompt: 'lane-b-optimize-' + id,
          response: 'Verified optimizer observation ' + id,
          tool_calls: [0, 1, 2].map((index) => ({
            tool_id: 'nightshift_sandbox_bash',
            tool_call_id: 'evidence-' + index,
            params: { command: 'cat /tmp/verified-evidence' },
          })),
          tool_results: [0, 1, 2].map((index) => ({
            tool_call_id: 'evidence-' + index,
            results: [{ type: 'other', data: { stdout: 'Verified optimizer observation ' + id } }],
          })),
        },
      },
    ],

    nightshift_notifications: [
      {
        name: 'trigger',
        type: 'nightshift.triggerInvestigation',
        with: {
          subject_type: 'manual',
          subject_id: id,
          message: 'lane-b-quiet-agent-' + id,
          trigger_type: 'manual',
          notificationDestinations: [
            { type: 'slack', connector_id: 'lane-b-notifications', params: { channel: 'C123' } },
          ],
        },
      },
    ],
    nightshift_failure: [
      {
        name: 'trigger',
        type: 'nightshift.triggerInvestigation',
        with: {
          subject_type: 'manual',
          subject_id: id,
          message: 'lane-b-quiet-agent-failure-' + id,
          trigger_type: 'manual',
          notificationDestinations: [
            { type: 'slack', connector_id: 'lane-b-notifications', params: { channel: 'C123' } },
          ],
        },
      },
    ],
    nightshift_trigger: [
      {
        name: 'trigger',
        type: 'nightshift.triggerInvestigation',
        with: {
          subject_type: 'manual',
          subject_id: id,
          message: 'lane-b-quiet-agent-' + id,
          trigger_type: 'manual',
        },
      },
    ],
    nightshift_reinforce: [
      {
        name: 'ensure',
        type: 'nightshift.ensureInvestigationAgent',
        with: { agent_id: 'significant-events.decision-tree-reinforcement' },
      },
      {
        name: 'reinforce',
        type: 'nightshift.decisionTreeReinforce',
        with: {
          prompt: 'lane-b-quiet-agent-' + id,
          response: 'Observed pool saturation.',
          message: 'lane-b-quiet-agent-' + id + ': summarize the completed round without tools.',
          turn_kind: 'feedback_reinforcement',
          connector_id: endpoint,
          tool_calls: [
            {
              tool_id: 'nightshift_sandbox_view_file',
              tool_call_id: 'read',
              params: { file_path: '/workspace/evidence.txt' },
            },
          ],
          tool_results: [
            {
              tool_call_id: 'read',
              results: [
                { type: 'other', data: { stdout: 'Verified reinforcement evidence ' + id } },
              ],
            },
          ],
        },
      },
    ],
    nightshift_memory_hydrate: [
      {
        name: 'obtain',
        type: 'nightshift.obtainSandbox',
        with: { conversation_id: '{{ execution.id }}' },
      },
      {
        name: 'hydrate',
        type: 'nightshift.memoryMaterializeToSandbox',
        with: {
          sandbox_id: '{{ steps.obtain.output.sandbox_id }}',
          agent_id: 'nightshift.investigation',
          conversation_id: '{{ execution.id }}',
        },
      },
      {
        name: 'repeatHydrate',
        type: 'nightshift.memoryMaterializeToSandbox',
        with: {
          sandbox_id: '{{ steps.obtain.output.sandbox_id }}',
          agent_id: 'nightshift.investigation',
          conversation_id: '{{ execution.id }}',
        },
      },
    ],
    nightshift_cortex_hydrate: [
      {
        name: 'obtain',
        type: 'nightshift.obtainSandbox',
        with: { conversation_id: '{{ execution.id }}' },
      },
      {
        name: 'hydrate',
        type: 'nightshift.cortexHydrate',
        with: { sandbox_id: '{{ steps.obtain.output.sandbox_id }}' },
      },
    ],
    nightshift_tree_hydrate: [
      {
        name: 'obtain',
        type: 'nightshift.obtainSandbox',
        with: { conversation_id: '{{ execution.id }}' },
      },
      {
        name: 'hydrate',
        type: 'nightshift.decisionTreeHydrate',
        with: {
          sandbox_id: '{{ steps.obtain.output.sandbox_id }}',
          agent_id: 'nightshift.investigation',
          prompt: '<!-- nightshift-accessed-trees:' + id + ' -->',
        },
      },
    ],
    nightshift_sandbox: [
      {
        name: 'obtain',
        type: 'nightshift.obtainSandbox',
        with: { conversation_id: '{{ execution.id }}' },
      },
    ],
    nightshift_render: [
      {
        name: 'create',
        type: 'ai.conversation.create',
        with: {
          conversation_id: '{{ execution.id }}',
          title: id,
          template_id: 'investigation',
          access_control: { access_mode: 'public', entries: [] },
          metadata: { status: 'closed', summary: id + ' <verified>', severity: 'high' },
        },
      },
      ...(['completed', 'started', 'failed'] as const).map((phase) => ({
        name: phase === 'completed' ? 'render' : phase,
        type: 'nightshift.renderSlackMessage',
        with: {
          investigation_id: '{{ steps.create.output.conversation_id }}',
          phase,
          ...(phase === 'failed' ? { reason: 'Failure <fixture>' } : {}),
        },
      })),
    ],
    nightshift_agents: [
      { name: 'ensure', type: 'nightshift.ensureInvestigationAgent' },
      {
        name: 'ensureReinforcement',
        type: 'nightshift.ensureInvestigationAgent',
        with: { agent_id: 'significant-events.decision-tree-reinforcement' },
      },
    ],
    nightshift_trees: [
      {
        name: 'prepare',
        type: 'nightshift.decisionTreePrepare',
        with: {
          response: 'status: confirmed',
          agent_id: 'nightshift.investigation',
          tool_calls: [
            {
              tool_id: 'nightshift_sandbox_view_file',
              params: { file_path: `/workspace/decision-trees/decision_tree_${id}.md` },
            },
          ],
        },
      },
    ],
    nightshift_model: [
      {
        name: 'model',
        type: 'nightshift.resolveModel',
        with: { step: 'investigation', connector_id: endpoint },
      },
    ],
    nightshift_recovery: [
      {
        name: 'recover',
        type: 'nightshift.followUpRecoveredAlert',
        with: {
          alert_uuid: id,
          alert_id: id,
          rule_id: 'lane-b-rule',
          rule_name: 'Lane B rule',
          rule_type_id: 'lane-b-local',
        },
      },
    ],
    nightshift: [
      {
        name: 'compose',
        type: 'nightshift.composeHydrateNotifications',
        with: {
          writers: [
            { directory: '/workspace/memories', notification: id, completed: true },
            { directory: '/workspace/cortex', completed: false },
          ],
          recalled_ids: [id],
        },
      },
    ],
    agent: [
      {
        name: 'agent',
        type: 'ai.agent',
        'connector-id': endpoint,
        'create-conversation': true,
        'public-conversation': true,
        with: {
          message: id,
          conversation_id: '{{ execution.id }}',
          metadata: { laneBRun: '{{ execution.id }}' },
          configuration_overrides: { tools: [], skill_ids: [], enable_elastic_capabilities: false },
        },
      },
    ],
    rerank: [
      {
        name: 'rerank',
        type: 'search.rerank',
        inference_id: `${endpoint}-rerank`,
        with: {
          rerank_text: id,
          data: [
            { title: 'First', retained: 1 },
            { title: 'Second', retained: 2 },
            { title: 'Tail', retained: 3 },
          ],
          fields: [['title']],
          rank_window_size: 2,
          max_input_field_length: 10,
          max_input_total_length: 20,
        },
      },
    ],
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
    attachments: [
      {
        name: 'create',
        type: 'ai.conversation.create',
        with: {
          conversation_id: '{{ execution.id }}',
          title: id,
          access_control: { access_mode: 'public', entries: [] },
        },
      },
      {
        name: 'add',
        type: 'ai.attachment.add',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          id: 'text',
          type: 'text',
          data: { content: id },
        },
      },
      {
        name: 'reference',
        type: 'ai.attachment.add',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          id: 'workflow-reference',
          type: 'workflow.yaml',
          origin: id,
        },
      },
      {
        name: 'update',
        type: 'ai.attachment.update',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          attachment_id: 'text',
          data: { content: `${id} updated` },
        },
      },
      {
        name: 'read',
        type: 'ai.attachment.read',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          attachment_id: 'text',
        },
      },
      {
        name: 'history',
        type: 'ai.attachment.read',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          attachment_id: 'text',
          version: 1,
        },
      },
      {
        name: 'list',
        type: 'ai.attachment.list',
        with: { conversation_id: '{{ steps.create.output.conversation_id }}' },
      },
      {
        name: 'delete',
        type: 'ai.attachment.delete',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          attachment_id: 'text',
        },
      },
      {
        name: 'deleted',
        type: 'ai.attachment.list',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          include_deleted: true,
        },
      },
    ],
    conversation: [
      {
        name: 'create',
        type: 'ai.conversation.create',
        with: {
          conversation_id: '{{ execution.id }}',
          title: id,
          template_id: 'investigation',
          access_control: { access_mode: 'public', entries: [] },
        },
      },
      {
        name: 'patch',
        type: 'ai.conversation.metadata.patch',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          updates: { status: 'closed', summary: id },
        },
      },
      {
        name: 'event',
        type: 'ai.conversation.add_event',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          type: 'text_note',
          data: { text: id },
        },
      },
      {
        name: 'message',
        type: 'ai.conversation.add_user_message',
        with: {
          conversation_id: '{{ steps.create.output.conversation_id }}',
          message: id,
          author_name: 'Lane B workflow',
        },
      },
      {
        name: 'read',
        type: 'ai.conversation.metadata.read',
        with: { conversation_id: '{{ steps.create.output.conversation_id }}' },
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
    nightshift_cortex_optimize: { status: '{{ steps.optimize.output.status }}' },
    nightshift_memory_optimize: { status: '{{ steps.optimize.output.status }}' },
    nightshift_notifications: { conversationId: '{{ steps.trigger.output.investigation_id }}' },
    nightshift_failure: { conversationId: '{{ steps.trigger.output.investigation_id }}' },
    nightshift_trigger: { conversationId: '{{ steps.trigger.output.investigation_id }}' },
    nightshift_reinforce: { message: '{{ steps.reinforce.output.message }}' },
    nightshift_memory_hydrate: {
      sandboxId: '{{ steps.hydrate.output.sandbox_id }}',
      firstNotification: '{{ steps.hydrate.output.notification }}',
      secondNotification: '{{ steps.repeatHydrate.output.notification }}',
    },
    nightshift_cortex_hydrate: {
      sandboxId: '{{ steps.hydrate.output.sandbox_id }}',
      conversationId: '{{ steps.hydrate.output.conversation_id }}',
      notification: '{{ steps.hydrate.output.notification }}',
    },
    nightshift_tree_hydrate: {
      sandboxId: '{{ steps.hydrate.output.sandbox_id }}',
      treeCount: '{{ steps.hydrate.output.tree_count }}',
      conversationId: '{{ steps.hydrate.output.conversation_id }}',
    },
    nightshift_sandbox: {
      sandboxId: '{{ steps.obtain.output.sandbox_id }}',
      conversationId: '{{ steps.obtain.output.conversation_id }}',
    },
    nightshift_render: {
      slackText: '{{ steps.render.output.text }}',
      startedText: '{{ steps.started.output.text }}',
      failedText: '{{ steps.failed.output.text }}',
    },
    nightshift_agents: {
      agentId: '{{ steps.ensure.output.agent_id }}',
      reinforcementAgentId: '{{ steps.ensureReinforcement.output.agent_id }}',
    },
    nightshift_trees: {
      treeCount: '{{ steps.prepare.output.tree_count }}',
      treeMessage: '{{ steps.prepare.output.message }}',
      turnKind: '{{ steps.prepare.output.turn_kind }}',
    },
    nightshift_model: { selectedModel: '{{ steps.model.output.connector_id }}' },
    nightshift_recovery: { skipReason: '{{ steps.recover.output.skip_reason }}' },
    nightshift: {
      modelContext: '{{ steps.compose.output.model_context }}',
      recalledId:
        '{{ steps.compose.output.workflow_context["nightshift.semantic_memory.recall"].data.recalled_ids[0] }}',
    },
    agent: {
      conversationId: '{{ steps.agent.output.conversation_id }}',
      message: '{{ steps.agent.output.message }}',
      tokens: '{{ steps.agent.output.metadata.usage.totalTokens }}',
    },
    rerank: {
      first: '{{ steps.rerank.output[0].title }}',
      second: '{{ steps.rerank.output[1].title }}',
      tail: '{{ steps.rerank.output[2].title }}',
      retained: '{{ steps.rerank.output[0].retained }}',
    },
    attachments: {
      conversationId: '{{ steps.create.output.conversation_id }}',
      content: '{{ steps.read.output.data.content }}',
      previousContent: '{{ steps.history.output.data.content }}',
      version: '{{ steps.read.output.version }}',
      deleted: '{{ steps.delete.output.success }}',
    },
    conversation: {
      conversationId: '{{ steps.create.output.conversation_id }}',
      status: '{{ steps.read.output.metadata.status }}',
      summary: '{{ steps.read.output.metadata.summary }}',
    },
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
