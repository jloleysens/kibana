import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { stringify } from 'yaml';
const directory = process.argv[2];
mkdirSync(directory, { recursive: true });
const headers = { authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`, 'content-type': 'application/json', 'kbn-xsrf': 'true', 'x-elastic-product-origin': 'kibana' };
const save = (name: string, data: object) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2));
async function read(url: string, body?: object, method = body ? 'POST' : 'GET') {
  const response = await fetch(url, { headers, method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert(response.ok, `${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}
async function main() {
  await read('http://127.0.0.1:9234/parity-native/_doc/1?refresh=true', { marker: 'parity' }, 'PUT');
  const id = `parity-native-${Date.now()}`;
  const yaml = stringify({ version: '1', name: id, enabled: true, triggers: [{ type: 'manual' }], steps: [
    { name: 'search', type: 'elasticsearch.search', with: { index: 'parity-native', query: { term: { 'marker.keyword': 'parity' } } } },
    { name: 'seed', type: 'data.set', with: { prefix: 'Native hits' } },
    { name: 'case', type: 'cases.createCase', with: { title: '{{ steps.seed.output.prefix }} {{ steps.search.output.hits.total.value }}', description: 'Parity native data and reference coordinator context', owner: 'securitySolution', severity: 'low' } },
  ] });
  save('definition', { id, yaml });
  await read('http://127.0.0.1:5634/api/workflows/workflow', { id, yaml });
  const run = await read(`http://127.0.0.1:5634/api/workflows/workflow/${id}/run`, { inputs: {} });
  save('run', run);
  let execution;
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await read(`http://127.0.0.1:9234/.workflows-executions/_doc/${run.workflowExecutionId}`);
    execution = result._source;
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) break;
    await delay(200);
  }
  save('execution', execution);
  assert.equal(execution.status, 'completed', JSON.stringify(execution.error));
  const result = await read('http://127.0.0.1:9234/.workflows-step-executions/_mget', { ids: execution.stepExecutionIds });
  save('steps', result);
  const search = result.docs.find((doc: { _source: { stepId: string } }) => doc._source.stepId === 'search')._source;
  assert.equal(search.output.hits.total.value, 1);
  const caseOutput = result.docs.find((doc: { _source: { stepId: string } }) => doc._source.stepId === 'case')._source.output;
  assert.equal(caseOutput.case.title, 'Native hits 1');
  const persistedCase = await read(`http://127.0.0.1:5634/api/cases/${caseOutput.case.id}`);
  save('case', persistedCase);
  assert.equal(persistedCase.title, 'Native hits 1');
  save('validation', { executionId: execution.id, nativeElasticsearchHits: 1, actualCaseTitle: persistedCase.title, caseId: persistedCase.id, fastNativeOutputConsumedByCoordinator: true });
}
main().catch((error: Error) => { console.error(error); process.exitCode = 1; });
