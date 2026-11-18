import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { stringify } from 'yaml';

const directory = process.argv[2];
mkdirSync(directory, { recursive: true });
const headers = { authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`, 'kbn-xsrf': 'true', 'content-type': 'application/json' };
const save = (name: string, data: object) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2));
async function read(path: string, body?: object, method = body ? 'POST' : 'GET') {
  const url = path.startsWith('/') ? `http://127.0.0.1:5634${path}` : path;
  const response = await fetch(url, { headers, method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status}: ${url}: ${JSON.stringify(data)}`);
  return data;
}
const steps = async (id: string) => {
  await read('http://127.0.0.1:9234/.workflows-step-executions*/_refresh', undefined, 'POST');
  return read('http://127.0.0.1:9234/.workflows-step-executions*/_search', { size: 100, query: { term: { workflowRunId: id } } });
};
const get = async (id: string) => {
  const result = await read('http://127.0.0.1:9234/.workflows-executions*/_search', { query: { term: { _id: id } } });
  return result.hits.hits[0]?._source;
};
const wait = async (name: string, id: string, statuses: string[]) => {
  for (let i = 0; i < 300; i++) {
    const execution = await get(id);
    if (execution && (statuses.includes(execution.status) || ['failed', 'cancelled', 'timed_out'].includes(execution.status))) {
      save(`${name}-execution`, execution);
      save(`${name}-steps`, await steps(id));
      assert(statuses.includes(execution.status), JSON.stringify(execution.error));
      return execution;
    }
    await delay(200);
  }
  throw new Error(`Timed out ${name} ${id}: ${JSON.stringify(await get(id))}`);
};
const set = (name: string, value: string | number) => ({ name, type: 'data.set', with: { value } });
async function create(name: string, workflowSteps: object[], settings?: object) {
  const id = `parity-${name}-${Date.now()}`;
  const yaml = stringify({ version: '1', name: id, enabled: true, triggers: [{ type: 'manual' }], ...(settings ? { settings } : {}), steps: workflowSteps });
  save(`${name}-definition`, { id, yaml });
  save(`${name}-created`, await read('/api/workflows/workflow', { id, yaml }));
  return id;
}
async function run(name: string, workflowId: string) {
  const response = await read(`/api/workflows/workflow/${workflowId}/run`, { inputs: {} });
  save(`${name}-run`, response);
  return response.workflowExecutionId as string;
}
const notifications: string[] = [];
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (request.url?.startsWith('/notify')) notifications.push(body);
  response.setHeader('content-type', 'application/json');
  if (request.url?.startsWith('/slow')) await delay(3000);
  if (request.url?.startsWith('/fail')) { response.statusCode = 500; response.end('{"error":"expected failure"}'); return; }
  response.end(JSON.stringify({ value: 'http-result', authenticated: true, name: 'parity-job', buildable: true }));
});
async function main() {
  await new Promise<void>((resolve) => server.listen(9934, '127.0.0.1', resolve));
  const connector = await read('/api/actions/connector', {
    name: `parity-jenkins-${Date.now()}`, connector_type_id: '.jenkins',
    config: { baseUrl: 'http://127.0.0.1:9934' },
    secrets: { authType: 'basic', username: 'parity', password: 'synthetic-not-a-real-credential' },
  });
  save('spec-connector', { id: connector.id });
  const transportWorkflow = await create('transports', [
    { name: 'http', type: 'http', with: { url: 'http://127.0.0.1:9934/ok', method: 'GET' } },
    { name: 'spec', type: 'jenkins.getJob', 'connector-id': connector.id, with: { jobName: 'parity-job' } },
    set('http_value', '{{ steps.http.output.data.value }}'),
    set('spec_value', '{{ steps.spec.output.name }}'),
  ]);
  const transportId = await run('transports', transportWorkflow);
  await wait('transports', transportId, ['completed']);
  const transportDocs = (await steps(transportId)).hits.hits;
  assert(transportDocs.some((hit: { _source: { stepId: string; output: { value: string } } }) => hit._source.stepId === 'http_value' && hit._source.output?.value === 'http-result'));
  assert(transportDocs.some((hit: { _source: { stepId: string; output: { value: string } } }) => hit._source.stepId === 'spec_value' && hit._source.output?.value === 'parity-job'));

  const controls = await create('controls', [
    set('seed', 'yes'),
    { name: 'choose', type: 'if', condition: 'steps.seed.output.value: "yes"', steps: [set('chosen', 'yes')], else: [set('untaken', 'wrong')] },
    { name: 'each', type: 'foreach', foreach: '["a","b","c"]', steps: [
      { name: 'skip', type: 'loop.continue', if: '${{ foreach.index == 1 }}' },
      set('item', '{{ foreach.item }}'),
    ] },
    { name: 'poll', type: 'while', condition: '${{ while.iteration < 5 }}', 'max-iterations': 10, steps: [
      { name: 'stop', type: 'loop.break', if: '${{ while.iteration == 2 }}' },
      set('iteration', '{{ while.iteration }}'),
    ] },
    { name: 'route', type: 'switch', expression: '{{ steps.seed.output.value }}', cases: [
      { match: 'yes', steps: [set('matched', 'yes')] },
    ], default: [set('unmatched', 'wrong')] },
    { name: 'inline', type: 'wait', with: { duration: '1s' } },
  ]);
  const controlsId = await run('controls', controls);
  await wait('controls', controlsId, ['completed']);
  const controlDocs = (await steps(controlsId)).hits.hits.map((hit: { _source: object }) => hit._source);
  assert(!controlDocs.some((doc: { stepId: string }) => ['untaken', 'unmatched'].includes(doc.stepId)));
  assert.equal(controlDocs.filter((doc: { stepId: string }) => doc.stepId === 'iteration').length, 2);
  assert.deepEqual(controlDocs.filter((doc: { stepId: string }) => doc.stepId === 'item').map((doc: { output: { value: string } }) => doc.output.value).sort(), ['a', 'c']);
  const errorWorkflow = await create('errors', [
    { name: 'fault', type: 'kibana.request', with: { method: 'GET', path: '/api/parity-does-not-exist' },
      'on-failure': { retry: { 'max-attempts': 1 }, fallback: [set('fallback', 'recovered')], continue: true } },
    set('after_error', 'continued'),
  ]);
  const errorId = await run('errors', errorWorkflow);
  await wait('errors', errorId, ['completed']);
  const errorDocs = (await steps(errorId)).hits.hits.map((hit: { _source: object }) => hit._source);
  assert(errorDocs.some((doc: { stepId: string; output: { value: string } }) => doc.stepId === 'fallback' && doc.output?.value === 'recovered'));
  assert.equal(errorDocs.filter((doc: { stepId: string; stepType: string }) => doc.stepId === 'fault' && doc.stepType === 'kibana.request').length, 2);
  assert(errorDocs.some((doc: { stepId: string; output: { value: string } }) => doc.stepId === 'after_error' && doc.output?.value === 'continued'));
  const timeoutWorkflow = await create('timeout', [
    { name: 'slow', type: 'http', timeout: '1s', with: { method: 'GET', url: 'http://127.0.0.1:9934/slow' }, 'on-failure': { continue: true } },
    set('after_timeout', 'continued'),
  ]);
  const timeoutId = await run('timeout', timeoutWorkflow);
  await wait('timeout', timeoutId, ['completed']);
  const timeoutDocs = (await steps(timeoutId)).hits.hits;
  assert(timeoutDocs.some((hit: { _source: { stepId: string; error: { type: string } } }) => hit._source.stepId === 'slow' && hit._source.error?.type === 'TimeoutError'));
  const workflowTimeout = await create('workflow-timeout', [
    { name: 'slow', type: 'http', with: { method: 'GET', url: 'http://127.0.0.1:9934/slow' } }, set('never', 'not-reached'),
  ], { timeout: '1s' });
  await wait('workflow-timeout', await run('workflow-timeout', workflowTimeout), ['timed_out']);

  const parallel = await create('parallel', [
    { name: 'fanout', type: 'parallel', branches: [
      { name: 'left', steps: [set('left_seed', 'left'), { name: 'durable', type: 'wait', with: { duration: '6s' } }, set('left_done', '{{ steps.left_seed.output.value }}')] },
      { name: 'right', steps: [set('right_done', 'right')] },
    ] },
    { name: 'result', type: 'console', with: { message: 'Gathered {{ steps.fanout.output | json }}' } },
  ]);
  const parallelId = await run('parallel', parallel);
  await wait('parallel-parked', parallelId, ['waiting']);
  await wait('parallel', parallelId, ['completed']);
  const branchDocs = (await steps(parallelId)).hits.hits.map((hit: { _source: object }) => hit._source);
  assert(branchDocs.some((doc: { stepId: string; output: { value: string } }) => doc.stepId === 'left_done' && doc.output?.value === 'left'));
  assert(branchDocs.some((doc: { stepId: string; output: { value: string } }) => doc.stepId === 'right_done' && doc.output?.value === 'right'));

  for (const type of ['waitForInput', 'waitForApproval']) {
    const workflow = await create(type.toLowerCase(), [
      { name: 'human', type, with: { message: 'Parity approval', channels: { http: { url: 'http://127.0.0.1:9934/notify', method: 'POST', body: type === 'waitForInput' ? '{"form":"{{ context.hitl.externalFormLink }}"}' : '{"form":"{{ context.hitl.externalApproveLink }}"}' } }, ...(type === 'waitForInput' ? { schema: { type: 'object', properties: { value: { type: 'string' } } } } : {}) } },
      set('answer', type === 'waitForInput' ? '{{ steps.human.output.response.value }}' : '{{ steps.human.output.response.approved }}'),
    ]);
    const id = await run(type, workflow);
    await wait(`${type}-parked`, id, ['waiting_for_input']);
    assert(notifications.length > 0);
    save(`${type}-notification-debug`, { body: notifications.at(-1)?.replace(/token=[a-f0-9]+/g, 'token=REDACTED') });
    assert(notifications.at(-1)?.includes('/resume'));
    save(`${type}-notification`, { delivered: true, includesResumeLink: true, bytes: notifications.at(-1)?.length });
    save(`${type}-resume`, await read(`/api/workflows/executions/${id}/resume`, { input: type === 'waitForInput' ? { value: 'accepted' } : { approved: true } }));
    await wait(type, id, ['completed']);
    const docs = (await steps(id)).hits.hits;
    assert(docs.some((hit: { _source: { stepId: string; output: { value: string | boolean } } }) => hit._source.stepId === 'answer' && ['accepted', true, 'true'].includes(hit._source.output?.value)));
  }

  const child = await create('child', [{ name: 'pause', type: 'wait', with: { duration: '6s' } }, { name: 'out', type: 'workflow.output', with: { value: 'child-result' } }]);
  const parent = await create('parent', [{ name: 'child', type: 'workflow.execute', with: { 'workflow-id': child } }, set('result', '{{ steps.child.output.value }}')]);
  const parentId = await run('parent', parent);
  await wait('parent-parked', parentId, ['waiting_for_child']);
  await wait('parent', parentId, ['completed']);
  const parentSteps = (await steps(parentId)).hits.hits;
  assert(parentSteps.some((hit: { _source: { stepId: string; output: { value: string } } }) => hit._source.stepId === 'result' && hit._source.output?.value === 'child-result'));
  const asyncParent = await create('async-parent', [{ name: 'child', type: 'workflow.executeAsync', with: { 'workflow-id': child } }]);
  await wait('async-parent', await run('async-parent', asyncParent), ['completed']);

  const request = await create('kibana', [{ name: 'status', type: 'kibana.request', with: { method: 'GET', path: '/api/status' } }, set('result', '{{ steps.status.output.status.overall.level }}')]);
  await wait('kibana', await run('kibana', request), ['completed']);
  const cancel = await create('cancel', [{ name: 'pause', type: 'wait', with: { duration: '30s' } }, set('never', 'not-reached')]);
  const cancelId = await run('cancel', cancel);
  await wait('cancel-parked', cancelId, ['waiting']);
  save('cancel-request', await read(`/api/workflows/executions/${cancelId}/cancel`, {}));
  await wait('cancel', cancelId, ['cancelled']);
  assert(!(await steps(cancelId)).hits.hits.some((hit: { _source: { stepId: string } }) => hit._source.stepId === 'never'));
  save('validation', { parallel: parallelId, childSync: parentId, hitl: true, approval: true, childAsync: true, kibana: true, cancellation: cancelId });
}
main().catch((error: Error) => { console.error(error.stack); process.exitCode = 1; }).finally(() => server.close());
