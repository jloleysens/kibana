/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** A Slack thread, by the workspace and channel ids and the thread's root message ts. */
export interface SlackThreadReference {
  workspace: string;
  channel: string;
  thread_ts: string;
  /** The Relay's key for the thread, when the event or post came through the Relay. */
  external_conversation_id?: string;
}

/**
 * The key the Relay and Agent Builder identify a Slack thread's conversation by
 * (`origin.external_conversation_id`), which is also the thread's subject id.
 * Channel ids are only unique within a workspace.
 */
export const toSlackThreadKey = ({
  workspace,
  channel,
  threadTs,
}: {
  workspace: string;
  channel: string;
  threadTs: string;
}): string => ['slack', workspace, channel, threadTs].map(encodeURIComponent).join(':');

/**
 * The thread's subject id: the Relay's key when given, otherwise the same key built from the
 * thread's ids.
 */
export const toSlackThreadSubjectId = ({
  workspace,
  channel,
  thread_ts: threadTs,
  external_conversation_id: externalConversationId,
}: SlackThreadReference): string =>
  externalConversationId || toSlackThreadKey({ workspace, channel, threadTs });

export const DEFAULT_MANUAL_INVESTIGATION_SUBJECT_ID = 'manual';
