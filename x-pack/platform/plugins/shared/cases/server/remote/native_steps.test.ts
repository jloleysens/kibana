/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remoteModule } from '.';
import { CasesClientOperations } from './client_operations';
import { createCasesClientMock } from '../client/mocks';
import { CaseSchema } from '../../common/types/domain/case/v1';
import {
  createCaseRequestFixture,
  createCaseResponseFixture,
} from '../../common/fixtures/create_case';
import { createStepHandlerContext } from '../workflows/steps/test_utils';
import { CreateCaseStep } from './create_case_step';

const contributions = remoteModule.contributions ?? [];

it('registers all33 Cases types as lazy original-handler contributions', () => {
  expect(contributions).toHaveLength(33);
  expect(new Set(contributions.map(({ stepType }) => stepType)).size).toBe(33);
});

it.each(contributions)(
  '$stepType refuses missing executor-local context',
  async ({ modulePath, exportName }) => {
    const Ctor =
      jest.requireActual<Record<string, new (api: CasesClientOperations) => RemoteWorkflowStep>>(
        modulePath
      )[exportName];
    const api = new CasesClientOperations(
      {
        get: jest.fn(),
        getRunState: jest.fn().mockReturnValue({
          workflowRunId: 'trusted-run',
          workflowId: 'trusted-workflow',
          workflowName: 'Persisted',
          spaceId: 'default',
          admittedChildren: new Set(),
        }),
        resolveStepOutputLimit: jest.fn(),
        admitChild: jest.fn(),
        getAbortSignal: () => new AbortController().signal,
      },
      jest.fn(),
      false,
      () => false
    );
    await expect(new Ctor(api).run('run', {}, {})).rejects.toThrow(
      'executor-local handler context'
    );
  }
);

it('executes the original create handler and original lower-level client operation without reconstructing context', async () => {
  const client = createCasesClientMock();
  const response = CaseSchema.parse({
    ...createCaseResponseFixture,
    comments: [],
    assignees: [],
    category: null,
    customFields: [],
  });
  client.cases.create.mockResolvedValue(response);
  const request = {};
  const api = new CasesClientOperations(
    {
      get: jest.fn().mockReturnValue(request),
      getRunState: jest.fn().mockReturnValue({
        workflowRunId: 'trusted-run',
        workflowId: 'trusted-workflow',
        workflowName: 'Persisted',
        spaceId: 'default',
        admittedChildren: new Set(),
      }),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
      getAbortSignal: () => new AbortController().signal,
    },
    jest.fn(async () => client),
    false,
    () => false
  );
  const context = createStepHandlerContext({ input: createCaseRequestFixture });
  context.contextManager.getContext = jest
    .fn()
    .mockReturnValue({ execution: { id: 'run' }, workflow: { id: 'workflow', name: 'Workflow' } });
  const result = await new CreateCaseStep(api).run('run', {}, { handlerContext: context });
  expect(result).toEqual({
    output: { case: expect.objectContaining({ id: createCaseResponseFixture.id }) },
  });
  expect(client.cases.create).toHaveBeenCalledTimes(1);
  expect(client.cases.create).toHaveBeenCalledWith(
    expect.objectContaining({ title: createCaseRequestFixture.title })
  );
});
