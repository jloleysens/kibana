/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import '../../__mocks__/engine_logic.mock';

import React from 'react';

import { shallow } from 'enzyme';

import { Synonyms } from './';

describe('Synonyms', () => {
  it('renders', () => {
    shallow(<Synonyms />);
    // TODO: Check for Synonym cards, Synonym modal
  });
});
