/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import type { IScopedClusterClient, Logger } from '@kbn/core/server';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import type { ISearchClient } from '@kbn/data-plugin/common';
import { createSearchSourceMock } from '@kbn/data-plugin/common/search/search_source/mocks';
import { createSearchRequestHandlerContext } from '@kbn/data-plugin/server/search/mocks';
import type { SearchCursor, SearchCursorSettings } from './search_cursor';
import { SearchCursorScroll } from './search_cursor_scroll';

describe('CSV Export Search Cursor', () => {
  let settings: SearchCursorSettings;
  let es: IScopedClusterClient;
  let data: ISearchClient;
  let logger: Logger;
  let cursor: SearchCursor;

  beforeEach(async () => {
    settings = {
      scroll: {
        duration: '10m',
        size: 500,
      },
      includeFrozen: false,
      maxConcurrentShardRequests: 5,
    };

    es = elasticsearchServiceMock.createScopedClusterClient();
    data = createSearchRequestHandlerContext();
    jest.spyOn(es.asCurrentUser, 'openPointInTime').mockResolvedValue({ id: 'simply-scroll-id' });

    logger = loggingSystemMock.createLogger();

    cursor = new SearchCursorScroll('test-index-pattern-string', settings, { data, es }, logger);
    await cursor.initialize();
  });

  it('supports scan/scroll', async () => {
    const scanSpy = jest
      // @ts-expect-error create spy on private method
      .spyOn(cursor, 'scan')
      // @ts-expect-error mock resolved value for spy on private method
      .mockResolvedValueOnce({ rawResponse: { hits: [] } });

    const searchSource = createSearchSourceMock();
    await cursor.getPage(searchSource);
    expect(scanSpy).toBeCalledTimes(1);
  });

  it('can update internal cursor ID', () => {
    cursor.updateIdFromResults({ _scroll_id: 'not-unusual-scroll-id', hits: { hits: [] } });
    // @ts-expect-error private field
    expect(cursor.cursorId).toBe('not-unusual-scroll-id');
  });
});
