/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { Metafile } from 'esbuild';
const dir = resolve(process.argv[2]);
const m: Metafile = JSON.parse(readFileSync(dir + '/metafile.json', 'utf8'));
const rows = [];
const sample = () => {
  assert(global.gc);
  global.gc();
  return process.memoryUsage();
};
const files = [
  '/remote/spec_runtime_impl.ts',
  '/openai/openai_sdk.ts',
  '/bedrock/bedrock_sdk.ts',
  '/lib/google_auth_sdk.ts',
  '/token_tracking/gen_ai_token_tracking.ts',
];
for (const path of files) {
  const found = Object.entries(m.outputs).find(([, v]) => v.entryPoint?.endsWith(path));
  assert(found, path);
  const [p] = found;
  const before = sample();
  const start = performance.now();
  const exports = await import(pathToFileURL(resolve(p)).href);
  if (path.includes('openai_sdk'))
    exports.createOpenAIClient({ apiKey: 'fake', baseURL: 'http://127.0.0.1' });
  if (path.includes('bedrock_sdk')) {
    const client = exports.createBedrockClient({
      region: 'us-east-1',
      credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
      agents: {},
    });
    client.destroy();
  }
  if (path.includes('gen_ai_token_tracking'))
    assert.deepEqual(
      await exports.getGenAiTokenTracking({
        actionTypeId: '.gen-ai',
        logger: { error() {} },
        validatedParams: { subAction: 'run' },
        result: {
          status: 'ok',
          data: { usage: { total_tokens: 2, prompt_tokens: 1, completion_tokens: 1 } },
        },
      }),
      { total_tokens: 2, prompt_tokens: 1, completion_tokens: 1, telemetry_metadata: undefined }
    );
  const ms = performance.now() - start;
  await new Promise((r) => setImmediate(r));
  const after = sample();
  rows.push({
    path,
    ms,
    heapIncrement: after.heapUsed - before.heapUsed,
    rssIncrement: after.rss - before.rss,
    before,
    after,
    scope: path.includes('google_auth_sdk')
      ? 'import only (real JWT exchange separately persisted)'
      : 'import plus first client construction / tracking call',
  });
}
process.stdout.write(JSON.stringify({ pid: process.pid, rows }));
