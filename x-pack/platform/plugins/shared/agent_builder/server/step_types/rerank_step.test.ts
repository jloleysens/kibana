/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { createStepHandlerContext } from '../test_utils/workflow_steps';
import { rerankStepDefinition } from './rerank_step';

type Context = Parameters<typeof rerankStepDefinition.handler>[0];
const setup = (
  input: Context['input'],
  config: Context['config'] = { inference_id: 'endpoint' }
) => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const context = createStepHandlerContext({ input, config }) as Context;
  context.contextManager.getScopedEsClient = () => esClient;
  return { esClient, context };
};

it('preserves original full documents, rank-window tail and two-level field truncation', async () => {
  const data = [
    { title: 'First long', retained: 1 },
    { title: 'Second long', retained: 2 },
    { title: 'Tail', retained: 3 },
  ];
  const { esClient, context } = setup({
    data,
    rerank_text: 'Query',
    fields: [['title']],
    rank_window_size: 2,
    max_input_field_length: 5,
    max_input_total_length: 3,
  });
  esClient.inference.inference.mockResolvedValue({
    rerank: [
      { index: 1, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.1 },
    ],
  });
  expect(await rerankStepDefinition.handler(context)).toEqual({
    output: [data[1], data[0], data[2]],
  });
  expect(esClient.inference.inference).toHaveBeenCalledWith({
    inference_id: 'endpoint',
    task_type: 'rerank',
    query: 'Query',
    input: ['Fir', 'Sec'],
    timeout: '5m',
  });
});

it('keeps the original empty-input fast path without calling discovery or inference', async () => {
  const { esClient, context } = setup({
    data: [],
    rerank_text: 'Query',
    rank_window_size: 100,
    max_input_field_length: 1000,
    max_input_total_length: 2000,
  });
  expect(await rerankStepDefinition.handler(context)).toEqual({ output: [] });
  expect(esClient.inference.inference).not.toHaveBeenCalled();
  expect(esClient.inference.get).not.toHaveBeenCalled();
});

it('keeps original endpoint discovery and prefers Elastic-hosted rerank over self-hosted', async () => {
  const { esClient, context } = setup(
    {
      data: ['First', 'Second'],
      rerank_text: 'Query',
      rank_window_size: 100,
      max_input_field_length: 1000,
      max_input_total_length: 2000,
    },
    {}
  );
  esClient.inference.get.mockResolvedValue({
    endpoints: [
      {
        inference_id: 'self-hosted',
        service: 'elasticsearch',
        task_type: 'rerank',
        service_settings: {},
      },
      {
        inference_id: 'elastic-hosted',
        service: 'elastic',
        task_type: 'rerank',
        service_settings: {},
      },
    ],
  });
  esClient.inference.inference.mockResolvedValue({
    rerank: [
      { index: 1, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.1 },
    ],
  });
  expect(await rerankStepDefinition.handler(context)).toEqual({ output: ['Second', 'First'] });
  expect(esClient.inference.get).toHaveBeenCalledWith({
    inference_id: '_all',
    task_type: 'rerank',
  });
  expect(esClient.inference.inference).toHaveBeenCalledWith(
    expect.objectContaining({ inference_id: 'elastic-hosted' })
  );
});

it('keeps original provider error identity and original error projection', async () => {
  const { esClient, context } = setup({
    data: ['First'],
    rerank_text: 'Query',
    rank_window_size: 100,
    max_input_field_length: 1000,
    max_input_total_length: 2000,
  });
  const error = new Error('Original provider denied');
  esClient.inference.inference.mockRejectedValue(error);
  expect(await rerankStepDefinition.handler(context)).toEqual({ error });
  expect(context.logger.error).toHaveBeenCalledWith('Rerank step failed', error);
});
