/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  SET_HYPOTHESES_TOOL_ID,
  SET_IMPACT_TOOL_ID,
} from '@kbn/agentic-investigations-plugin/common';

export const INVESTIGATION_TOOL_IDS = [SET_IMPACT_TOOL_ID, SET_HYPOTHESES_TOOL_ID] as const;

import { SANDBOX_BASH_TOOL_ID } from '../../tools/sandbox_bash/tool_ids';
import { SANDBOX_VIEW_FILE_TOOL_ID } from '../../tools/sandbox_bash/view_file_tool_ids';
import { SANDBOX_STR_REPLACE_TOOL_ID } from '../../tools/sandbox_bash/str_replace_tool_ids';
import { SANDBOX_WRITE_FILE_TOOL_ID } from '../../tools/sandbox_bash/write_file_tool_ids';

export const SANDBOX_TOOL_IDS = [
  SANDBOX_BASH_TOOL_ID,
  SANDBOX_VIEW_FILE_TOOL_ID,
  SANDBOX_STR_REPLACE_TOOL_ID,
  SANDBOX_WRITE_FILE_TOOL_ID,
] as const;
