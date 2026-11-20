/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const RECORD_REMEDIATION_TOOL_ID = 'nightshift_record_remediation';
export const RECORD_SYSTEM_LEARNING_TOOL_ID = 'nightshift_record_system_learning';
export const RECORD_TOOL_LEARNING_TOOL_ID = 'nightshift_record_tool_learning';

/**
 * Learning tools the reinforcement agent gets only on follow-up turns. An initial investigation
 * has had no human correction yet, so there is nothing durable to record.
 */
export const DECISION_TREE_LEARNING_TOOL_IDS = [
  RECORD_SYSTEM_LEARNING_TOOL_ID,
  RECORD_TOOL_LEARNING_TOOL_ID,
  RECORD_REMEDIATION_TOOL_ID,
] as const;
