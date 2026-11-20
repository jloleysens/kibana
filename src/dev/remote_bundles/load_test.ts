/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stringify } from 'yaml';
import { nearestRank } from './load_statistics';

const directory = resolve(process.argv[2]);
const profile = resolve(process.argv[3]);
const levels = (process.argv[4] ?? '1,8').split(',').map(Number);
const durationMs = Number(process.argv[5] ?? 60000);
assert(durationMs >= 60000, 'At least 60s per cell (1200 probes at 20Hz)');
assert(levels.every((level) => Number.isInteger(level) && level > 0 && level <= 32));
mkdirSync(directory, { recursive: true });
const headers = {
  authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`,
  'kbn-xsrf': 'true',
  'content-type': 'application/json',
};
const save = (name: string, data: object) =>
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2));
async function api<T>(path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(path.startsWith('http') ? path : `http://127.0.0.1:5634${path}`, {
    headers,
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  assert(response.ok, `${response.status}: ${path}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}
interface Execution {
  id: string;
  status: string;
  error?: object;
}
interface Hit<T> {
  _id: string;
  _source: T;
}
interface Search<T> {
  hits: { hits: Array<Hit<T>> };
}
interface Step {
  stepId: string;
  status: string;
  output?: { value?: string; content?: string; case?: { id: string; title: string } };
}
const pid = Number(
  execFileSync('lsof', ['-tiTCP:5634', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
);
assert(pid > 0);
const metricPath = `${profile}/metrics.${pid}.json`;
const signal = async () => {
  const previous = readFileSync(metricPath, 'utf8');
  process.kill(pid, 'SIGUSR2');
  for (let attempt = 0; attempt < 300; attempt++) {
    await delay(10);
    const current = readFileSync(metricPath, 'utf8');
    if (current !== previous) return JSON.parse(current) as object;
  }
  throw new Error('Metrics signal not acknowledged');
};
const quantile = nearestRank;
const requests: string[] = [];
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push(request.url ?? '');
  await delay(30);
  response.setHeader('content-type', 'application/json');
  response.end(
    request.url?.includes('chat')
      ? JSON.stringify({
          id: 'fake',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'load-ai-ok' },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      : JSON.stringify({ name: 'load-job', value: 'http-ok' })
  );
});
const connectors: string[] = [];
const workflows: string[] = [];
async function main(): Promise<void> {
  await new Promise<void>((done) => server.listen(9934, '127.0.0.1', done));
  const spec = await api<{ id: string }>('/api/actions/connector', {
    name: 'load-spec',
    connector_type_id: '.jenkins',
    config: { baseUrl: 'http://127.0.0.1:9934' },
    secrets: { authType: 'basic', username: 'fake', password: 'fake' },
  });
  connectors.push(spec.id);
  const ai = await api<{ id: string }>('/api/actions/connector', {
    name: 'load-ai',
    connector_type_id: '.gen-ai',
    config: {
      apiProvider: 'OpenAI',
      apiUrl: 'http://127.0.0.1:9934/chat/completions',
      defaultModel: 'gpt-4o',
    },
    secrets: { apiKey: 'fake' },
  });
  connectors.push(ai.id);
  await api(
    'http://127.0.0.1:9234/runner-load/_doc/1?refresh=true',
    { value: 'load-es-ok' },
    'PUT'
  );
  const native: object[] = [
    {
      name: 'seed',
      type: 'data.set',
      with: {
        items: Array.from({ length: 1500 }, (_, index) => ({ key: `item-${index}`, value: index })),
      },
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      name: `map${index}`,
      type: 'data.map',
      items: '${{ steps.seed.output.items }}',
      with: { fields: { key: '{{ item.key | upcase }}', value: '{{ item.value }}' } },
    })),
    {
      name: 'search',
      type: 'elasticsearch.search',
      with: { index: 'runner-load', query: { match_all: {} } },
    },
    {
      name: 'choose',
      type: 'if',
      condition: '${{ steps.search.output.hits.total.value == 1 }}',
      steps: [{ name: 'native_ok', type: 'data.set', with: { value: 'native-ok' } }],
    },
  ];
  const tail: object[] = [
    { name: 'http', type: 'http', with: { url: 'http://127.0.0.1:9934/ok', method: 'GET' } },
    {
      name: 'spec',
      type: 'jenkins.getJob',
      'connector-id': spec.id,
      with: { jobName: 'load-job' },
    },
    { name: 'ai', type: 'ai.prompt', 'connector-id': ai.id, with: { prompt: 'Return load-ai-ok' } },
    {
      name: 'case',
      type: 'cases.createCase',
      with: {
        title: 'Runner load case',
        description: 'Synthetic local load fixture',
        owner: 'securitySolution',
        severity: 'low',
      },
    },
    { name: 'kibana', type: 'kibana.request', with: { method: 'GET', path: '/api/status' } },
    { name: 'tail_ok', type: 'data.set', with: { value: '{{ steps.ai.output.content }}' } },
  ];
  const definitions: Record<string, string> = {};
  for (const [mix, steps] of Object.entries({ native, tail, mixed: [...native, ...tail] })) {
    const id = `load-${mix}-${Date.now()}`;
    const yaml = stringify({
      version: '1',
      name: id,
      enabled: true,
      triggers: [{ type: 'manual' }],
      steps,
    });
    save(`${mix}-definition`, { id, yaml });
    await api('/api/workflows/workflow', { id, yaml });
    workflows.push(id);
    definitions[mix] = id;
  }
  const outcomes: object[] = [];
  async function run(mix: string, name: string): Promise<void> {
    const { workflowExecutionId } = await api<{ workflowExecutionId: string }>(
      `/api/workflows/workflow/${definitions[mix]}/run`,
      { inputs: {} }
    );
    let execution: Execution | undefined;
    for (let attempt = 0; attempt < 1200; attempt++) {
      const found = await api<Search<Execution>>(
        'http://127.0.0.1:9234/.workflows-executions*/_search',
        { query: { ids: { values: [workflowExecutionId] } } }
      );
      execution = found.hits.hits[0]?._source;
      if (execution && ['completed', 'failed', 'cancelled', 'timed_out'].includes(execution.status))
        break;
      await delay(250);
    }
    save(`${name}-execution`, { workflowExecutionId, execution });
    assert.equal(execution?.status, 'completed', JSON.stringify(execution?.error));
    await api('http://127.0.0.1:9234/.workflows-step-executions*/_refresh', undefined, 'POST');
    const steps = await api<Search<Step>>(
      'http://127.0.0.1:9234/.workflows-step-executions*/_search',
      { size: 100, query: { term: { workflowRunId: workflowExecutionId } } }
    );
    save(`${name}-steps`, steps);
    const docs = steps.hits.hits.map(({ _source }) => _source);
    if (mix !== 'tail')
      assert(
        docs.some(({ stepId, output }) => stepId === 'native_ok' && output?.value === 'native-ok')
      );
    if (mix !== 'native') {
      assert(
        docs.some(({ stepId, output }) => stepId === 'tail_ok' && output?.value === 'load-ai-ok')
      );
      const createdCase = docs.find(({ stepId }) => stepId === 'case')?.output?.case;
      assert.equal(createdCase?.title, 'Runner load case');
      assert(createdCase);
      const persistedCase = await api<{ title: string }>(`/api/cases/${createdCase.id}`);
      assert.equal(persistedCase.title, 'Runner load case');
    }
    outcomes.push({ name, workflowExecutionId, status: execution.status });
  }
  // Prime all paths outside measurement. Cold first-use measurements belong to separate profiles.
  for (const mix of Object.keys(definitions)) await run(mix, `${mix}-prime`);
  await delay(3000);
  for (const mix of Object.keys(definitions))
    for (const concurrency of levels) {
      const name = `${mix}-${concurrency}`;
      const probes: Array<{ at: number; milliseconds: number; status: number }> = [];
      const workers: string[] = [];
      const pending = new Set<Promise<void>>();
      let probing = true;
      const probeLoop = (async () => {
        let next = performance.now();
        while (probing) {
          const at = performance.now();
          const promise = fetch('http://127.0.0.1:5634/api/status', {
            headers,
            signal: AbortSignal.timeout(30000),
          })
            .then(async (response) => {
              await response.arrayBuffer();
              probes.push({ at, milliseconds: performance.now() - at, status: response.status });
            })
            .catch(() => {
              probes.push({ at, milliseconds: performance.now() - at, status: 0 });
            });
          pending.add(promise);
          void promise.finally(() => pending.delete(promise));
          next += 50;
          await delay(Math.max(0, next - performance.now()));
        }
      })();
      const sampling = setInterval(() => {
        workers.push(
          execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,rss=,time=,command='], { encoding: 'utf8' })
            .split('\n')
            .filter((line) => line.includes('graph.mjs'))
            .join('\n')
        );
      }, 1000);
      await signal();
      const started = performance.now();
      const outcomeStart = outcomes.length;
      try {
        await Promise.all(
          Array.from({ length: concurrency }, async (_, slot) => {
            let iteration = 0;
            do {
              await run(mix, `${name}-${slot}-${iteration++}`);
            } while (performance.now() - started < durationMs);
          })
        );
      } finally {
        const elapsedMs = performance.now() - started;
        const metrics = await signal();
        clearInterval(sampling);
        probing = false;
        await probeLoop;
        await Promise.all(pending);
        const result = {
          name,
          mix,
          concurrency,
          durationMs,
          completed: outcomes.length - outcomeStart,
          elapsedMs,
          throughput: (outcomes.length - outcomeStart) / (elapsedMs / 1000),
          metrics,
          probe: {
            count: probes.length,
            failures: probes.filter(({ status }) => status !== 200).length,
            p95: quantile(
              probes.map(({ milliseconds }) => milliseconds),
              0.95
            ),
            p99: quantile(
              probes.map(({ milliseconds }) => milliseconds),
              0.99
            ),
          },
          probes,
          workers,
        };
        save(name, result);
        process.stdout.write(
          `${JSON.stringify({ ...result, probes: undefined, workers: undefined })}\n`
        );
      }
    }
  save('validation', { outcomes, fakeRequests: requests });
}
const runWithCleanup = async (): Promise<void> => {
  try {
    await main();
  } finally {
    await Promise.allSettled(
      connectors.map((id) => api(`/api/actions/connector/${id}`, undefined, 'DELETE'))
    );
    await new Promise<void>((done) => server.close(() => done()));
  }
};

runWithCleanup().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
