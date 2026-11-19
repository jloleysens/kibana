/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { InferenceConnectorType } from '@kbn/inference-common';
import type { InferenceConnectorAdapter } from '../types';

export const getInferenceAdapter = async (
  connectorType: InferenceConnectorType
): Promise<InferenceConnectorAdapter | undefined> => {
  switch (connectorType) {
    case InferenceConnectorType.OpenAI:
      return (await import('./openai')).openAIAdapter;

    case InferenceConnectorType.Gemini:
      return (await import('./gemini')).geminiAdapter;

    case InferenceConnectorType.Bedrock:
      return (await import('./bedrock')).bedrockClaudeAdapter;

    case InferenceConnectorType.Inference:
      return (await import('./inference')).inferenceAdapter;
  }

  return undefined;
};
