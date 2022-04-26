import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '../../../core/server';

import { UpgradeMePluginSetup, UpgradeMePluginStart } from './types';
import { defineRoutes } from './routes';

export class UpgradeMePlugin implements Plugin<UpgradeMePluginSetup, UpgradeMePluginStart> {
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    this.logger.debug('upgradeMe: Setup');
    const router = core.http.createRouter();

    // Register server side APIs
    defineRoutes(router);

    return {};
  }

  public start(core: CoreStart) {
    this.logger.debug('upgradeMe: Started');
    return {};
  }

  public stop() {}
}
