/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';
import { nearestRank } from './load_statistics';

it('bounds original native conversation client first business execution and conversation/attachment/rerank step increments', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'conversation-budgets-'));
  try {
    const bundle = await buildRemoteBundle({
      manifests: discoverRemoteManifests(resolve(__dirname, '../../..')),
      graph: {
        id: 'workflows',
        root: 'workflows.executor',
        dependencies: ['workflows.stepCatalog'],
        contributions: ['workflows.step', 'workflows.connector'],
      },
      outdir: join(directory, 'bundle'),
    });
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [resolve(__dirname, '__fixtures__/conversation_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    const sharedLatencies: number[] = [];
    const clientLatencies: number[] = [];
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as {
        sharedHeap: number;
        sharedMs: number;
        sharedBytes: number;
        clientHeap: number;
        clientMs: number;
        clientBytes: number;
        events: Array<{ type: string; heapIncrement: number; ms: number }>;
      };
      process.stdout.write(`${JSON.stringify({ conversationCurve: result })}\n`);
      // Original native ES service, then shared original conversation client first valid read.
      expect(result.sharedHeap).toBeLessThanOrEqual(5_600_000);
      expect(result.sharedBytes).toBeLessThanOrEqual(2_800_000);
      expect(result.clientHeap).toBeLessThanOrEqual(6_600_000);
      expect(result.clientBytes).toBeLessThanOrEqual(1_730_000);
      sharedLatencies.push(result.sharedMs);
      clientLatencies.push(result.clientMs);
      expect(result.events.map(({ type }) => type)).toEqual([
        'ai.conversation.create',
        'ai.conversation.metadata.patch',
        'ai.conversation.add_event',
        'ai.conversation.metadata.read',
        'ai.conversation.add_user_message',
        'ai.attachment.add',
        'ai.attachment.update',
        'ai.attachment.read',
        'ai.attachment.list',
        'ai.attachment.delete',
        'search.rerank',
      ]);
      for (const event of result.events) {
        expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
      }
    }
    expect(nearestRank(sharedLatencies, 0.5)).toBeLessThanOrEqual(45);
    expect(nearestRank(clientLatencies, 0.5)).toBeLessThanOrEqual(45);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
