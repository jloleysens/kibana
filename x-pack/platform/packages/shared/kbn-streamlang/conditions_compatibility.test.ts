/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import * as originalPublicEntry from '.';
import * as originalConditions from './types/conditions';
import * as conditions from '@kbn/streamlang-conditions';

const previousExports = [
  'ALWAYS_CONDITION',
  'ARRAY_OPERATORS',
  'BINARY_OPERATORS',
  'NEVER_CONDITION',
  'UNARY_OPERATORS',
  'alwaysConditionSchema',
  'andConditionSchema',
  'conditionSchema',
  'conditionSchemaStrict',
  'filterConditionSchema',
  'isAlwaysCondition',
  'isAndCondition',
  'isBinaryFilterCondition',
  'isCondition',
  'isConditionStrict',
  'isFilterCondition',
  'isNeverCondition',
  'isNotCondition',
  'isOrCondition',
  'isUnaryFilterCondition',
  'neverConditionSchema',
  'notConditionSchema',
  'operatorToHumanReadableNameMap',
  'orConditionSchema',
  'rangeConditionSchema',
  'shorthandBinaryFilterConditionSchema',
  'shorthandUnaryFilterConditionSchema',
  'stringOrNumberOrBoolean',
] as const;

it('preserves every original public condition export by identity', () => {
  expect(Object.keys(originalConditions).sort()).toEqual([...previousExports]);
  expect(Object.keys(conditions).sort()).toEqual([...previousExports]);
  for (const name of previousExports) {
    expect(originalPublicEntry[name]).toBe(conditions[name]);
    expect(originalConditions[name]).toBe(conditions[name]);
  }
});
