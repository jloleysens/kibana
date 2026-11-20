/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { chatSystemIndex, chatSystemIndexPrefix } from '@kbn/agent-builder-common';
import { chatSystemIndex as oldRoot, chatSystemIndexPrefix as oldPrefix } from '.';
import { chatSystemIndex as oldModule } from './indices';

it('preserves both original index-name export identities and values', () => {
  expect(oldRoot).toBe(chatSystemIndex);
  expect(oldModule).toBe(chatSystemIndex);
  expect(oldPrefix).toBe(chatSystemIndexPrefix);
  expect(chatSystemIndex('conversations')).toBe('.chat-conversations');
});
