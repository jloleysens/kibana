/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { firstValueFrom } from 'rxjs';
import { injectedMetadataServiceMock } from '@kbn/core-injected-metadata-browser-mocks';
import { ThemeService } from './theme_service';

describe('ThemeService', () => {
  let themeService: ThemeService;
  let injectedMetadata: ReturnType<typeof injectedMetadataServiceMock.createSetupContract>;

  beforeEach(() => {
    themeService = new ThemeService();
    injectedMetadata = injectedMetadataServiceMock.createSetupContract();
  });

  describe('#setup', () => {
    it('exposes a `theme$` observable with the values provided by the injected metadata', async () => {
      injectedMetadata.getTheme.mockReturnValue({ version: 'v8', darkMode: true });
      const { theme$ } = themeService.setup({ injectedMetadata });
      const theme = await firstValueFrom(theme$);
      expect(theme).toEqual({
        darkMode: true,
      });
    });

    it('#getTheme() returns the current theme', async () => {
      injectedMetadata.getTheme.mockReturnValue({ version: 'v8', darkMode: true });
      const setup = themeService.setup({ injectedMetadata });
      const theme = setup.getTheme();
      expect(theme).toEqual({
        darkMode: true,
      });
    });
  });

  describe('#start', () => {
    it('throws if called before `#setup`', () => {
      expect(() => {
        themeService.start();
      }).toThrowErrorMatchingInlineSnapshot(`"setup must be called before start"`);
    });

    it('exposes a `theme$` observable with the values provided by the injected metadata', async () => {
      injectedMetadata.getTheme.mockReturnValue({ version: 'v8', darkMode: true });
      themeService.setup({ injectedMetadata });
      const { theme$ } = themeService.start();
      const theme = await firstValueFrom(theme$);
      expect(theme).toEqual({
        darkMode: true,
      });
    });

    it('#getTheme() returns the current theme', async () => {
      injectedMetadata.getTheme.mockReturnValue({ version: 'v8', darkMode: true });
      themeService.setup({ injectedMetadata });
      const start = themeService.start();
      const theme = start.getTheme();
      expect(theme).toEqual({
        darkMode: true,
      });
    });
  });
});
