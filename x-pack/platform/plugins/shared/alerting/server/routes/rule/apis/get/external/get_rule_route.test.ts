/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { httpServiceMock } from '@kbn/core/server/mocks';
import { licenseStateMock } from '../../../../../lib/license_state.mock';
import { getRuleRoute } from './get_rule_route';

describe('getRuleRoute', () => {
  it('registers the route for self calls with public access', () => {
    const router = httpServiceMock.createRouter();

    getRuleRoute(router, licenseStateMock.create());

    expect(router.get).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/alerting/rule/{id}',
        options: expect.objectContaining({ access: 'public', selfCallable: true }),
      }),
      expect.any(Function)
    );
  });
});
