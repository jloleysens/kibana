/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createCensysConnector } from './censys_spec';

let kibanaVersionPromise: Promise<string> | undefined;

const getKibanaVersion = (): Promise<string> => {
  if (!kibanaVersionPromise) {
    kibanaVersionPromise = import('@kbn/repo-info').then(
      ({ kibanaPackageJson }) => kibanaPackageJson.version
    );
  }
  return kibanaVersionPromise;
};

export const CensysConnector = createCensysConnector(
  async (context) => context.kibanaVersion ?? (await getKibanaVersion())
);
