/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import OpenAI from 'openai';

/** Loads the OpenAI SDK only for SDK-backed connector execution. */
export const createOpenAIClient = (options: ConstructorParameters<typeof OpenAI>[0]): OpenAI =>
  new OpenAI(options);
