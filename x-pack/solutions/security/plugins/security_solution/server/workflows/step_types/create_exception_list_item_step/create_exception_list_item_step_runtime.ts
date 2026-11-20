/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import type { ExceptionListItem } from '@kbn/securitysolution-exceptions-common/api';
import type { createExceptionListItemStepCommonDefinition } from '../../../../common/workflows/step_types/create_exception_list_item_step/create_exception_list_item_step_common';
import {
  createExceptionItemInList,
  ExceptionItemStepAction,
  findExceptionItemForOwnList,
  toExceptionItemOutput,
  updateExceptionItemByItemId,
} from '../../utils/exception_item';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

const ACTION = ExceptionItemStepAction.CreateExceptionListItem;

export const handleCreateExceptionListItemStep: StepHandler<
  typeof createExceptionListItemStepCommonDefinition.inputSchema,
  typeof createExceptionListItemStepCommonDefinition.outputSchema
> = async (context) => {
  const {
    list_id: listId,
    namespace_type: namespaceType,
    item_id: itemId,
    overwrite,
    ...item
  } = context.input;

  try {
    let existingItem: ExceptionListItem | undefined;
    if (itemId !== undefined) {
      existingItem = await findExceptionItemForOwnList({
        contextManager: context.contextManager,
        action: ACTION,
        itemId,
        namespaceType,
        resolveOwnListId: () => Promise.resolve(listId),
      });
    }

    if (existingItem && !overwrite) {
      return toExceptionItemOutput(existingItem, 'skipped');
    }

    if (existingItem) {
      const updated = await updateExceptionItemByItemId(
        context.contextManager,
        ACTION,
        existingItem.item_id,
        namespaceType,
        item
      );
      return toExceptionItemOutput(updated, 'overwritten');
    }

    const created = await createExceptionItemInList(
      context.contextManager,
      ACTION,
      listId,
      namespaceType,
      itemId,
      item
    );

    return toExceptionItemOutput(created, 'created');
  } catch (error) {
    throw toApiExecutionError(error, ACTION);
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class CreateExceptionListItemStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.createExceptionListItem requires executor-local handler context');
    return handleCreateExceptionListItemStep(
      handlerContext as Parameters<typeof handleCreateExceptionListItemStep>[0]
    );
  }
}
