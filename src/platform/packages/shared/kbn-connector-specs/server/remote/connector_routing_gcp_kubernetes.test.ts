/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { SpecRuntimeApi } from './tokens';
import { GcpIamConnector } from './gcp_iam';
import { GcpIam as GcpIamConnectorSpec } from '../../src/specs/gcp_iam/gcp_iam';
import { GcpSecretManagerConnector } from './gcp_secret_manager';
import { GcpSecretManager as GcpSecretManagerConnectorSpec } from '../../src/specs/gcp_secret_manager/gcp_secret_manager';
import { BigQueryConnector } from './bigquery';
import { BigQuery as BigQueryConnectorSpec } from '../../src/specs/bigquery/bigquery';
import { GcpCloudFunctionsConnector } from './gcp_cloud_functions';
import { GcpCloudFunctionsConnector as GcpCloudFunctionsConnectorSpec } from '../../src/specs/gcp_cloud_functions/gcp_cloud_functions';
import { KubernetesConnector } from './kubernetes';
import { KubernetesConnector as KubernetesConnectorSpec } from '../../src/specs/kubernetes/kubernetes';

describe.each([
  {
    id: 'gcp_iam',
    Connector: GcpIamConnector,
    spec: GcpIamConnectorSpec,
    operations: [
      'addIamPolicyBinding',
      'createServiceAccount',
      'createServiceAccountKey',
      'deleteServiceAccount',
      'deleteServiceAccountKey',
      'disableServiceAccount',
      'disableServiceAccountKey',
      'enableServiceAccount',
      'enableServiceAccountKey',
      'getIamPolicy',
      'getRole',
      'getServiceAccount',
      'listServiceAccountKeys',
      'listServiceAccounts',
      'queryGrantableRoles',
      'removeIamPolicyBinding',
      'setIamPolicy',
      'testIamPermissions',
      'undeleteServiceAccount',
    ],
    auth: ['gcp_service_account'],
  },
  {
    id: 'gcp_secret_manager',
    Connector: GcpSecretManagerConnector,
    spec: GcpSecretManagerConnectorSpec,
    operations: [
      'accessSecretVersion',
      'addSecretVersion',
      'createSecret',
      'deleteSecret',
      'destroySecretVersion',
      'disableSecretVersion',
      'enableSecretVersion',
      'getSecret',
      'getSecretIamPolicy',
      'getSecretVersion',
      'listSecretVersions',
      'listSecrets',
      'setSecretIamPolicy',
      'updateSecret',
    ],
    auth: ['gcp_service_account'],
  },
  {
    id: 'bigquery',
    Connector: BigQueryConnector,
    spec: BigQueryConnectorSpec,
    operations: ['executeQuery', 'getQueryResults', 'listDatasets', 'runQuery'],
    auth: ['gcp_service_account'],
  },
  {
    id: 'gcp_cloud_functions',
    Connector: GcpCloudFunctionsConnector,
    spec: GcpCloudFunctionsConnectorSpec,
    operations: ['getFunction', 'invoke', 'listFunctions'],
    auth: ['gcp_service_account'],
  },
  {
    id: 'kubernetes',
    Connector: KubernetesConnector,
    spec: KubernetesConnectorSpec,
    operations: [
      'applyResource',
      'createResource',
      'deleteResource',
      'getPodLogs',
      'getResource',
      'listEvents',
      'listNamespaces',
      'listResources',
      'patchResource',
      'request',
      'scaleWorkload',
    ],
    auth: ['bearer_with_tls', 'kubernetes_gke', 'kubernetes_eks', 'kubernetes_aks'],
  },
])('$id native routing', ({ id, Connector, spec, operations, auth }) => {
  it('covers all original operation and auth definitions without substituting handlers', async () => {
    expect(Object.keys(spec.actions).sort()).toEqual([...operations].sort());
    const run = jest.fn();
    const runtime: SpecRuntimeApi = { run, drain: jest.fn(), close: jest.fn() };
    const signal = new AbortController().signal;
    const input = { connectorType: id };
    await new Connector(runtime).run('scope', input, { signal });
    expect(run).toHaveBeenCalledWith(
      spec,
      expect.objectContaining({ authTypes: expect.any(Array) }),
      'scope',
      input,
      signal
    );
    expect(
      run.mock.calls[0][1].authTypes.map((definition: { id: string }) => definition.id)
    ).toEqual(auth);
  });
});
