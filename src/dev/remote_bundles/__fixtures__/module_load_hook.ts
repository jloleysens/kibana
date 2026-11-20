/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const path = process.env.RUNNER_LOAD_LOG;
if (!path) throw new Error('RUNNER_LOAD_LOG is required');

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith('file:')) {
      appendFileSync(path, `${JSON.stringify({ pid: process.pid, url })}\n`);
    }
    return result;
  },
});
