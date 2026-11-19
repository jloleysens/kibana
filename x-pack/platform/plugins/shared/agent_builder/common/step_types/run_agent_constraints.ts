/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Validation message shown when `ephemeral` is combined with `create-conversation`: a run that
 * stores nothing cannot create a conversation.
 */
export const EPHEMERAL_WITH_CREATE_CONVERSATION_MESSAGE =
  '`ephemeral` cannot be combined with `create-conversation`.';
