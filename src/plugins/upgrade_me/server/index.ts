import { PluginInitializerContext } from '../../../core/server';
import { UpgradeMePlugin } from './plugin';

//  This exports static code and TypeScript types,
//  as well as, Kibana Platform `plugin()` initializer.

export function plugin(initializerContext: PluginInitializerContext) {
  return new UpgradeMePlugin(initializerContext);
}

export { UpgradeMePluginSetup, UpgradeMePluginStart } from './types';
