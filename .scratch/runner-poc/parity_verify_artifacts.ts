import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const profiles = ['parity-final-child', 'parity-final-loopback', 'parity-final-stream-child', 'parity-final-stream-loopback'];
const root = '.scratch/runner-poc';
const headers = { authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`, 'content-type': 'application/json', 'x-elastic-product-origin': 'kibana' };
const results: object[] = [];
async function main() {
  for (const profile of profiles) {
    const ids = new Map<string, { id: string; status: string }>();
    for (const part of ['outcome', 'existing']) {
      const directory = `${root}/${profile}/${part}`;
      assert(JSON.parse(readFileSync(`${directory}/validation.json`, 'utf8')));
      for (const file of readdirSync(directory).filter((name) => name.endsWith('-execution.json') && !name.includes('-parked-'))) {
        const execution = JSON.parse(readFileSync(`${directory}/${file}`, 'utf8'));
        assert(['completed', 'failed', 'cancelled', 'timed_out'].includes(execution.status));
        ids.set(execution.id, execution);
      }
    }
    const rows: object[] = [];
    for (const execution of ids.values()) {
      let logCount = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch('http://127.0.0.1:9234/.workflows-execution-data-stream-logs/_search', { method: 'POST', headers, body: JSON.stringify({ size: 100, query: { term: { 'workflow.execution_id': execution.id } } }) });
        assert(response.ok);
        const logs = await response.json();
        logCount = logs.hits.total.value;
        if (logCount > 0) break;
        await delay(200);
      }
      assert(logCount > 0, `Missing durable logs for ${execution.id}`);
      rows.push({ id: execution.id, status: execution.status, logCount });
    }
    results.push({ profile, count: rows.length, executions: rows });
  }
  writeFileSync(`${root}/parity-final-artifact-validation.json`, JSON.stringify({ profiles: results, note: 'Independent replay-free validation of final run artifacts and durable log existence. Business output/state assertions are in each source-named harness.' }, null, 2));
}
main().catch((error: Error) => { console.error(error); process.exitCode = 1; });
