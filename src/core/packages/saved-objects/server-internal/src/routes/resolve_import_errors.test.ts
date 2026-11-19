/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Readable } from 'node:stream';
import { chain } from 'lodash';
import { httpServerMock, httpServiceMock } from '@kbn/core-http-server-mocks';
import { typeRegistryMock } from '@kbn/core-saved-objects-base-server-mocks';
import {
  SavedObjectConfig,
  savedObjectsConfig,
  savedObjectsMigrationConfig,
} from '@kbn/core-saved-objects-base-server-internal';
import { registerResolveImportErrorsRoute } from './resolve_import_errors';

it.each([
  { types: [] },
  { types: ['hidden', 'hidden', 'visible', 'private', 'other', 'other'] },
  { types: ['visible', 'private'] },
])('matches original chain-based hidden-type selection for $types', async ({ types }) => {
  const router = httpServiceMock.createInternalSetupContract().createRouter('');
  const typeRegistry = typeRegistryMock.create();
  typeRegistry.isHidden.mockImplementation((type) => type !== 'visible');
  typeRegistry.isImportableAndExportable.mockImplementation((type) => type !== 'private');
  const coreUsageData = {
    getClient: () => ({
      incrementSavedObjectsResolveImportErrors: jest.fn().mockResolvedValue(null),
    }),
  };
  const config = new SavedObjectConfig(
    savedObjectsConfig.schema.validate({}),
    savedObjectsMigrationConfig.schema.validate({})
  );
  registerResolveImportErrorsRoute(router, { config, coreUsageData });
  const [, handler] = router.post.mock.calls[0];
  const getClient = jest.fn();
  const resolveImportErrors = jest.fn().mockResolvedValue({ success: true });
  const retries = types.map((type, index) => ({ type, id: String(index) }));
  const response = httpServerMock.createResponseFactory();

  await handler(
    {
      core: Promise.resolve({
        savedObjects: {
          typeRegistry,
          getClient,
          getImporter: () => ({ resolveImportErrors }),
        },
      }),
    },
    httpServerMock.createKibanaRequest({
      query: { createNewCopies: false, compatibilityMode: false },
      body: {
        file: Object.assign(Readable.from(['{"type":"hidden","id":"1"}\n']), {
          hapi: { filename: 'objects.ndjson' },
        }),
        retries,
      },
    }),
    response
  );

  const originalIncludedHiddenTypes = chain(retries)
    .map('type')
    .uniq()
    .filter((type) => typeRegistry.isHidden(type) && typeRegistry.isImportableAndExportable(type))
    .value();
  expect(getClient).toHaveBeenCalledWith({ includedHiddenTypes: originalIncludedHiddenTypes });
  expect(resolveImportErrors).toHaveBeenCalledWith(expect.objectContaining({ retries }));
  expect(response.ok).toHaveBeenCalledWith({ body: { success: true } });
});
