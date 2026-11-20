/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  MAX_SHORT_STRING_LENGTH,
  MAX_MEDIUM_STRING_LENGTH,
  MAX_ID_LENGTH,
  MAX_RULE_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_ARRAY_LENGTH,
  MAX_TIMESTAMP_LENGTH,
  SIGNIFICANT_EVENTS_ALERT_SOURCE,
} from '@kbn/significant-events-runtime';
import {
  MAX_SHORT_STRING_LENGTH as short,
  MAX_MEDIUM_STRING_LENGTH as medium,
  MAX_ID_LENGTH as id,
  MAX_RULE_NAME_LENGTH as rule,
  MAX_TITLE_LENGTH as title,
  MAX_TEXT_LENGTH as text,
  MAX_ARRAY_LENGTH as array,
  MAX_TIMESTAMP_LENGTH as timestamp,
  SIGNIFICANT_EVENTS_ALERT_SOURCE as source,
} from './constants';
import {
  MAX_ID_LENGTH as rootId,
  MAX_TEXT_LENGTH as rootText,
  MAX_ARRAY_LENGTH as rootArray,
} from '../..';

it('preserves every original scalar and the existing public-root exports', () => {
  const actual = [
    MAX_SHORT_STRING_LENGTH,
    MAX_MEDIUM_STRING_LENGTH,
    MAX_ID_LENGTH,
    MAX_RULE_NAME_LENGTH,
    MAX_TITLE_LENGTH,
    MAX_TEXT_LENGTH,
    MAX_ARRAY_LENGTH,
    MAX_TIMESTAMP_LENGTH,
    SIGNIFICANT_EVENTS_ALERT_SOURCE,
  ];
  expect(actual).toEqual([255, 512, 255, 255, 512, 10_000, 100, 64, 'elastic.significant_events']);
  expect([short, medium, id, rule, title, text, array, timestamp, source]).toEqual(actual);
  expect([rootId, rootText, rootArray]).toEqual([MAX_ID_LENGTH, MAX_TEXT_LENGTH, MAX_ARRAY_LENGTH]);
});
