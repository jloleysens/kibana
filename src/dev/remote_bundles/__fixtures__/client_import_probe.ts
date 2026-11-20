/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
assert(global.gc);
global.gc();
const before = process.memoryUsage().heapUsed;
await import(pathToFileURL(process.argv[2]).href);
await new Promise((done) => setImmediate(done));
global.gc();
process.stdout.write(JSON.stringify({ heapIncrement: process.memoryUsage().heapUsed - before }));
