import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { parse, stringify } from 'yaml';

const directory = process.argv[2];
mkdirSync(directory, { recursive: true });
const headers = { authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`, 'content-type': 'application/json', 'kbn-xsrf': 'true' };
const save = (name: string, value: object) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2));
async function read(path: string, body?: object, method = body ? 'POST' : 'GET') {
  const response = await fetch(path.startsWith('/') ? `http://127.0.0.1:5634${path}` : path, { headers, method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${path}: ${text}`);
  return result;
}
const sourceDirectory = 'src/platform/plugins/shared/workflows_execution_engine/integration_tests/tests';
const specifications = [
  { source: 'workflow_output.test.ts', count: 2, status: 'completed' },
  { source: 'workflow_fail.test.ts', count: 3, status: 'failed' },
  { source: 'wait_for_input.test.ts', count: 1, status: 'completed' },
  { source: 'parallel.test.ts', count: 1, status: 'completed' },
  { source: 'variables.test.ts', count: 1, status: 'completed' },
  { source: 'output_eviction.test.ts', count: 1, status: 'completed' },
];
async function getExecution(id: string) {
  const result = await read('http://127.0.0.1:9234/.workflows-executions*/_search', { query: { term: { _id: id } } });
  return result.hits.hits[0]?._source;
}
async function wait(id: string, status: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const execution = await getExecution(id);
    if (execution?.status === status) return execution;
    if (execution && ['failed', 'cancelled'].includes(execution.status)) throw new Error(JSON.stringify(execution.error));
    await delay(100);
  }
  throw new Error(`Timed out ${id} waiting for ${status}`);
}
async function main() {
  const outcomes: object[] = [];
  for (const specification of specifications) {
    const path = `${sourceDirectory}/${specification.source}`;
    const contents = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
    const templates: Array<{ yaml: string; line: number }> = [];
    const visit = (node: ts.Node) => {
      if (ts.isNoSubstitutionTemplateLiteral(node) && /^\s*(steps|outputs):/m.test(node.text)) {
        templates.push({ yaml: node.text, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const [index, scenario] of templates.slice(0, specification.count).entries()) {
      const name = specification.source.replace('.test.ts', '').replaceAll('_', '-') + '-' + index;
      const definition = parse(scenario.yaml);
      const id = `parity-existing-${name}-${Date.now()}`;
      const yaml = stringify({ ...definition, version: '1', name: id, enabled: true, triggers: [{ type: 'manual' }] });
      save(`${name}-source`, { path, line: scenario.line, sha256: createHash('sha256').update(scenario.yaml).digest('hex'), originalYaml: scenario.yaml, submittedYaml: yaml, note: 'Exact existing scenario body. Only API-required version/name/enabled/manual trigger wrapper added.' });
      await read('/api/workflows/workflow', { id, yaml });
      const run = await read(`/api/workflows/workflow/${id}/run`, { inputs: {} });
      save(`${name}-run`, run);
      if (definition.steps.some((step: { type: string }) => step.type === 'waitForInput')) {
        await wait(run.workflowExecutionId, 'waiting_for_input');
        await read(`/api/workflows/executions/${run.workflowExecutionId}/resume`, { input: { approved: true } });
      }
      const execution = await wait(run.workflowExecutionId, specification.status);
      save(`${name}-execution`, execution);
      await read('http://127.0.0.1:9234/.workflows-step-executions*/_refresh', undefined, 'POST');
      const steps = await read('http://127.0.0.1:9234/.workflows-step-executions*/_search', { size: 100, query: { term: { workflowRunId: execution.id } } });
      save(`${name}-steps`, steps);
      const emitted = definition.steps.find((step: { type: string }) => ['workflow.output', 'workflow.fail'].includes(step.type));
      if (emitted) {
        assert.deepEqual(execution.context.output, emitted.with);
        const outputStep = steps.hits.hits.find((hit: { _source: { stepId: string } }) => hit._source.stepId === emitted.name)?._source;
        assert.equal(outputStep.stepType, 'workflow.output');
        assert.deepEqual(outputStep.output, emitted.with);
        if (emitted.type === 'workflow.fail') assert.equal(execution.error.message, emitted.with.message);
      } else if (specification.source === 'parallel.test.ts') {
        for (const stepId of ['readLeft', 'readRight']) {
          const values = steps.hits.hits.filter((hit: { _source: { stepId: string } }) => hit._source.stepId === stepId)
            .sort((a: { _source: { globalExecutionIndex: number } }, b: { _source: { globalExecutionIndex: number } }) => a._source.globalExecutionIndex - b._source.globalExecutionIndex)
            .map((hit: { _source: { output: { got: string } } }) => hit._source.output.got);
          assert.deepEqual(values, ['x', 'y']);
        }
      } else if (specification.source === 'variables.test.ts') {
        const debug = steps.hits.hits.find((hit: { _source: { stepId: string } }) => hit._source.stepId === 'debug')._source;
        assert.deepEqual(JSON.parse(debug.output), { primitive: 42, array: ['1', '2', '4', '6', '3', '2', '4', '6', '5', '2', '4', '6'] });
      } else if (specification.source === 'output_eviction.test.ts') {
        const result = steps.hits.hits.find((hit: { _source: { stepId: string } }) => hit._source.stepId === 'result')._source;
        assert.deepEqual(JSON.parse(result.output), ['a', 'b', 'c']);
      } else {
        assert(steps.hits.hits.some((hit: { _source: { stepId: string; output: string } }) => hit._source.stepId === 'log' && hit._source.output === 'done'));
      }
      outcomes.push({ name, source: `${path}:${scenario.line}`, executionId: execution.id, status: execution.status, persistedBusinessAssertions: true });
    }
  }
  save('validation', { count: outcomes.length, outcomes, limitation: 'Existing scenario YAMLs + their business assertions, not an assertion that the complete original Jest suites ran remotely.' });
}
main().catch((error: Error) => { console.error(error.stack); process.exitCode = 1; });
