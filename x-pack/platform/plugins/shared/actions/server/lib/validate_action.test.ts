/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { TaskErrorSource } from '@kbn/task-manager-plugin/common';
import { actionsConfigMock } from '../actions_config.mock';
import { getConnectorType } from '../fixtures';
import { ActionExecutionError, ActionExecutionErrorReason } from './errors/action_execution_error';
import { validateAction } from './validate_action';

const services = { configurationUtilities: actionsConfigMock.create() };
const actionType = getConnectorType({
  id: '.validation-test',
  name: 'validation-test',
  validate: {
    params: { schema: z.object({ message: z.string() }) },
    config: { schema: z.object({ url: z.string().default('https://example.com') }) },
    secrets: { schema: z.object({ password: z.string() }) },
  },
});
const input = {
  actionId: 'referenced',
  actionType,
  params: { message: 'business' },
  config: {},
  secrets: { password: 'secret' },
};

it('runs the original validators and returns their normalized values', () => {
  expect(validateAction(input, services, TaskErrorSource)).toEqual({
    validatedParams: { message: 'business' },
    validatedConfig: { url: 'https://example.com' },
    validatedSecrets: { password: 'secret' },
  });
});

it.each([false, true])(
  'retains validation source, order and scheduled retry policy (scheduled=%s)',
  (scheduled) => {
    const taskInfo = scheduled ? { scheduled: new Date(), attempts: 1 } : undefined;
    for (const [overrides, errorSource] of [
      [{ params: {} }, TaskErrorSource.USER],
      [{ config: { url: 17 } }, TaskErrorSource.FRAMEWORK],
      [{ secrets: {} }, TaskErrorSource.FRAMEWORK],
      [{ params: {}, config: { url: 17 }, secrets: {} }, TaskErrorSource.USER],
    ] as const) {
      try {
        validateAction({ ...input, ...overrides, taskInfo }, services, TaskErrorSource);
        throw new Error('Expected validation to refuse invalid input');
      } catch (error) {
        expect(error).toBeInstanceOf(ActionExecutionError);
        expect(error).toMatchObject({
          reason: ActionExecutionErrorReason.Validation,
          result: { actionId: 'referenced', status: 'error', retry: scheduled, errorSource },
        });
      }
    }
  }
);

it('retains the original cross-field validator inputs and failure classification', () => {
  const connector = jest.fn().mockReturnValue('invalid combination');
  const withConnector = { ...actionType, validate: { ...actionType.validate, connector } };
  expect(() =>
    validateAction({ ...input, actionType: withConnector }, services, TaskErrorSource)
  ).toThrow('invalid combination');
  expect(connector).toHaveBeenCalledWith(input.config, input.secrets);
  try {
    validateAction({ ...input, actionType: withConnector }, services, TaskErrorSource);
  } catch (error) {
    expect(error).toMatchObject({
      result: { errorSource: TaskErrorSource.FRAMEWORK, retry: false },
    });
  }
});
