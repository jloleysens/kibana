import { NavigationPublicPluginStart } from '../../navigation/public';

export interface UpgradeMePluginSetup {
  getGreeting: () => string;
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface UpgradeMePluginStart {}

export interface AppPluginStartDependencies {
  navigation: NavigationPublicPluginStart;
}
