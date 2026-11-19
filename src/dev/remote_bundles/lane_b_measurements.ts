/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';
import { nearestRank } from './load_statistics';
import { startLaneBSandboxFixture } from './lane_b_sandbox_fixture';
import { createLaneBWorkflow, type LaneBFamily } from './lane_b_workflows';

interface Hit<T> {
  _id: string;
  _source: T;
}
interface Search<T> {
  hits: { hits: Array<Hit<T>> };
}
interface ExecutionResult {
  workflowExecutionId: string;
  engineDurationMs?: number;
  observedDurationMs: number;
}
interface Execution {
  status: string;
  error?: object;
  duration?: number;
}
interface Case {
  id: string;
  title: string;
  comments?: Array<{ id: string; comment?: string }>;
}
interface Output {
  text?: string;
  blocks?: Array<{ type: string; elements?: Array<{ url?: string }> }>;
  _id?: string;
  case?: Case;
  cases?: Case[];
  content?: string;
  category?: string;
  note_id?: string;
  notes?: Array<{ note_id: string; text: string }>;
  reviews?: Array<{ title: string }>;
  attachments?: Array<{ id: string; active: boolean }>;
  version?: number;
  success?: boolean;
}
interface Step {
  stepId: string;
  output: Output;
}
interface ProcessSample {
  event: string;
  at: number;
  pid: number;
  ppid: number;
  argv: string[];
  memory: { rss: number; heapUsed: number };
  cpu: { user: number; system: number };
}
interface Seam {
  name: string;
  bytes: number;
}
interface AuthorizationRead {
  event: string;
  stepType: string;
  durationMs: number;
  cpuMicros: number;
}
interface Cell {
  backend: 'baseline' | 'child_process' | 'in_process';
  delayMs: number;
  memory: boolean;
}
const headers = {
  authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`,
  'kbn-xsrf': 'true',
  'content-type': 'application/json',
};
const es = 'http://127.0.0.1:9235';
const kibana = 'http://127.0.0.1:5635';
const api = async <T>(path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> => {
  const response = await fetch(path.startsWith('http') ? path : `${kibana}${path}`, {
    headers,
    method,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  assert(response.ok, `${response.status} ${path}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
};
const lines = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T)
    : [];
const save = (file: string, value: object) => writeFileSync(file, JSON.stringify(value, null, 2));
const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(250);
  }
  throw new Error(`Owned Kibana ${child.pid} did not stop; inspect before continuing`);
};

const memorySnapshot = async (directory: string, coordinatorPid: number): Promise<object> => {
  const samples = readdirSync(directory)
    .filter((file) => /^process-\d+\.jsonl$/.test(file))
    .flatMap((file) => lines<ProcessSample>(join(directory, file)).slice(-1));
  const owned = samples.filter(
    ({ pid, ppid }) => pid === coordinatorPid || ppid === coordinatorPid
  );
  const after = Date.now();
  for (const { pid } of owned) process.kill(pid, 'SIGUSR2');
  const acknowledged: ProcessSample[] = [];
  for (const { pid } of owned) {
    let latest: ProcessSample | undefined;
    for (let attempt = 0; attempt < 300; attempt++) {
      latest = lines<ProcessSample>(join(directory, `process-${pid}.jsonl`)).findLast(
        (sample) => sample.event === 'gc' && sample.at >= after
      );
      if (latest) break;
      await delay(10);
    }
    assert(latest, `Post-GC sample not acknowledged by owned PID ${pid}`);
    acknowledged.push(latest);
  }
  assert(
    acknowledged.some(({ pid }) => pid === coordinatorPid),
    'Missing Kibana memory sample'
  );
  return {
    at: after,
    processes: acknowledged,
    combinedRss: acknowledged.reduce((total, sample) => total + sample.memory.rss, 0),
    combinedHeap: acknowledged.reduce((total, sample) => total + sample.memory.heapUsed, 0),
  };
};

const execute = async (
  family: LaneBFamily,
  id: string,
  directory: string
): Promise<ExecutionResult> => {
  const started = performance.now();
  const { workflowExecutionId } = await api<{ workflowExecutionId: string }>(
    `/api/workflows/workflow/${id}/run`,
    { inputs: {} }
  );
  let execution: Execution | undefined;
  for (let attempt = 0; attempt < 1200; attempt++) {
    const result = await api<Search<Execution>>(`${es}/.workflows-executions*/_search`, {
      query: { ids: { values: [workflowExecutionId] } },
    });
    execution = result.hits.hits[0]?._source;
    if (execution && ['completed', 'failed', 'cancelled', 'timed_out'].includes(execution.status))
      break;
    await delay(100);
  }
  const observedDurationMs = performance.now() - started;
  save(join(directory, `${workflowExecutionId}-execution.json`), { execution, observedDurationMs });
  assert.equal(execution?.status, 'completed', JSON.stringify(execution?.error));
  await api(`${es}/.workflows-step-executions*/_refresh`, undefined, 'POST');
  const result = await api<Search<Step>>(`${es}/.workflows-step-executions*/_search`, {
    size: 100,
    query: { term: { workflowRunId: workflowExecutionId } },
  });
  save(join(directory, `${workflowExecutionId}-steps.json`), result);
  const step = (name: string): Output => {
    const found = result.hits.hits.find(({ _source }) => _source.stepId === name);
    assert(found, `Missing ${name} output`);
    return found._source.output;
  };
  const persisted = await api<{
    _source: {
      modelContext?: string;
      sandboxId?: string;
      selectedModel?: string;
      slackText?: string;
      startedText?: string;
      failedText?: string;
      agentId?: string;
      reinforcementAgentId?: string;
      treeCount?: string;
      treeMessage?: string;
      turnKind?: string;
      skipReason?: string;
      recalledId?: string;
      message?: string;
      tokens?: string;
      caseId?: string;
      conversationId?: string;
      status?: string;
      summary?: string;
      content?: string;
      previousContent?: string;
      version?: string;
      deleted?: string;
      first?: string;
      second?: string;
      tail?: string;
      retained?: string;
      entityId?: string;
      prompt?: string;
      category?: string;
    };
  }>(`${es}/lane-b-quiet-outcomes/_doc/${step('persist')._id}`);
  save(join(directory, `${workflowExecutionId}-business.json`), persisted);
  if (family === 'nightshift_sandbox' || family === 'nightshift_tree_hydrate') {
    assert.equal(persisted._source.sandboxId, 'default__' + workflowExecutionId);
    assert.equal(persisted._source.conversationId, workflowExecutionId);
    if (family === 'nightshift_tree_hydrate') {
      assert.equal(persisted._source.treeCount, '1');
      const tree = await api<{ _source: { attributes: { tree_id: string; version: number } } }>(`${es}/ai-index-idx-nightshift-decision-trees/_doc/default:dtree_${id}`);
      assert.equal(tree._source.attributes.tree_id, 'symptom:' + id);
      assert.equal(tree._source.attributes.version, 2);
      save(join(directory, `${workflowExecutionId}-tree.json`), tree);
    }
  } else if (family === 'nightshift_render') {
    const { slackText } = persisted._source;
    assert(slackText);
    assert(slackText?.startsWith('*' + id + '* — Investigation completed'));
    assert(slackText.includes('Severity: High'));
    assert(slackText.includes(id + ' &lt;verified&gt;'));
    assert(persisted._source.startedText?.includes('Investigation started'));
    assert(persisted._source.failedText?.includes('Failure &lt;fixture&gt;'));
    const url = step('render').blocks?.find(({ type }) => type === 'actions')?.elements?.[0]?.url;
    assert(url);
    assert(url.startsWith(kibana + '/app/r?'));
    assert(slackText.includes(url));
    const conversation = await api<{
      _source: { metadata: { summary: string; severity: string } };
    }>(`${es}/.chat-conversations/_doc/${workflowExecutionId}`);
    assert.equal(conversation._source.metadata.summary, id + ' <verified>');
    assert.equal(conversation._source.metadata.severity, 'high');
    await api(`/api/agent_builder/conversations/${workflowExecutionId}`);
    save(join(directory, `${workflowExecutionId}-render-conversation.json`), conversation);
  } else if (family === 'nightshift_agents') {
    assert.equal(persisted._source.agentId, 'nightshift.investigation');
    assert.equal(
      persisted._source.reinforcementAgentId,
      'significant-events.decision-tree-reinforcement'
    );
    const agent = await api<{ id: string }>(
      `/api/agent_builder/agents/${persisted._source.agentId}`
    );
    const reinforcement = await api<{ id: string }>(
      `/api/agent_builder/agents/${persisted._source.reinforcementAgentId}`
    );
    assert.equal(agent.id, persisted._source.agentId);
    assert.equal(reinforcement.id, persisted._source.reinforcementAgentId);
    save(join(directory, `${workflowExecutionId}-agents.json`), { agent, reinforcement });
  } else if (family === 'nightshift_trees') {
    assert.equal(persisted._source.treeCount, '1');
    assert.equal(persisted._source.turnKind, 'feedback_reinforcement');
    assert(persisted._source.treeMessage?.includes('Verified learning ' + id));
    assert(persisted._source.treeMessage?.includes(`decision_tree_${id}.md`));
    const tree = await api<{ _source: { attributes: { tree_id: string; version: number } } }>(
      `${es}/ai-index-idx-nightshift-decision-trees/_doc/default:dtree_${id}`
    );
    assert.equal(tree._source.attributes.tree_id, 'symptom:' + id);
    assert.equal(tree._source.attributes.version, 2);
    save(join(directory, `${workflowExecutionId}-tree.json`), tree);
  } else if (family === 'nightshift_model') {
    const workflow = await api<{ yaml: string }>(`/api/workflows/workflow/${id}`);
    const definition: { steps: Array<{ with?: { connector_id?: string } }> } = parse(workflow.yaml);
    assert.equal(persisted._source.selectedModel, definition.steps[0].with?.connector_id);
  } else if (family === 'nightshift_recovery') {
    assert.equal(persisted._source.skipReason, 'no_open_investigation');
  } else if (family === 'nightshift') {
    assert.equal(
      persisted._source.modelContext,
      `<system_update>\n${id}\n\nMaterialization of /workspace/cortex/ encountered an error; its contents may be incomplete or missing.\n</system_update>`
    );
    assert.equal(persisted._source.recalledId, id);
  } else if (family === 'agent') {
    assert.equal(persisted._source.message, 'Lane B verified response');
    assert.equal(persisted._source.conversationId, workflowExecutionId);
    const conversation = await api<{
      _source: { events: Array<{ type: string; data: { message?: string } }> };
    }>(`${es}/.chat-conversations/_doc/${workflowExecutionId}`);
    assert(
      conversation._source.events.some(
        ({ type, data }) => type === 'user_message' && data.message === id
      )
    );
    assert(conversation._source.events.some(({ type }) => type === 'execution_terminated'));
    await api(`/api/agent_builder/conversations/${workflowExecutionId}`);
    await delay(1100); // Original execution store refresh interval; no restricted-index admin privilege.
    const executions = await api<
      Search<{ status: string; agent_params: { workflowExecutionId: string } }>
    >(`${es}/.chat-agent-executions/_search`, {
      query: { term: { 'metadata.laneBRun': workflowExecutionId } },
      _source: ['status', 'agent_params.workflowExecutionId', 'space_id', 'metadata'],
    });
    assert.equal(executions.hits.hits.length, 1);
    assert.equal(
      executions.hits.hits[0]._source.agent_params.workflowExecutionId,
      workflowExecutionId
    );
    assert.equal(executions.hits.hits[0]._source.status, 'completed');
    save(join(directory, `${workflowExecutionId}-agent.json`), { conversation, executions });
  } else if (family === 'cases') {
    const caseId = step('create').case?.id;
    assert(caseId);
    const current = await api<Case>(`/api/cases/${caseId}`);
    assert.equal(current.title, `${id} updated`);
    assert(step('find').cases?.some(({ id: foundId }) => foundId === caseId));
    const attachment = step('attach').case?.comments?.find(({ comment }) => comment === id);
    assert(attachment);
    const comment = await api<{ comment: string }>(
      `/api/cases/${caseId}/comments/${attachment.id}`
    );
    assert.equal(comment.comment, id);
    const actions = await api<{
      userActions: Array<{ source?: { type: string; id: string; name?: string; run_id?: string } }>;
      total: number;
    }>(`/api/cases/${caseId}/user_actions/_find?perPage=100&page=1`);
    save(join(directory, `${workflowExecutionId}-case.json`), { current, comment, actions });
    assert.equal(actions.userActions.length, actions.total);
    assert(actions.total >= 3, 'Expected original create, update and comment audit actions');
    for (const action of actions.userActions) {
      assert.deepEqual(action.source, {
        type: 'workflow',
        id,
        name: id,
        run_id: workflowExecutionId,
      });
    }
    assert.equal(persisted._source.caseId, caseId);
  } else if (family === 'rerank') {
    assert.equal(persisted._source.first, 'Second');
    assert.equal(persisted._source.second, 'First');
    assert.equal(persisted._source.tail, 'Tail');
    assert.equal(persisted._source.retained, '2');
    const fakeRequests = lines<{ query: string; texts: string[] }>(
      join(directory, '..', 'rerank-fake-requests.jsonl')
    ).filter(({ query }) => query === id);
    assert(
      fakeRequests.length > 0,
      'The original rerank handler must reach the real ES inference endpoint and local fake'
    );
    for (const request of fakeRequests) assert.deepEqual(request.texts, ['First', 'Second']);
    save(join(directory, `${workflowExecutionId}-rerank-requests.json`), fakeRequests);
  } else if (family === 'attachments') {
    const conversationId = persisted._source.conversationId;
    assert(conversationId);
    assert.equal(persisted._source.content, `${id} updated`);
    assert.equal(persisted._source.previousContent, id);
    assert.equal(persisted._source.version, '2');
    assert.equal(persisted._source.deleted, 'true');
    assert.equal(step('read').version, 2);
    assert.equal(step('delete').success, true);
    assert.equal(step('list').attachments?.length, 2);
    assert(
      step('deleted').attachments?.some(
        ({ id: attachmentId, active }) => attachmentId === 'text' && !active
      )
    );
    await api(`/api/agent_builder/conversations/${conversationId}`);
    const stored = await api<{
      _source: {
        attachments: Array<{
          id: string;
          type: string;
          active: boolean;
          readonly: boolean;
          current_version: number;
          origin?: string;
          versions: Array<{
            version: number;
            data: { content?: string; workflowId?: string; yaml?: string };
          }>;
        }>;
        events: Array<{ type: string }>;
      };
    }>(`${es}/.chat-conversations/_doc/${conversationId}`);
    const text = stored._source.attachments.find(({ id: attachmentId }) => attachmentId === 'text');
    assert(text);
    assert.equal(text.current_version, 2);
    assert.equal(text.active, false);
    assert.deepEqual(
      text.versions.map(({ data }) => data.content),
      [id, `${id} updated`]
    );
    const reference = stored._source.attachments.find(
      ({ id: attachmentId }) => attachmentId === 'workflow-reference'
    );
    assert(reference);
    assert.equal(reference.origin, id);
    assert.equal(reference.readonly, true);
    assert.equal(reference.versions[0].data.workflowId, id);
    assert(reference.versions[0].data.yaml?.includes(id));
    assert(stored._source.events.some(({ type }) => type === 'attachment_added'));
    assert(stored._source.events.some(({ type }) => type === 'attachment_updated'));
    assert(stored._source.events.some(({ type }) => type === 'attachment_deleted'));
    save(join(directory, `${workflowExecutionId}-attachments.json`), stored);
  } else if (family === 'conversation') {
    const conversationId = persisted._source.conversationId;
    assert(conversationId);
    assert.equal(persisted._source.status, 'closed');
    assert.equal(persisted._source.summary, id);
    await api(`/api/agent_builder/conversations/${conversationId}`);
    const stored = await api<{
      _source: { events: Array<{ type: string; data: { text?: string; message?: string } }> };
    }>(`${es}/.chat-conversations/_doc/${conversationId}`);
    assert(
      stored._source.events.some((event) => event.type === 'text_note' && event.data.text === id)
    );
    assert(
      stored._source.events.some(
        (event) => event.type === 'user_message' && event.data.message === id
      )
    );
    save(join(directory, `${workflowExecutionId}-conversation.json`), stored);
  } else if (family === 'extensions') {
    assert.equal(persisted._source.entityId, 'host:lane-b-host-id');
    assert.equal(step('fingerprints').reviews?.[0]?.title, id);
    assert(step('notes').notes?.some(({ note_id }) => note_id === step('note').note_id));
    await api(`${es}/ai-index-idx-security-attack-fingerprints/_refresh`, undefined, 'POST');
    const fingerprints = await api<Search<{ attributes: { space_id: string } }>>(
      `${es}/ai-index-idx-security-attack-fingerprints/_search`,
      { query: { term: { 'attributes.parent_run_id': workflowExecutionId } } }
    );
    save(join(directory, `${workflowExecutionId}-fingerprint.json`), fingerprints);
    assert.equal(fingerprints.hits.hits.length, 1, 'Must exercise a real fingerprint write');
    assert.equal(fingerprints.hits.hits[0]._source.attributes.space_id, 'default');
  } else {
    assert.equal(persisted._source.prompt, 'Lane B verified response');
    assert.equal(persisted._source.category, 'Security');
  }
  return { workflowExecutionId, engineDurationMs: execution.duration, observedDurationMs };
};

/** Runs serial, isolated lane-B functional/memory profiles and uninstrumented cold/warm timing cells. */
export const runLaneBMeasurements = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(name) + 1];
  assert(
    args.includes('--config') && args.includes('--output'),
    'Required: --config FILE --output NEW_DIRECTORY [--smoke]'
  );
  const output = resolve(option('--output'));
  assert(!existsSync(output), 'Output directory must be new, preserving failed attempts');
  const base: Record<string, object | string | number | boolean> = parse(
    readFileSync(resolve(option('--config')), 'utf8')
  );
  assert.equal(base['server.port'], 5635);
  assert.deepEqual(base['elasticsearch.hosts'], [es]);
  assert.equal(
    base['xpack.alertzero.enabled'],
    true,
    'Original fingerprint nested-template installer must be enabled'
  );
  assert(
    typeof base['path.data'] === 'string' &&
      resolve(base['path.data']).startsWith(`${resolve('.scratch')}/`)
  );
  // Refuse an existing listener. This command never signals somebody else's stack.
  await new Promise<void>((done, reject) => {
    const check = createServer();
    check.once('error', reject);
    check.listen(5635, '127.0.0.1', () => check.close((error) => (error ? reject(error) : done())));
  });
  await api(`${es}/_cluster/health`);
  mkdirSync(output, { recursive: true });
  const smoke = args.includes('--smoke');
  assert(!args.includes('--families') || smoke, '--families requires --smoke');
  save(join(output, 'identity.json'), {
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    configSha256: createHash('sha256')
      .update(readFileSync(resolve(option('--config'))))
      .digest('hex'),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    machine: execFileSync('uname', ['-a'], { encoding: 'utf8' }).trim(),
    contention: execFileSync('ps', ['-axo', 'pid,ppid,%cpu,rss,comm'], { encoding: 'utf8' }),
    smoke,
    method:
      'Cold = fresh Kibana+worker process per family/block, including ordinary Kibana; warm = subsequent serial leases. Durations exclude independent proof GETs but observed polling is quantized100ms. Memory/CPU/seams are separate instrumented profiles, never timing headlines.',
  });
  const bundleDirectory = join(output, 'bundles');
  const bundle = await buildRemoteBundle({
    manifests: discoverRemoteManifests(process.cwd()),
    graph: {
      id: 'workflows',
      root: 'workflows.executor',
      dependencies: ['workflows.stepCatalog'],
      contributions: ['workflows.step', 'workflows.connector', 'core.savedObjects.types'],
    },
    sourceDigestKinds: ['core.savedObjects.types'],
    outdir: join(bundleDirectory, 'workflows'),
    reportingCeilingBytes: 14_000_000,
  });
  save(join(output, 'bundle.json'), bundle);
  const idleProbe = join(output, 'idle-probe.cjs');
  await build({
    entryPoints: [
      resolve(
        __dirname,
        '../../core/packages/remote/server-internal/src/__fixtures__/probe_bundle.ts'
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: idleProbe,
  });
  writeFileSync(
    join(output, 'idle-three-samples.json'),
    execFileSync(process.execPath, [idleProbe, join(bundleDirectory, 'workflows')], {
      encoding: 'utf8',
    })
  );
  const metrics = join(output, 'metrics.cjs');
  await build({
    entryPoints: [resolve(__dirname, 'lane_b_metrics.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: metrics,
  });
  for (const family of ['inference', 'cases', 'security_three', 'conversation']) {
    const probe = join(output, `${family}-probe.mjs`);
    await build({
      entryPoints: [resolve(__dirname, `__fixtures__/${family}_execution_probe.ts`)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    for (let index = 0; index < (smoke ? 1 : 3); index++) {
      writeFileSync(
        join(output, `${family}-first-use-${index}.json`),
        execFileSync(process.execPath, ['--expose-gc', probe, join(bundleDirectory, 'workflows')], {
          encoding: 'utf8',
        })
      );
    }
  }
  const fake = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body: {
      stream?: boolean;
      tools?: Array<{ function: { name: string } }>;
      texts?: string[];
      query?: string;
    } = JSON.parse(text || '{}');
    if (request.url === '/rerank') {
      assert(Array.isArray(body.texts));
      appendFileSync(join(output, 'rerank-fake-requests.jsonl'), `${JSON.stringify(body)}\n`);
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(
          body.texts
            .map((content, index) => ({ index, score: index + 0.1, text: content }))
            .reverse()
        )
      );
      return;
    }
    const isAgent = JSON.stringify(body).includes('lane-b-quiet-agent-');
    const tool = isAgent ? undefined : body.tools?.[0]?.function;
    const message = tool
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'lane-b-call',
              type: 'function',
              function: {
                name: tool.name,
                arguments: JSON.stringify({
                  category: 'Security',
                  rationale: 'Local fake response',
                }),
              },
            },
          ],
        }
      : { role: 'assistant', content: 'Lane B verified response' };
    const completion = {
      id: 'lane-b-fake',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    };
    if (!body.stream) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(completion));
      return;
    }
    response.setHeader('content-type', 'text/event-stream');
    response.write(
      `data: ${JSON.stringify({
        ...completion,
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              ...message,
              tool_calls: message.tool_calls?.map((call, index) => ({ ...call, index })),
            },
            finish_reason: null,
          },
        ],
      })}\n\n`
    );
    response.end(
      `data: ${JSON.stringify({
        ...completion,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: completion.choices[0].finish_reason }],
      })}\n\ndata: [DONE]\n\n`
    );
  });
  const sandbox = args.includes('--sandbox-stat-fixture')
    ? await startLaneBSandboxFixture(join(output, 'sandbox-stat-requests.jsonl'))
    : undefined;
  let child: ChildProcess | undefined;
  let endpointCreated = false;
  let rerankEndpointCreated = false;
  const endpoint = `lane-b-quiet-${Date.now()}`;
  try {
    await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
    const address = fake.address();
    assert(address && typeof address !== 'string');
    await api(
      `${es}/_inference/chat_completion/${endpoint}`,
      {
        service: 'openai',
        service_settings: {
          api_key: 'fake',
          model_id: 'gpt-4o',
          url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        },
      },
      'PUT'
    );
    endpointCreated = true;
    await api(
      `${es}/_inference/rerank/${endpoint}-rerank`,
      {
        service: 'hugging_face',
        service_settings: { api_key: 'fake', url: `http://127.0.0.1:${address.port}/rerank` },
      },
      'PUT'
    );
    rerankEndpointCreated = true;
    const timingCells: Cell[] = [
      { backend: 'baseline', delayMs: 0, memory: false },
      ...[0, 1, 5, 30].map((delayMs) => ({
        backend: 'child_process' as const,
        delayMs,
        memory: false,
      })),
    ];
    const memoryCells: Cell[] = (['baseline', 'child_process', 'in_process'] as const).map(
      (backend) => ({ backend, delayMs: 0, memory: true })
    );
    const runs: Array<{
      family: LaneBFamily;
      profile: string;
      cold: boolean;
      engineDurationMs?: number;
    }> = [];
    for (const cell of smoke ? memoryCells : [...timingCells, ...memoryCells]) {
      const families: LaneBFamily[] =
        cell.memory || cell.delayMs === 0
          ? [
              'extensions',
              'cases',
              'inference',
              'conversation',
              'attachments',
              'rerank',
              'agent',
              'nightshift',
              'nightshift_model',
              'nightshift_recovery',
              'nightshift_trees',
              'nightshift_agents',
              'nightshift_render',
              'nightshift_sandbox',
              'nightshift_tree_hydrate',
            ]
          : ['extensions', 'cases'];
      const selectedFamilies = args.includes('--families')
        ? option('--families').split(',')
        : families;
      assert(
        selectedFamilies.every((family) => families.includes(family as LaneBFamily)),
        'Unknown or unavailable family'
      );
      const requestedFamilies = families.filter((family) => selectedFamilies.includes(family));
      const groups = cell.memory
        ? [requestedFamilies]
        : requestedFamilies.map((family) => [family]);
      for (const group of groups)
        for (let block = 0; block < (cell.memory || smoke ? 1 : 3); block++) {
          const profile = `${cell.memory ? 'memory' : 'timing'}-${cell.backend}-${
            cell.delayMs
          }-${group.join('-')}-${block}`;
          const directory = join(output, profile);
          mkdirSync(directory);
          writeFileSync(
            join(directory, 'machine-before.txt'),
            execFileSync('ps', ['-axo', 'pid,ppid,%cpu,rss,comm'], { encoding: 'utf8' })
          );
          const configFile = join(directory, 'kibana.yml');
          writeFileSync(
            configFile,
            stringify({
              ...base,
              ...(args.includes('--sandbox-config-fixture')
                ? {
                    // Prepare reads tree stores only. This config enables its original availability gate;
                    // the fixture is NOT a sandbox API and cannot prove allocation or filesystem I/O.
                    'xpack.sandbox.enabled': true,
                    'xpack.sandbox.host': '127.0.0.1',
                    'xpack.sandbox.port': address.port,
                    'xpack.sandbox.api_key': 'lane-b-configuration-only-fixture',
                  }
                : {}),
              ...(sandbox
                ? {
                    'xpack.sandbox.enabled': true,
                    'xpack.sandbox.host': 'localhost',
                    'xpack.sandbox.port': sandbox.port,
                    'xpack.sandbox.api_key': 'lane-b-stat-only-fixture',
                    'xpack.sandbox.ssl.certificate_authorities': sandbox.caPath,
                  }
                : {}),
              'workflowsExecutionEngine.remoteExecution.enabled': cell.backend !== 'baseline',
              'core.remote.backend': cell.backend === 'baseline' ? 'child_process' : cell.backend,
            })
          );
          const hook = join(directory, 'preload.cjs');
          writeFileSync(
            hook,
            `require(${JSON.stringify(metrics)}).installLaneBMetrics(${JSON.stringify(
              directory
            )});\n`
          );
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            KBN_REMOTE_BUNDLE_DIR: bundleDirectory,
            KBN_RUNNER_ES_NODE: es,
            KBN_RUNNER_INTERNAL_HEADERS: JSON.stringify({
              authorization: `Basic ${Buffer.from('kibana_system:changeme').toString('base64')}`,
            }),
            KBN_REMOTE_MESSAGE_DELAY_MS: String(cell.delayMs),
          };
          // Never inherit an earlier profile's instrumentation into an uninstrumented timing cell.
          for (const key of [
            'NODE_OPTIONS',
            'KBN_REMOTE_LOAD_HOOK',
            'KBN_REMOTE_EXPOSE_GC',
            'KBN_REMOTE_HEAP_LOG',
            'KBN_REMOTE_TIMING_LOG',
            'KBN_REMOTE_SEAM_LOG',
            'KBN_REMOTE_MODULE_LOG',
            'KBN_REMOTE_WIRE_LOG',
          ])
            delete env[key];
          if (cell.memory)
            Object.assign(env, {
              NODE_OPTIONS: `--require=${hook}`,
              KBN_REMOTE_LOAD_HOOK: hook,
              KBN_REMOTE_EXPOSE_GC: 'true',
              KBN_REMOTE_HEAP_LOG: join(directory, 'heaps.jsonl'),
              KBN_REMOTE_TIMING_LOG: join(directory, 'timing.jsonl'),
              KBN_REMOTE_SEAM_LOG: join(directory, 'seams.jsonl'),
            });
          const log = openSync(join(directory, 'kibana.log'), 'a');
          child = spawn(
            process.execPath,
            [
              ...(cell.memory ? ['--expose-gc'] : []),
              'scripts/kibana',
              '--no-base-path',
              '--no-watch',
              '--config',
              configFile,
            ],
            { env, stdio: ['ignore', log, log] }
          );
          closeSync(log);
          assert(child.pid);
          save(join(directory, 'owner.json'), { pid: child.pid, profile, cell });
          let ready = false;
          for (let attempt = 0; attempt < 240; attempt++) {
            assert(
              child.exitCode === null && child.signalCode === null,
              'Owned Kibana exited before readiness'
            );
            try {
              const status = await api<{ status: { overall: { level: string } } }>('/api/status');
              ready = status.status.overall.level === 'available';
            } catch {
              /* Startup may not listen yet. */
            }
            if (ready) break;
            await delay(1000);
          }
          assert(ready, 'Kibana did not become available');
          await api(
            `${es}/.alerts-security.alerts-default/_doc/lane-b-native-alert?refresh=true`,
            {
              '@timestamp': new Date().toISOString(),
              host: { id: 'lane-b-host-id', name: 'lane-b-worker-host' },
            },
            'PUT'
          );
          for (const family of group) {
            const id = `lane-b-quiet-${family.replaceAll('_', '-')}-${Date.now()}`;
            if (family === 'nightshift_trees' || family === 'nightshift_tree_hydrate') {
              const index = es + '/ai-index-idx-nightshift-decision-trees/_doc/';
              await api(
                index + 'default:dtree_' + id + '?refresh=true',
                {
                  '@timestamp': new Date().toISOString(),
                  type: 'decision_tree',
                  title: id,
                  content: '# Verified tree',
                  tags: ['nightshift', 'decision-tree'],
                  learnings: [],
                  attributes: {
                    space_id: 'default',
                    tree_id: 'symptom:' + id,
                    symptom: id,
                    version: 2,
                    status: 'established',
                  },
                },
                'PUT'
              );
              await api(
                index + 'default:dtree_learning_' + id + '?refresh=true',
                {
                  '@timestamp': new Date().toISOString(),
                  type: 'decision_tree_learning',
                  title: 'Verified learning',
                  kind: 'remediation',
                  tree_id: 'symptom:' + id,
                  content: 'Verified learning ' + id,
                  keywords: [],
                  tags: ['nightshift', 'decision-tree', 'learning'],
                  attributes: { space_id: 'default', tree_id: 'symptom:' + id },
                },
                'PUT'
              );
            }
            const definition = createLaneBWorkflow(family, id, endpoint);
            await api('/api/workflows/workflow', { id, yaml: stringify(definition) });
            if (cell.memory)
              appendFileSync(
                join(directory, 'memory-curve.jsonl'),
                `${JSON.stringify({
                  family,
                  phase: 'before',
                  sample: await memorySnapshot(directory, child.pid),
                })}\n`
              );
            for (let repeat = 0; repeat < (smoke ? 2 : 6); repeat++) {
              const before = lines<Seam>(join(directory, 'seams.jsonl')).length;
              const timingBefore = lines<AuthorizationRead>(join(directory, 'timing.jsonl')).length;
              const result = await execute(family, id, directory);
              if (family === 'nightshift_sandbox' || family === 'nightshift_tree_hydrate') {
                assert(sandbox, 'Allocation proof requires --sandbox-stat-fixture');
                const requests = lines<{
                  operation: string;
                  conversationId: string;
                  files?: Array<{ path: string; content: string }>;
                }>(join(output, 'sandbox-stat-requests.jsonl'));
                assert.equal(
                  requests.filter(
                    ({ operation, conversationId }) =>
                      operation === 'stat' &&
                      conversationId === 'default__' + result.workflowExecutionId
                  ).length,
                  1
                );
              }
              if (family === 'nightshift_tree_hydrate') {
                const requests = lines<{
                  operation: string;
                  conversationId: string;
                  files?: Array<{ path: string; content: string }>;
                }>(join(output, 'sandbox-stat-requests.jsonl'));
                const written = requests.filter(
                  ({ operation, conversationId }) =>
                    operation === 'write' &&
                    conversationId === 'default__' + result.workflowExecutionId
                );
                assert.equal(written.length, 1);
                assert(
                  written[0].files?.some(({ content }) => content.includes('# Verified tree'))
                );
              }
              const authorizationReads = lines<AuthorizationRead>(join(directory, 'timing.jsonl'))
                .slice(timingBefore)
                .filter(({ event }) => event === 'conversation_authorization_read');
              if (cell.memory && cell.backend !== 'baseline') {
                if (family === 'conversation') assert.equal(authorizationReads.length, 6);
                if (family === 'attachments') assert.equal(authorizationReads.length, 10);
              }
              const requests = lines<Seam>(join(directory, 'seams.jsonl'))
                .slice(before)
                .filter(
                  ({ name }) => name.endsWith('.request') && name !== 'WorkflowExecutor.run.request'
                );
              const callbacks = Object.fromEntries(
                [...new Set(requests.map(({ name }) => name))].map((name) => [
                  name,
                  requests.filter((request) => request.name === name).length,
                ])
              );
              if (cell.memory && cell.backend !== 'baseline')
                assert(
                  !requests.some(({ name }) => name.includes('WorkflowStepRunner.invoke')),
                  'Unexpected generic coordinator handler'
                );
              const row = {
                ...result,
                family,
                profile,
                cold: repeat === 0,
                callbacks,
                conversationAuthorizationReads: authorizationReads,
                callbackPayloadBytes: requests.reduce((total, request) => total + request.bytes, 0),
              };
              runs.push(row);
              appendFileSync(join(output, 'runs.jsonl'), `${JSON.stringify(row)}\n`);
              if (cell.memory)
                appendFileSync(
                  join(directory, 'memory-curve.jsonl'),
                  `${JSON.stringify({
                    family,
                    repeat,
                    sample: await memorySnapshot(directory, child.pid),
                  })}\n`
                );
            }
          }
          writeFileSync(
            join(directory, 'machine-after.txt'),
            execFileSync('ps', ['-axo', 'pid,ppid,%cpu,rss,comm'], { encoding: 'utf8' })
          );
          await stop(child);
          child = undefined;
        }
    }
    const summaries = [
      ...new Set(
        runs
          .filter(({ profile }) => profile.startsWith('timing'))
          .map(({ profile, family }) => `${profile.replace(/-\d+$/, '')}/${family}`)
      ),
    ].map((key) => {
      const matched = runs.filter(
        ({ profile, family }) => `${profile.replace(/-\d+$/, '')}/${family}` === key
      );
      return {
        key,
        cold: [true, false].map((cold) => {
          const values = matched
            .filter((run) => run.cold === cold)
            .map(({ engineDurationMs }) => {
              assert(Number.isFinite(engineDurationMs));
              return engineDurationMs as number;
            });
          return {
            cold,
            count: values.length,
            medianMs: nearestRank(values, 0.5),
            minMs: Math.min(...values),
            maxMs: Math.max(...values),
          };
        }),
      };
    });
    save(join(output, 'summary.json'), {
      smoke,
      finalTimingClaims: false,
      summaries,
      note: 'Inspect raw spread/machine contention before accepting stable medians. Memory+CPU files are process-wide;100ms samples do not prove synchronized transient peaks. No new SO capability implemented.',
    });
  } finally {
    try {
      if (child) await stop(child);
    } finally {
      if (sandbox) await sandbox.close();
      fake.closeAllConnections();
      await new Promise<void>((done) => fake.close(() => done()));
      try {
        if (endpointCreated)
          await api(`${es}/_inference/${endpoint}?force=true`, undefined, 'DELETE');
      } finally {
        if (rerankEndpointCreated)
          await api(`${es}/_inference/${endpoint}-rerank?force=true`, undefined, 'DELETE');
      }
    }
  }
};
