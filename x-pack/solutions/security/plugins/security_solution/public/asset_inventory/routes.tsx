/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SecuritySubPluginRoutes } from '../app/types';
import { SecurityPageName } from '../app/types';
import { ASSET_INVENTORY_PATH } from '../../common/constants';
import { PluginTemplateWrapper } from '../common/components/plugin_template_wrapper';
import { SecurityRoutePageWrapper } from '../common/components/security_route_page_wrapper';
import { AssetInventoryContainer } from './pages';

// Initializing react-query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    },
  },
});

export const AssetInventoryRoutes = () => (
  <QueryClientProvider client={queryClient}>
    <PluginTemplateWrapper>
      <SecurityRoutePageWrapper pageName={SecurityPageName.assetInventory}>
        <AssetInventoryContainer />
      </SecurityRoutePageWrapper>
    </PluginTemplateWrapper>
  </QueryClientProvider>
);

export const routes: SecuritySubPluginRoutes = [
  {
    path: ASSET_INVENTORY_PATH,
    component: AssetInventoryRoutes,
  },
];
