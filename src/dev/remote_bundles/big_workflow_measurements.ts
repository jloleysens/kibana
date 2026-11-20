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
import { createServer, type Server } from 'node:http';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { stringify } from 'yaml';
import { defaultInferenceEndpoints } from '@kbn/inference-common';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';
import {
  BIG_WORKFLOW_ALERTS_INDEX,
  BIG_WORKFLOW_FINDINGS_INDEX,
  BIG_WORKFLOW_OUTCOMES_INDEX,
  bigWorkflowAlerts,
  createBigWorkflow,
  createBigWorkflowChild,
} from './big_workflow';
import { startLaneBNotificationsFixture } from './lane_b_notifications_fixture';
import { nearestRank } from './load_statistics';
import { memorySnapshot } from './lane_b_measurements';
import { createLaneBWorkflow } from './lane_b_workflows';

type Backend = 'baseline' | 'in_process' | 'child_process';
type Phase = 'green' | 'duration' | 'latency' | 'nightshift' | 'all';

const es = 'http://127.0.0.1:9235';
const kibana = 'http://127.0.0.1:5635';
const headers = {
  authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`,
  'kbn-xsrf': 'true',
  'content-type': 'application/json',
};
const backends: Backend[] = ['baseline', 'in_process', 'child_process'];
const backendSlug = (backend: Backend) => backend.replaceAll('_', '-');
const callbackEvents = new Set([
  'connector_prepare',
  'connector_finalize',
  'kibana_handler_complete',
  'kibana_http_first_use',
]);

const machine = () => ({
  at: new Date().toISOString(),
  loadavg: loadavg(),
  cpuCount: cpus().length,
  provisional: true,
});

const api = async <T>(path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> => {
  const response = await fetch(path.startsWith('http') ? path : `${kibana}${path}`, {
    headers,
    method,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  assert(response.ok, `${response.status} ${path}: ${text.slice(0, 800)}`);
  return (text ? JSON.parse(text) : {}) as T;
};

const save = (file: string, value: object) => writeFileSync(file, JSON.stringify(value, null, 2));
const lines = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T)
    : [];

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 160; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(250);
  }
  child.kill('SIGKILL');
};

const note = (output: string, message: string) => {
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(join(output, 'LOG.md'), line);
  const scratch = resolve('.scratch/big-workflow/LOG.md');
  mkdirSync(resolve('.scratch/big-workflow'), { recursive: true });
  appendFileSync(scratch, line);
  console.log(message);
};

const percentile = (values: number[], quantile: number): number | null =>
  values.length ? nearestRank(values, quantile) : null;

/** Drops ids, timestamps and durations so two completed runs can be compared. */
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return '<time>';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      return '<id>';
    if (/^\d+\.\d+$/.test(value)) return '<ts>';
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (
      key.endsWith('_millis') ||
      key.endsWith('_nanos') ||
      [
        'took',
        'timed_out',
        '_shards',
        '_seq_no',
        '_primary_term',
        'duration',
        'executionTimeMs',
        'startedAt',
        'finishedAt',
        'executedAt',
        'createdAt',
        'updatedAt',
        'headers',
        '_version',
        'version',
      ].includes(key)
    )
      continue;
    if (key === '_id' && (typeof entry !== 'string' || !entry.startsWith('alert-'))) {
      result[key] = '<id>';
      continue;
    }
    if (key === 'id' && typeof entry === 'string' && !entry.startsWith('alert-')) {
      result[key] = '<id>';
      continue;
    }
    result[key] = normalize(entry);
  }
  return result;
};

const signature = (steps: Array<{ stepId: string; stepType?: string; output?: unknown; error?: unknown; status: string }>) =>
  JSON.stringify(
    steps
      .map((step) => ({
        stepId: step.stepId,
        stepType: step.stepType,
        status: step.status,
        output: normalize(step.output),
        error: normalize(step.error ?? null),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  );

interface StepDoc {
  stepId: string;
  stepType?: string;
  status: string;
  duration?: number;
  executionTimeMs?: number;
  output?: unknown;
  error?: unknown;
}

const readSteps = async (executionId: string): Promise<StepDoc[]> => {
  const docs: StepDoc[] = [];
  let searchAfter: unknown[] | undefined;
  for (;;) {
    const page = await api<{
      hits: { hits: Array<{ _id: string; _source: StepDoc; sort?: unknown[] }> };
    }>(`${es}/.workflows-step-executions*/_search`, {
      size: 500,
      query: { term: { workflowRunId: executionId } },
      sort: [{ stepId: 'asc' }, { id: 'asc' }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
    });
    if (!page.hits.hits.length) break;
    docs.push(...page.hits.hits.map((hit) => hit._source));
    searchAfter = page.hits.hits.at(-1)?.sort;
    if (page.hits.hits.length < 500) break;
  }
  return docs;
};

const waitForExecution = async (
  executionId: string,
  attempts: number
): Promise<{ status: string; duration?: number; error?: object }> => {
  let execution: { status: string; duration?: number; error?: object } | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await api<{
      hits: { hits: Array<{ _source: { status: string; duration?: number; error?: object } }> };
    }>(`${es}/.workflows-executions*/_search`, { query: { ids: { values: [executionId] } } });
    execution = result.hits.hits[0]?._source;
    if (execution && ['completed', 'failed', 'cancelled', 'timed_out'].includes(execution.status))
      return execution;
    await delay(100);
  }
  return execution ?? { status: 'running' };
};

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
};

const startInferenceFake = (logPath: string) => {
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text || '{}') as {
      stream?: boolean;
      tools?: Array<{ function: { name: string } }>;
    };
    appendFileSync(logPath, `${JSON.stringify({ path: request.url })}\n`);
    const encoded = JSON.stringify(body);
    if (encoded.includes('lane-b-quiet-agent-failure-')) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'deliberate provider failure' } }));
      return;
    }
    const isAgent = encoded.includes('lane-b-quiet-agent-');
    // The kitchen-sink prompt is a plain completion. Tool-call replies leave ai.prompt content empty.
    const tool =
      isAgent || encoded.includes('authentication triage') ? undefined : body.tools?.[0]?.function;
    const message = tool
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'big-workflow-call',
              type: 'function',
              function: {
                name: tool.name,
                arguments: JSON.stringify({ category: 'Security', rationale: 'Local fake' }),
              },
            },
          ],
        }
      : { role: 'assistant', content: 'Authentication failures are concentrated on even hosts.' };
    const completion = {
      id: 'big-workflow-fake',
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
    const toolCalls =
      'tool_calls' in message && Array.isArray(message.tool_calls) ? message.tool_calls : undefined;
    response.write(
      `data: ${JSON.stringify({
        ...completion,
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              ...message,
              tool_calls: toolCalls?.map((call, index) => ({ ...call, index })),
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
  return server;
};

const baseConfig = (dataPath: string) => ({
  'server.host': '127.0.0.1',
  'server.port': 5635,
  'server.publicBaseUrl': kibana,
  'elasticsearch.hosts': [es],
  'elasticsearch.username': 'kibana_system',
  'elasticsearch.password': 'changeme',
  'path.data': dataPath,
  'xpack.security.encryptionKey': 'lane-b-local-security-key-000000000000',
  'xpack.encryptedSavedObjects.encryptionKey': 'lane-b-local-encrypted-key-0000000000',
  'xpack.reporting.encryptionKey': 'lane-b-local-reporting-key-0000000000',
  'telemetry.optIn': false,
  'newsfeed.enabled': false,
  'logging.root.level': 'info',
  'feature_flags.overrides': {
    'workflows.kibanaRequest.coreSelfClientEnabled': true,
    'nightshift.enabled': true,
  },
  'xpack.alertzero.enabled': true,
  'xpack.agenticInvestigations.enabled': true,
  'xpack.proposals.enabled': true,
});

interface Boot {
  child: ChildProcess;
  directory: string;
  readyMs: number;
}

const bootKibana = async ({
  output,
  backend,
  label,
  delayMs,
  instrument,
  bundleDirectory,
  metrics,
  notifications,
  endpoint,
  modelAlias,
}: {
  output: string;
  backend: Backend;
  label: string;
  delayMs: number;
  instrument: boolean;
  bundleDirectory: string;
  metrics: string;
  notifications: Awaited<ReturnType<typeof startLaneBNotificationsFixture>>;
  endpoint: string;
  modelAlias: boolean;
}): Promise<Boot> => {
  const directory = join(output, label);
  mkdirSync(directory, { recursive: true });
  const configFile = join(directory, 'kibana.yml');
  const model = defaultInferenceEndpoints.ANTHROPIC_CLAUDE_5_5_SONNET;
  writeFileSync(
    configFile,
    stringify({
      ...baseConfig(resolve('.scratch/big-workflow/kibana-data')),
      ...notifications.config,
      'xpack.actions.preconfigured': {
        'lane-b-notifications': notifications.connector,
        ...(modelAlias
          ? {
              [`[${model}]`]: {
                name: 'Big workflow Nightshift model alias',
                exposeConfig: true,
                actionTypeId: '.inference',
                config: {
                  provider: 'openai',
                  taskType: 'chat_completion',
                  inferenceId: endpoint,
                  providerConfig: {},
                },
                secrets: { providerSecrets: {} },
              },
            }
          : {}),
      },
      'workflowsExecutionEngine.remoteExecution.enabled': backend !== 'baseline',
      'core.remote.backend': backend === 'baseline' ? 'child_process' : backend,
    })
  );
  const hook = join(directory, 'preload.cjs');
  writeFileSync(hook, `require(${JSON.stringify(metrics)}).installLaneBMetrics(${JSON.stringify(directory)});\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KBN_REMOTE_BUNDLE_DIR: bundleDirectory,
    KBN_RUNNER_ES_NODE: es,
    KBN_RUNNER_INTERNAL_HEADERS: JSON.stringify({
      authorization: `Basic ${Buffer.from('kibana_system:changeme').toString('base64')}`,
    }),
    KBN_REMOTE_MESSAGE_DELAY_MS: String(delayMs),
  };
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
  if (instrument)
    Object.assign(env, {
      NODE_OPTIONS: `--require=${hook}`,
      KBN_REMOTE_LOAD_HOOK: hook,
      KBN_REMOTE_EXPOSE_GC: 'true',
      KBN_REMOTE_HEAP_LOG: join(directory, 'heaps.jsonl'),
      KBN_REMOTE_TIMING_LOG: join(directory, 'timing.jsonl'),
      KBN_REMOTE_SEAM_LOG: join(directory, 'seams.jsonl'),
    });
  const log = openSync(join(directory, 'kibana.log'), 'a');
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [...(instrument ? ['--expose-gc'] : []), 'scripts/kibana', '--no-base-path', '--no-watch', '--config', configFile],
    { env, stdio: ['ignore', log, log] }
  );
  closeSync(log);
  assert(child.pid);
  save(join(directory, 'owner.json'), { pid: child.pid, backend, delayMs, instrument, machine: machine() });
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    assert(child.exitCode === null && child.signalCode === null, `Kibana exited before ready; see ${join(directory, 'kibana.log')}`);
    try {
      const status = await api<{ status: { overall: { level: string } } }>('/api/status');
      ready = status.status.overall.level === 'available';
    } catch {
      /* not listening yet */
    }
    if (ready) break;
    await delay(1000);
  }
  assert(ready, 'Kibana did not become available');
  return { child, directory, readyMs: Date.now() - started };
};

const seedAlerts = async () => {
  await api(`${es}/${BIG_WORKFLOW_ALERTS_INDEX}`, undefined, 'DELETE').catch((error: Error) => {
    if (!String(error.message).includes('404')) throw error;
  });
  await api(
    `${es}/${BIG_WORKFLOW_ALERTS_INDEX}`,
    {
      mappings: {
        properties: {
          host: { type: 'keyword' },
          severity: { type: 'keyword' },
          message: { type: 'text' },
          '@timestamp': { type: 'date' },
        },
      },
    },
    'PUT'
  );
  const operations = bigWorkflowAlerts().flatMap((alert, index) => [
    { index: { _id: `alert-${String(index).padStart(2, '0')}` } },
    { ...alert, '@timestamp': '2026-01-15T00:00:00.000Z' },
  ]);
  const body = `${operations.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const response = await fetch(`${es}/${BIG_WORKFLOW_ALERTS_INDEX}/_bulk?refresh=true`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/x-ndjson' },
    body,
  });
  const text = await response.text();
  assert(response.ok && !JSON.parse(text).errors, text.slice(0, 400));
};

interface RunRecord {
  scenario: 'A' | 'B';
  backend: Backend;
  delayMs: number;
  instrument: boolean;
  cold: boolean;
  status: string;
  engineDurationMs?: number;
  wallMs: number;
  stepCount: number;
  stepTypes: Record<string, { count: number; durationMs: number }>;
  callbacks: Record<string, number>;
  callbackCount: number;
  callbackDurationMs: number;
  genericInvocations: number;
  pids: number[];
  coordinatorPid: number;
  dispatchToFirstStepMs?: number;
  machine: ReturnType<typeof machine>;
  executionId: string;
  signature?: string;
  note?: string;
}

const runWorkflow = async ({
  directory,
  workflowId,
  coordinatorPid,
  instrument,
  attempts,
}: {
  directory: string;
  workflowId: string;
  coordinatorPid: number;
  instrument: boolean;
  attempts: number;
}): Promise<{
  executionId: string;
  execution: { status: string; duration?: number; error?: object };
  steps: StepDoc[];
  wallMs: number;
  callbacks: Record<string, number>;
  callbackDurationMs: number;
  genericInvocations: number;
  pids: number[];
  dispatchToFirstStepMs?: number;
}> => {
  const seamsBefore = lines<{ name: string }>(join(directory, 'seams.jsonl')).length;
  const timingBefore = lines<{ event: string; at: number; pid: number; executionId?: string; durationMs?: number }>(
    join(directory, 'timing.jsonl')
  ).length;
  const startedAt = Date.now();
  const started = performance.now();
  const { workflowExecutionId } = await api<{ workflowExecutionId: string }>(
    `/api/workflows/workflow/${workflowId}/run`,
    { inputs: {} }
  );
  const execution = await waitForExecution(workflowExecutionId, attempts);
  const wallMs = performance.now() - started;
  await api(`${es}/.workflows-step-executions*/_refresh`, undefined, 'POST');
  const steps = await readSteps(workflowExecutionId);
  const seamRows = lines<{ name: string }>(join(directory, 'seams.jsonl')).slice(seamsBefore);
  const requests = seamRows.filter(
    ({ name }) => name.endsWith('.request') && name !== 'WorkflowExecutor.run.request'
  );
  const callbacks: Record<string, number> = {};
  for (const request of requests) callbacks[request.name] = (callbacks[request.name] ?? 0) + 1;
  const timings = lines<{
    event: string;
    at: number;
    pid: number;
    executionId?: string;
    durationMs?: number;
  }>(join(directory, 'timing.jsonl')).slice(timingBefore);
  const ownTimings = timings.filter(
    (entry) => !entry.executionId || entry.executionId === workflowExecutionId
  );
  const callbackDurationMs = ownTimings
    .filter((entry) => callbackEvents.has(entry.event) && Number.isFinite(entry.durationMs))
    .reduce((total, entry) => total + (entry.durationMs ?? 0), 0);
  const genericInvocations =
    requests.filter(({ name }) => name.includes('WorkflowStepRunner.invoke')).length +
    ownTimings.filter((entry) => entry.event === 'generic_coordinator_handler').length;
  const dispatched = ownTimings.find((entry) => entry.event === 'dispatched');
  const firstStep = ownTimings.find((entry) => entry.event === 'step_start');
  const processFiles = existsSync(directory)
    ? readdirSync(directory).filter((file) => /^process-\d+\.jsonl$/.test(file))
    : [];
  const pids = processFiles
    .map((file) =>
      lines<{ pid: number; ppid: number; argv: string[]; at: number }>(join(directory, file))
        .filter((sample) => sample.at >= startedAt)
        .at(-1)
    )
    .filter((sample): sample is { pid: number; ppid: number; argv: string[]; at: number } => Boolean(sample))
    .filter((sample) => sample.argv.some((arg) => arg.includes('graph.mjs')))
    .map((sample) => sample.pid);
  return {
    executionId: workflowExecutionId,
    execution,
    steps,
    wallMs,
    callbacks,
    callbackDurationMs,
    genericInvocations,
    pids: pids.filter((pid) => pid !== coordinatorPid),
    dispatchToFirstStepMs:
      dispatched && firstStep ? firstStep.at - dispatched.at : undefined,
  };
};

const stepBreakdown = (steps: StepDoc[]) => {
  const types: Record<string, { count: number; durationMs: number }> = {};
  for (const step of steps) {
    const key = step.stepType ?? 'unknown';
    const current = types[key] ?? { count: 0, durationMs: 0 };
    current.count += 1;
    current.durationMs += step.executionTimeMs ?? step.duration ?? 0;
    types[key] = current;
  }
  return types;
};

const assertPid = (backend: Backend, coordinatorPid: number, pids: number[], stepsRan: boolean) => {
  if (!stepsRan) return;
  if (backend === 'child_process') {
    assert(pids.length > 0, 'Worker process did not record a PID');
    assert(pids.every((pid) => pid !== coordinatorPid));
  } else {
    assert.equal(pids.length, 0, `Unexpected worker PID in ${backend}: ${pids.join(',')}`);
  }
};

const writeSummary = (output: string) => {
  const runs = lines<RunRecord>(join(output, 'runs.jsonl'));
  const startup = lines<{ backend: Backend; readyMs: number; instrument: boolean; machine: ReturnType<typeof machine> }>(
    join(output, 'startup.jsonl')
  );
  const idle = existsSync(join(output, 'idle-worker.json'))
    ? JSON.parse(readFileSync(join(output, 'idle-worker.json'), 'utf8'))
    : undefined;
  const memory = lines<{
    backend: Backend;
    phase: string;
    combinedRss: number;
    combinedHeap: number;
  }>(join(output, 'memory.jsonl'));
  const scenario = (name: 'A' | 'B', backend: Backend) =>
    runs.filter((run) => run.scenario === name && run.backend === backend);
  const cell = (rows: RunRecord[], cold: boolean) => {
    const selected = rows.filter((run) => run.cold === cold && !run.instrument && run.status === 'completed');
    const wall = selected.map((run) => run.wallMs);
    const engine = selected.map((run) => run.engineDurationMs).filter((value): value is number => Number.isFinite(value));
    return {
      count: selected.length,
      wallMedian: percentile(wall, 0.5),
      wallP95: percentile(wall, 0.95),
      engineMedian: percentile(engine, 0.5),
      engineP95: percentile(engine, 0.95),
    };
  };
  const byBackend = (backend: Backend) => scenario('A', backend);
  const durationRow = (backend: Backend) => {
    const rows = byBackend(backend);
    return { backend, cold: cell(rows, true), warm: cell(rows, false) };
  };
  const memoryRow = (backend: Backend) => ({
    backend,
    idle: memory.find((row) => row.backend === backend && row.phase === 'idle'),
    peak: memory.find((row) => row.backend === backend && row.phase === 'peak'),
    settled: memory.find((row) => row.backend === backend && row.phase === 'settled'),
  });
  const latency = [0, 1, 5, 30].map((delayMs) => {
    const rows = runs.filter(
      (run) =>
        run.scenario === 'A' &&
        run.backend === 'child_process' &&
        run.delayMs === delayMs &&
        !run.cold &&
        !run.instrument &&
        run.status === 'completed'
    );
    return {
      delayMs,
      count: rows.length,
      wallMedian: percentile(rows.map((run) => run.wallMs), 0.5),
      engineMedian: percentile(
        rows.map((run) => run.engineDurationMs).filter((value): value is number => Number.isFinite(value)),
        0.5
      ),
    };
  });
  const green = runs.filter((run) => run.scenario === 'A' && run.instrument);
  const drivers = Object.entries(
    green.find((run) => run.backend === 'baseline')?.stepTypes ??
      green[0]?.stepTypes ??
      {}
  )
    .sort((left, right) => right[1].durationMs - left[1].durationMs)
    .slice(0, 3);
  const summary = {
    provisional: true,
    cpuCount: cpus().length,
    headline:
      'Numbers were collected on a shared machine. Treat every duration and memory figure as provisional until the same command is repeated while the machine is quiet.',
    referenceWorkerRssBytes: 564 * 1024 * 1024,
    endToEnd: {
      A: Object.fromEntries(
        backends.map((backend) => [
          backend,
          scenario('A', backend).some((run) => run.status === 'completed') ? 'yes' : 'no',
        ])
      ),
      B: Object.fromEntries(
        backends.map((backend) => {
          const rows = scenario('B', backend);
          if (!rows.length) return [backend, 'not-run'];
          return [backend, rows.some((run) => run.status === 'completed') ? 'yes' : 'no'];
        })
      ),
    },
    startup: startup.map(({ backend, readyMs, instrument, machine: sample }) => ({
      backend,
      instrument,
      readyMs,
      loadavg: sample.loadavg,
    })),
    idleWorker: idle,
    memory: backends.map(memoryRow),
    duration: backends.map(durationRow),
    latency,
    topStepDrivers: drivers,
    runs: runs.map(({ signature: _signature, ...run }) => run),
  };
  save(join(output, 'summary.json'), summary);
  const text = renderSummary(summary);
  writeFileSync(join(output, 'SUMMARY.md'), text);
  writeFileSync(resolve('.scratch/big-workflow/SUMMARY.md'), text);
};

const renderSummary = (summary: {
  headline: string;
  endToEnd: { A: Record<string, string>; B: Record<string, string> };
  startup: Array<{ backend: string; instrument: boolean; readyMs: number; loadavg: number[] }>;
  idleWorker?: { samples?: Array<{ ready: number; requested: number; memory: { rss: number; usage: { rss: number; heapUsed: number } } }> };
  memory: Array<{
    backend: string;
    idle?: { combinedRss: number; combinedHeap: number };
    peak?: { combinedRss: number; combinedHeap: number };
    settled?: { combinedRss: number; combinedHeap: number };
  }>;
  duration: Array<{
    backend: string;
    cold: { count: number; wallMedian: number | null; engineMedian: number | null };
    warm: { count: number; wallMedian: number | null; wallP95: number | null; engineMedian: number | null; engineP95: number | null };
  }>;
  latency: Array<{ delayMs: number; count: number; wallMedian: number | null; engineMedian: number | null }>;
  topStepDrivers: Array<[string, { count: number; durationMs: number }]>;
  runs: RunRecord[];
}): string => {
  const mib = (bytes?: number) => (bytes == null ? '' : (bytes / 1024 / 1024).toFixed(0));
  const ms = (value: number | null | undefined) => (value == null ? '' : Math.round(value).toString());
  const startupLine = (backend: string) => {
    const row = summary.startup.find((entry) => entry.backend === backend && entry.instrument);
    return row ? `${row.readyMs} ms (load ${row.loadavg.map((value) => value.toFixed(2)).join(' ')})` : '';
  };
  const mem = (backend: string, phase: 'idle' | 'peak' | 'settled') => {
    const row = summary.memory.find((entry) => entry.backend === backend)?.[phase];
    return row ? `${mib(row.combinedRss)} / ${mib(row.combinedHeap)}` : '';
  };
  const dur = (backend: string) => summary.duration.find((entry) => entry.backend === backend);
  const instrumented = (backend: string) =>
    summary.runs.filter((run) => run.scenario === 'A' && run.instrument && run.backend === backend).at(-1);
  const delta = (field: 'wallMedian' | 'engineMedian', warm: boolean) => {
    const base = dur('baseline');
    const worker = dur('child_process');
    const left = warm ? base?.warm[field] : base?.cold[field];
    const right = warm ? worker?.warm[field] : worker?.cold[field];
    if (left == null || right == null) return '';
    return `${Math.round(right - left)} ms`;
  };
  const idleSamples = summary.idleWorker?.samples ?? [];
  const idleReady = idleSamples.map((sample) => sample.ready - sample.requested);
  const broken = summary.runs.filter((run) => run.status !== 'completed' || run.note);
  return `# Big workflow on the remote runner

${summary.headline} CPU count ${cpus().length}. The earlier idle-worker reference is 564 MiB RSS.

## Does it run end to end?

| Scenario | runner off | in_process | worker |
| --- | --- | --- | --- |
| A kitchen sink | ${summary.endToEnd.A.baseline} | ${summary.endToEnd.A.in_process} | ${summary.endToEnd.A.child_process} |
| B Nightshift trigger → investigation → sendNotifications | ${summary.endToEnd.B.baseline} | ${summary.endToEnd.B.in_process} | ${summary.endToEnd.B.child_process} |

## Startup

| | runner off | in_process | worker |
| --- | --- | --- | --- |
| Kibana boot to available | ${startupLine('baseline')} | ${startupLine('in_process')} | ${startupLine('child_process')} |

Idle worker spawn-to-ready (bundled graph, no Kibana): ${
    idleReady.length
      ? `${idleReady.map((value) => Math.round(value)).join(' / ')} ms; RSS ${idleSamples
          .map((sample) => mib(sample.memory.usage.rss))
          .join(' / ')} MiB`
      : 'not measured yet'
  }.

First dispatch to first step (instrumented cold run): ${summary.runs
    .filter((run) => run.scenario === 'A' && run.instrument && run.dispatchToFirstStepMs != null)
    .map((run) => `${run.backend} ${Math.round(run.dispatchToFirstStepMs ?? 0)} ms`)
    .join('; ')}.

## Memory (RSS MiB / heapUsed MiB, Kibana plus workers)

| | runner off | in_process | worker |
| --- | --- | --- | --- |
| Idle after boot | ${mem('baseline', 'idle')} | ${mem('in_process', 'idle')} | ${mem('child_process', 'idle')} |
| Peak during scenario A | ${mem('baseline', 'peak')} | ${mem('in_process', 'peak')} | ${mem('child_process', 'peak')} |
| Settled after scenario A | ${mem('baseline', 'settled')} | ${mem('in_process', 'settled')} | ${mem('child_process', 'settled')} |

## Duration

Uninstrumented wall-clock median. Cold is the first run after boot. Warm is the median of the following runs, with p95 in parentheses. Delta is worker minus runner off.

| | runner off | in_process | worker | worker − off |
| --- | --- | --- | --- | --- |
| Cold wall ms | ${ms(dur('baseline')?.cold.wallMedian)} | ${ms(dur('in_process')?.cold.wallMedian)} | ${ms(dur('child_process')?.cold.wallMedian)} | ${delta('wallMedian', false)} |
| Warm wall ms | ${ms(dur('baseline')?.warm.wallMedian)} (${ms(dur('baseline')?.warm.wallP95)}) | ${ms(dur('in_process')?.warm.wallMedian)} (${ms(dur('in_process')?.warm.wallP95)}) | ${ms(dur('child_process')?.warm.wallMedian)} (${ms(dur('child_process')?.warm.wallP95)}) | ${delta('wallMedian', true)} |
| Warm engine ms | ${ms(dur('baseline')?.warm.engineMedian)} (${ms(dur('baseline')?.warm.engineP95)}) | ${ms(dur('in_process')?.warm.engineMedian)} (${ms(dur('in_process')?.warm.engineP95)}) | ${ms(dur('child_process')?.warm.engineMedian)} (${ms(dur('child_process')?.warm.engineP95)}) | ${delta('engineMedian', true)} |

## Coordinator callbacks (instrumented scenario A)

Count is remote seam requests other than \`WorkflowExecutor.run\`. Time is the sum of connector and Kibana callback timing events.

| | runner off | in_process | worker |
| --- | --- | --- | --- |
| Callbacks | ${instrumented('baseline')?.callbackCount ?? ''} | ${instrumented('in_process')?.callbackCount ?? ''} | ${instrumented('child_process')?.callbackCount ?? ''} |
| Callback time ms | ${ms(instrumented('baseline')?.callbackDurationMs)} | ${ms(instrumented('in_process')?.callbackDurationMs)} | ${ms(instrumented('child_process')?.callbackDurationMs)} |

## Latency curve (worker, warm scenario A)

Injected one-way delay on each worker-to-coordinator IPC frame, same setting as \`KBN_REMOTE_MESSAGE_DELAY_MS\`.

| Delay | samples | warm wall median ms | warm engine median ms |
| --- | ---: | ---: | ---: |
${summary.latency
  .map(
    (row) =>
      `| ${row.delayMs} ms | ${row.count} | ${ms(row.wallMedian)} | ${ms(row.engineMedian)} |`
  )
  .join('\n')}

## Where the time goes

Top step types by summed step \`executionTimeMs\` on the instrumented runner-off scenario A run. The built-in \`http\` step is not in this workflow: on this branch it is not in the worker connector catalog, so it runs through \`WorkflowStepRunner.invoke\`. Slack and the inference endpoint are the loopback connectors, and the Slack confirm step is the fail-once retry.

${
  summary.topStepDrivers.length
    ? summary.topStepDrivers
        .map(
          ([type, stats], index) =>
            `${index + 1}. \`${type}\` — ${stats.count} executions, ${Math.round(stats.durationMs)} ms`
        )
        .join('\n')
    : 'Not measured yet.'
}

## What broke

${
  broken.length
    ? broken
        .map((run) => `- ${run.scenario} ${run.backend} delay ${run.delayMs}: ${run.status}${run.note ? ` (${run.note})` : ''}`)
        .join('\n')
    : 'No failed runs recorded in the files written so far.'
}

The idle-worker probe RSS above is the bundled graph process with no Kibana. The 564 MiB figure is the earlier comparison reference, not this probe.
`;
};

const installWorkflows = async (id: string, endpoint: string) => {
  const childId = `${id}-child`;
  await api('/api/workflows/workflow', {
    id: childId,
    yaml: stringify(createBigWorkflowChild(childId)),
  });
  await api('/api/workflows/workflow', {
    id,
    yaml: stringify(
      createBigWorkflow(id, {
        childId,
        endpoint,
        slackConnectorId: 'lane-b-notifications',
      })
    ),
  });
  return { id, childId };
};

const recordRun = (
  output: string,
  run: RunRecord
) => {
  appendFileSync(join(output, 'runs.jsonl'), `${JSON.stringify(run)}\n`);
};

const combinedDuring = async (directory: string, coordinatorPid: number, from: number, to: number) => {
  const files = readdirSync(directory).filter((file) => /^process-\d+\.jsonl$/.test(file));
  const latest = new Map<string, { rss: number; heap: number }>();
  for (const file of files) {
    for (const sample of lines<{
      at: number;
      pid: number;
      ppid: number;
      memory: { rss: number; heapUsed: number };
    }>(join(directory, file))) {
      if (sample.at < from || sample.at > to) continue;
      if (sample.pid !== coordinatorPid && sample.ppid !== coordinatorPid) continue;
      const bucket = Math.floor(sample.at / 500);
      latest.set(`${bucket}:${sample.pid}`, { rss: sample.memory.rss, heap: sample.memory.heapUsed });
    }
  }
  const buckets = new Map<number, { rss: number; heap: number }>();
  for (const [key, value] of latest) {
    const bucket = Number(key.split(':')[0]);
    const current = buckets.get(bucket) ?? { rss: 0, heap: 0 };
    current.rss += value.rss;
    current.heap += value.heap;
    buckets.set(bucket, current);
  }
  let peak = { combinedRss: 0, combinedHeap: 0 };
  for (const value of buckets.values()) {
    if (value.rss > peak.combinedRss) peak = { combinedRss: value.rss, combinedHeap: value.heap };
  }
  return peak;
};

/** Runs the kitchen-sink and Nightshift comparison. One command, ports 9235 and 5635 only. */
export const runBigWorkflowMeasurements = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(name) + 1];
  assert(args.includes('--output'), 'Required: --output NEW_OR_RESUMED_DIRECTORY');
  const output = resolve(option('--output'));
  const phase = (args.includes('--phase') ? option('--phase') : 'all') as Phase;
  assert(['green', 'duration', 'latency', 'nightshift', 'all'].includes(phase), 'Unknown phase');
  const warm = args.includes('--warm') ? Number(option('--warm')) : 5;
  assert(Number.isInteger(warm) && warm >= 5, '--warm must be an integer >= 5');
  const resume = args.includes('--resume') || existsSync(join(output, 'runs.jsonl'));
  if (!resume) {
    assert(!existsSync(output), 'Output directory must be new, or pass --resume');
    mkdirSync(output, { recursive: true });
  } else mkdirSync(output, { recursive: true });
  await api(`${es}/_cluster/health`);
  note(output, `phase ${phase} starting; load ${loadavg().map((value) => value.toFixed(2)).join(' ')}`);
  const bundleDirectory = join(output, 'bundles');
  if (!existsSync(join(output, 'bundle.json'))) {
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
  }
  const metrics = join(output, 'metrics.cjs');
  if (!existsSync(metrics))
    await build({
      entryPoints: [resolve(__dirname, 'lane_b_metrics.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: metrics,
    });
  if (phase === 'green' || phase === 'all') {
    const idleProbe = join(output, 'idle-probe.cjs');
    await build({
      entryPoints: [
        resolve(__dirname, '../../core/packages/remote/server-internal/src/__fixtures__/probe_bundle.ts'),
      ],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: idleProbe,
    });
    const idle = JSON.parse(
      execFileSync(process.execPath, [idleProbe, join(bundleDirectory, 'workflows')], {
        encoding: 'utf8',
        env: { ...process.env, KBN_REMOTE_MESSAGE_DELAY_MS: '0' },
      })
    );
    save(join(output, 'idle-worker.json'), { ...idle, machine: machine() });
    note(
      output,
      `idle worker ready ${idle.samples
        .map((sample: { ready: number; requested: number }) => Math.round(sample.ready - sample.requested))
        .join('/')} ms`
    );
  }
  const inferenceLog = join(output, 'inference-requests.jsonl');
  const inference = startInferenceFake(inferenceLog);
  const inferencePort = await listen(inference);
  const notifications = await startLaneBNotificationsFixture(join(output, 'slack-requests.jsonl'));
  const endpoint = `big-workflow-${Date.now()}`;
  let endpointCreated = false;
  let child: ChildProcess | undefined;
  const phases = phase === 'all' ? (['green', 'duration', 'latency', 'nightshift'] as const) : [phase];
  try {
    await api(
      `${es}/_inference/chat_completion/${endpoint}`,
      {
        service: 'openai',
        service_settings: {
          api_key: 'fake',
          model_id: 'gpt-4o',
          url: `http://127.0.0.1:${inferencePort}/v1/chat/completions`,
        },
      },
      'PUT'
    );
    endpointCreated = true;
    if (phases.includes('nightshift')) {
      const model = defaultInferenceEndpoints.ANTHROPIC_CLAUDE_5_5_SONNET;
      const existing = await fetch(`${es}/_inference/${model}`, { headers });
      assert.equal(existing.status, 404, 'Refusing to shadow a real Nightshift default inference endpoint');
    }
    await seedAlerts();
    const done = new Set(
      existsSync(join(output, 'phases.json'))
        ? (JSON.parse(readFileSync(join(output, 'phases.json'), 'utf8')) as string[])
        : []
    );
    for (const current of phases) {
      if (done.has(current)) continue;
      if (current === 'green' || current === 'nightshift') {
        for (const backend of backends) {
          const label = `${current}-${backend}`;
          note(output, `${label} boot`);
          const boot = await bootKibana({
            output,
            backend,
            label,
            delayMs: 0,
            instrument: true,
            bundleDirectory,
            metrics,
            notifications,
            endpoint,
            modelAlias: current === 'nightshift' || phases.includes('nightshift'),
          });
          child = boot.child;
          appendFileSync(
            join(output, 'startup.jsonl'),
            `${JSON.stringify({ backend, instrument: true, readyMs: boot.readyMs, label, machine: machine() })}\n`
          );
          const id = `big-workflow-${backendSlug(backend)}-${Date.now()}`;
          const installed = await installWorkflows(id, endpoint);
          const before = Date.now();
          const idle = await memorySnapshot(boot.directory, child.pid!);
          appendFileSync(
            join(output, 'memory.jsonl'),
            `${JSON.stringify({ backend, phase: 'idle', label, ...idle, machine: machine() })}\n`
          );
          if (current === 'green') {
            const result = await runWorkflow({
              directory: boot.directory,
              workflowId: installed.id,
              coordinatorPid: child.pid!,
              instrument: true,
              attempts: 2400,
            });
            save(join(boot.directory, `${result.executionId}-failure.json`), {
              execution: result.execution,
              steps: result.steps,
            });
            assert.equal(result.execution.status, 'completed', JSON.stringify(result.execution.error));
            assert(result.steps.length >= 150, `Expected >=150 steps, got ${result.steps.length}`);
            assert.equal(result.genericInvocations, 0);
            const confirmations = lines<{ body?: { text?: string }; fail?: boolean }>(
              join(output, 'slack-requests.jsonl')
            ).filter((row) => row.body?.text?.includes('confirm-delivery'));
            assert(
              confirmations.length >= 2 &&
                confirmations.at(-2)?.fail === true &&
                confirmations.at(-1)?.fail === false,
              'Slack confirm step did not fail once then succeed'
            );
            assertPid(backend, child.pid!, result.pids, true);
            const after = Date.now();
            const peak = await combinedDuring(boot.directory, child.pid!, before, after);
            appendFileSync(
              join(output, 'memory.jsonl'),
              `${JSON.stringify({ backend, phase: 'peak', label, ...peak, machine: machine() })}\n`
            );
            const settled = await memorySnapshot(boot.directory, child.pid!);
            appendFileSync(
              join(output, 'memory.jsonl'),
              `${JSON.stringify({ backend, phase: 'settled', label, ...settled, machine: machine() })}\n`
            );
            const record: RunRecord = {
              scenario: 'A',
              backend,
              delayMs: 0,
              instrument: true,
              cold: true,
              status: result.execution.status,
              engineDurationMs: result.execution.duration,
              wallMs: result.wallMs,
              stepCount: result.steps.length,
              stepTypes: stepBreakdown(result.steps),
              callbacks: result.callbacks,
              callbackCount: Object.values(result.callbacks).reduce((total, count) => total + count, 0),
              callbackDurationMs: result.callbackDurationMs,
              genericInvocations: result.genericInvocations,
              pids: result.pids,
              coordinatorPid: child.pid!,
              dispatchToFirstStepMs: result.dispatchToFirstStepMs,
              machine: machine(),
              executionId: result.executionId,
              signature: signature(result.steps),
            };
            save(join(boot.directory, `${result.executionId}-steps.json`), result.steps);
            recordRun(output, record);
            note(output, `${label} completed steps=${result.steps.length} wall=${Math.round(result.wallMs)}ms`);
          }
          if (current === 'nightshift') {
            const nightId = `big-nightshift-${backendSlug(backend)}-${Date.now()}`;
            await api('/api/workflows/workflow', {
              id: nightId,
              yaml: stringify(createLaneBWorkflow('nightshift_notifications', nightId, endpoint)),
            });
            const result = await runWorkflow({
              directory: boot.directory,
              workflowId: nightId,
              coordinatorPid: child.pid!,
              instrument: true,
              attempts: 1800,
            });
            let status = result.execution.status;
            let extra = '';
            if (status === 'completed') {
              try {
                const conversation = result.steps.find((step) => step.stepId === 'persist')?.output as
                  | { _id?: string }
                  | undefined;
                const outcome = await api<{ _source: { conversationId?: string } }>(
                  `${es}/lane-b-quiet-outcomes/_doc/${conversation?._id}`
                );
                const conversationId = outcome._source.conversationId;
                assert(conversationId);
                const accepted = await api<{
                  _source: { agent_id: string; metadata: { workflow_execution_ids: string[] } };
                }>(`${es}/.chat-conversations/_doc/${conversationId}`);
                const childId = accepted._source.metadata.workflow_execution_ids.at(-1);
                assert(childId);
                const investigation = await waitForExecution(childId, 1800);
                if (!['completed', 'failed'].includes(investigation.status)) {
                  status = 'deadlocked';
                  extra = 'scheduled investigation child did not finish; dropped from the passing claim';
                } else {
                  assert.equal(investigation.status, 'completed');
                  const childSteps = await readSteps(childId);
                  assert(
                    childSteps.some(
                      (step) => step.stepType === 'nightshift.sendNotifications' && step.status === 'completed'
                    )
                  );
                }
              } catch (error) {
                status = 'failed';
                extra = error instanceof Error ? error.message : String(error);
              }
            } else if (status === 'running') {
              status = 'deadlocked';
              extra = 'trigger workflow did not finish; async child path dropped';
            }
            recordRun(output, {
              scenario: 'B',
              backend,
              delayMs: 0,
              instrument: true,
              cold: true,
              status,
              engineDurationMs: result.execution.duration,
              wallMs: result.wallMs,
              stepCount: result.steps.length,
              stepTypes: stepBreakdown(result.steps),
              callbacks: result.callbacks,
              callbackCount: Object.values(result.callbacks).reduce((total, count) => total + count, 0),
              callbackDurationMs: result.callbackDurationMs,
              genericInvocations: result.genericInvocations,
              pids: result.pids,
              coordinatorPid: child.pid!,
              machine: machine(),
              executionId: result.executionId,
              note: extra || undefined,
            });
            note(output, `${label} nightshift ${status} ${extra}`);
          }
          await stop(child);
          child = undefined;
        }
        if (current === 'green') {
          const greenRuns = lines<RunRecord>(join(output, 'runs.jsonl')).filter(
            (run) => run.scenario === 'A' && run.instrument && run.status === 'completed'
          );
          const latest = new Map<Backend, RunRecord>();
          for (const run of greenRuns) latest.set(run.backend, run);
          const baseline = latest.get('baseline');
          assert(baseline?.signature);
          for (const run of latest.values()) {
            assert.equal(run.stepCount, baseline.stepCount, `${run.backend} step count`);
            assert.equal(run.signature, baseline.signature, `${run.backend} outputs differ`);
            assert.equal(run.genericInvocations, 0);
          }
          note(output, 'green scenario A outputs match across modes');
        }
      }
      if (current === 'duration' || current === 'latency') {
        const cells =
          current === 'duration'
            ? backends.map((backend) => ({ backend, delayMs: 0 }))
            : [1, 5, 30].map((delayMs) => ({ backend: 'child_process' as const, delayMs }));
        for (const cell of cells) {
          const label = `${current}-${cell.backend}-${cell.delayMs}`;
          note(output, `${label} boot`);
          const boot = await bootKibana({
            output,
            backend: cell.backend,
            label,
            delayMs: cell.delayMs,
            instrument: false,
            bundleDirectory,
            metrics,
            notifications,
            endpoint,
            modelAlias: false,
          });
          child = boot.child;
          appendFileSync(
            join(output, 'startup.jsonl'),
            `${JSON.stringify({ backend: cell.backend, instrument: false, readyMs: boot.readyMs, delayMs: cell.delayMs, machine: machine() })}\n`
          );
          const installed = await installWorkflows(
            `big-workflow-${backendSlug(cell.backend)}-${cell.delayMs}-${Date.now()}`,
            endpoint
          );
          const repeats = current === 'latency' ? warm : warm + 1;
          for (let repeat = 0; repeat < repeats; repeat++) {
            const cold = current === 'duration' && repeat === 0;
            const result = await runWorkflow({
              directory: boot.directory,
              workflowId: installed.id,
              coordinatorPid: child.pid!,
              instrument: false,
              attempts: 2400,
            });
            assert.equal(result.execution.status, 'completed', JSON.stringify(result.execution.error));
            recordRun(output, {
              scenario: 'A',
              backend: cell.backend,
              delayMs: cell.delayMs,
              instrument: false,
              cold,
              status: result.execution.status,
              engineDurationMs: result.execution.duration,
              wallMs: result.wallMs,
              stepCount: result.steps.length,
              stepTypes: stepBreakdown(result.steps),
              callbacks: {},
              callbackCount: 0,
              callbackDurationMs: 0,
              genericInvocations: 0,
              pids: [],
              coordinatorPid: child.pid!,
              machine: machine(),
              executionId: result.executionId,
            });
            note(
              output,
              `${label} ${cold ? 'cold' : 'warm'} wall=${Math.round(result.wallMs)}ms engine=${result.execution.duration}`
            );
          }
          await stop(child);
          child = undefined;
        }
      }
      done.add(current);
      save(join(output, 'phases.json'), [...done]);
      writeSummary(output);
      note(output, `${current} summary written`);
    }
    writeSummary(output);
  } finally {
    if (child) await stop(child).catch(() => undefined);
    await notifications.close();
    inference.closeAllConnections();
    await new Promise<void>((done) => inference.close(() => done()));
    if (endpointCreated)
      await api(`${es}/_inference/${endpoint}?force=true`, undefined, 'DELETE').catch(() => undefined);
  }
};
