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
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

it.each(['in_process', 'child_process'] as const)(
  '%s: executes native spec getClient MCP and original non-workflow MySQL through serialized RPC',
  async (backend) => {
    const directory = mkdtempSync(join(tmpdir(), 'get-client-probe-'));
    try {
      const probe = join(directory, 'probe.cjs');
      await build({
        entryPoints: [resolve(__dirname, '__fixtures__/get_client_backends_probe.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['@kbn/*', 'esbuild', 'typescript', 'mysql2'],
        banner: {
          js: `require = require('node:module').createRequire(${JSON.stringify(
            resolve(__dirname, '../../../package.json')
          )});`,
        },
        outfile: probe,
      });
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--expose-gc',
            '--require',
            resolve(__dirname, '../../setup_node_env'),
            probe,
            resolve(__dirname, '__fixtures__/get_client_plugin'),
            backend,
          ],
          { encoding: 'utf8' }
        )
      );
      expect(result.backend).toBe(backend);
      expect(result.outputs).toHaveLength(2);
      expect(result.finalizations).toHaveLength(2);
      process.stdout.write(JSON.stringify(result) + '\n');
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
  30_000
);
