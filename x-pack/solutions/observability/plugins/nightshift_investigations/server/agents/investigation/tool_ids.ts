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
