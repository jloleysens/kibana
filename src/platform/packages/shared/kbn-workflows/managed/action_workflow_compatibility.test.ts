/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  ACTION_WORKFLOW_INPUT,
  ACTION_WORKFLOW_TAG,
  actionApprovalPolicySchema,
  actionCategorySchema,
  actionImpactSchema,
  actionMetadataSchema,
  actionSubjectKindSchema,
} from '@kbn/workflows-action-schema';
import { StepCategories, StepCategory } from '@kbn/workflows-runtime';
import {
  actionApprovalPolicySchema as managedApproval,
  actionCategorySchema as managedCategory,
  actionImpactSchema as managedImpact,
  ACTION_WORKFLOW_INPUT as managedInput,
  actionMetadataSchema as managedMetadata,
  actionSubjectKindSchema as managedSubject,
  ACTION_WORKFLOW_TAG as managedTag,
} from './action_workflow';
import {
  actionApprovalPolicySchema as rootApproval,
  actionCategorySchema as rootCategory,
  actionImpactSchema as rootImpact,
  ACTION_WORKFLOW_INPUT as rootInput,
  actionMetadataSchema as rootMetadata,
  StepCategories as rootStepCategories,
  StepCategory as rootStepCategory,
  actionSubjectKindSchema as rootSubject,
  ACTION_WORKFLOW_TAG as rootTag,
} from '..';

it('preserves every original public action-schema export by identity', () => {
  const original = [
    ACTION_WORKFLOW_INPUT,
    ACTION_WORKFLOW_TAG,
    actionApprovalPolicySchema,
    actionCategorySchema,
    actionImpactSchema,
    actionMetadataSchema,
    actionSubjectKindSchema,
  ];
  const root = [
    rootInput,
    rootTag,
    rootApproval,
    rootCategory,
    rootImpact,
    rootMetadata,
    rootSubject,
  ];
  const managed = [
    managedInput,
    managedTag,
    managedApproval,
    managedCategory,
    managedImpact,
    managedMetadata,
    managedSubject,
  ];
  original.forEach((value, index) => {
    expect(root[index]).toBe(value);
    expect(managed[index]).toBe(value);
  });
  expect(rootStepCategory).toBe(StepCategory);
  expect(rootStepCategories).toBe(StepCategories);
});

it('retains required approval policy, scalar bounds and original subject union', () => {
  expect(actionMetadataSchema.safeParse({ name: 'Action' }).success).toBe(false);
  expect(
    actionMetadataSchema.safeParse({ name: 'x'.repeat(257), approvalPolicy: 'always-gate' }).success
  ).toBe(false);
  expect(
    actionMetadataSchema.parse({
      name: 'Action',
      approvalPolicy: 'autonomy-dependent',
      subject: ['host', 'process'],
    })
  ).toEqual({ name: 'Action', approvalPolicy: 'autonomy-dependent', subject: ['host', 'process'] });
});
