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

const clients = resolve(
  __dirname,
  '../../platform/packages/shared/kbn-connector-specs/src/lib/clients'
);
const mib = 1024 * 1024;
// Cold standalone imports include their shared dependencies; actual MCP execution retains its 4MiB guard.
const capabilities = [
  { name: 'registry', entry: join(clients, 'get_client_type.ts'), bytes: 1024, heap: 96 * 1024 },
  { name: 'mongodb-driver', entry: 'mongodb', bytes: 2.75 * mib, heap: 8 * mib },
  { name: 'mssql-driver', entry: 'mssql', bytes: 4 * mib, heap: 8 * mib },
  { name: 'mysql-driver', entry: 'mysql2/promise', bytes: 1.75 * mib, heap: 3.25 * mib },
];

it.each(capabilities)(
  'bounds lazy $name emitted bytes and cold import-only heap',
  async ({ name, entry, bytes, heap }) => {
    const directory = mkdtempSync(join(tmpdir(), 'native-client-capability-'));
    try {
      const outfile = join(directory, 'capability.mjs');
      const factoryImports: string[] = [];
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        write: true,
        metafile: true,
        banner: {
          js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
        },
        plugins:
          name === 'registry'
            ? [
                {
                  name: 'separate-client-factories',
                  setup(builder) {
                    builder.onResolve(
                      { filter: /^\.\/(mcp_client_type|mongodb_client_type|mssql|mysql)$/ },
                      (args) => {
                        factoryImports.push(args.kind);
                        if (args.kind !== 'dynamic-import')
                          throw new Error('Client factories must remain lazy');
                        return { path: args.path, external: true };
                      }
                    );
                  },
                },
              ]
            : [],
      });
      const emittedBytes = Object.values(result.metafile.outputs).reduce(
        (total, output) => total + output.bytes,
        0
      );
      expect(emittedBytes).toBeLessThanOrEqual(bytes);
      if (name === 'registry') expect(factoryImports).toEqual(Array(4).fill('dynamic-import'));
      const probe = join(directory, 'probe.mjs');
      await build({
        entryPoints: [resolve(__dirname, '__fixtures__/client_import_probe.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: probe,
      });
      for (let index = 0; index < 3; index++) {
        const sample: { heapIncrement: number } = JSON.parse(
          execFileSync(process.execPath, ['--expose-gc', probe, outfile], { encoding: 'utf8' })
        );
        expect(sample.heapIncrement).toBeLessThanOrEqual(heap);
        process.stdout.write(
          JSON.stringify({
            clientCapability: name,
            emittedBytes,
            ...sample,
            qualification: 'cold standalone import only, not client construction/network',
          }) + '\n'
        );
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  }
);
