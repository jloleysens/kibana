import './index.scss';

import { UpgradeMePlugin } from './plugin';

// This exports static code and TypeScript types,
// as well as, Kibana Platform `plugin()` initializer.
export function plugin() {
  return new UpgradeMePlugin();
}
export { UpgradeMePluginSetup, UpgradeMePluginStart } from './types';
