/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { isConnectorAuthorizationError } from '../../src/errors/connector_authorization_error';
import type { SpecRuntimeApi } from './tokens';
import { TavilyConnector } from './tavily';
import { TavilyConnector as TavilyConnectorSpec } from '../../src/specs/tavily/tavily';
import { SharepointServerConnector } from './sharepoint_server';
import { SharepointServer as SharepointServerSpec } from '../../src/specs/sharepoint_server/sharepoint_server';
import { GreynoiseConnector } from './greynoise';
import { GreyNoiseConnector as GreyNoiseConnectorSpec } from '../../src/specs/greynoise/greynoise';
import { JinaReaderConnector } from './jina_reader';
import { JinaReaderConnector as JinaReaderConnectorSpec } from '../../src/specs/jina/jina_reader';
import { ShodanConnector } from './shodan';
import { ShodanConnector as ShodanConnectorSpec } from '../../src/specs/shodan/shodan';
import { UrlvoidConnector } from './urlvoid';
import { URLVoidConnector as URLVoidConnectorSpec } from '../../src/specs/urlvoid/urlvoid';
import { BraveSearchConnector } from './brave_search';
import { BraveSearchConnector as BraveSearchConnectorSpec } from '../../src/specs/brave_search/brave_search';
import { AwsLambdaConnector } from './aws_lambda';
import { AwsLambdaConnector as AwsLambdaConnectorSpec } from '../../src/specs/aws_lambda/aws_lambda';
import { AmazonS3Connector } from './amazon_s3';
import { AmazonS3 as AmazonS3Spec } from '../../src/specs/amazon_s3/amazon_s3';
import { AzureBlobConnector } from './azure_blob';
import { AzureBlob as AzureBlobSpec } from '../../src/specs/azure_blob/azure_blob';

describe.each([
  {
    id: 'tavily_mcp',
    Connector: TavilyConnector,
    spec: TavilyConnectorSpec,
    operations: [
      'callTool',
      'listTools',
      'tavilyCrawl',
      'tavilyExtract',
      'tavilyMap',
      'tavilySearch',
    ],
  },
  {
    id: 'sharepoint-server',
    Connector: SharepointServerConnector,
    spec: SharepointServerSpec,
    operations: [
      'callRestApi',
      'downloadFile',
      'getFolderContents',
      'getListItems',
      'getLists',
      'getSitePageContents',
      'getWeb',
      'search',
    ],
  },
  {
    id: 'greynoise',
    Connector: GreynoiseConnector,
    spec: GreyNoiseConnectorSpec,
    operations: ['getIpContext', 'getMetadata', 'quickLookup', 'riotLookup'],
  },
  {
    id: 'jina',
    Connector: JinaReaderConnector,
    spec: JinaReaderConnectorSpec,
    operations: ['browse', 'fileToMarkdown', 'fileToRenderedImage', 'search'],
  },
  {
    id: 'shodan',
    Connector: ShodanConnector,
    spec: ShodanConnectorSpec,
    operations: ['countResults', 'getHostInfo', 'getServices', 'searchHosts'],
  },
  {
    id: 'urlvoid',
    Connector: UrlvoidConnector,
    spec: URLVoidConnectorSpec,
    operations: ['checkUrl', 'getDomainInfo', 'scanDomain', 'scanDomainStats'],
  },
  {
    id: 'brave-search',
    Connector: BraveSearchConnector,
    spec: BraveSearchConnectorSpec,
    operations: ['webSearch'],
  },
  {
    id: 'aws_lambda',
    Connector: AwsLambdaConnector,
    spec: AwsLambdaConnectorSpec,
    operations: ['getFunction', 'invoke', 'listFunctions'],
  },
  {
    id: 'amazon_s3',
    Connector: AmazonS3Connector,
    spec: AmazonS3Spec,
    operations: ['downloadFile', 'listBucketObjects', 'listBuckets'],
  },
  {
    id: 'azure-blob',
    Connector: AzureBlobConnector,
    spec: AzureBlobSpec,
    operations: ['getBlob', 'getBlobProperties', 'listBlobs', 'listContainers'],
  },
])('$id connector routing', ({ id, Connector, spec, operations }) => {
  it('preserves every original operation and its auth implementations', () => {
    expect(Object.keys(spec.actions).sort()).toEqual(operations);
  });

  it.each(operations)('routes %s through the original spec runtime', async (operation) => {
    const result = { status: 'ok' };
    const run = jest.fn<ReturnType<SpecRuntimeApi['run']>, Parameters<SpecRuntimeApi['run']>>(
      async () => result
    );
    const runtime: SpecRuntimeApi = { run, drain: jest.fn(), close: jest.fn() };
    const connector = new Connector(runtime);
    const signal = new AbortController().signal;
    const input = {
      connectorType: id,
      connectorNameOrId: 'referenced-connector',
      system: false,
      input: { subAction: operation, subActionParams: {} },
    };
    await expect(connector.run('scope', input, { signal })).resolves.toBe(result);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: spec.metadata }),
      {
        authTypes: expect.any(Array),
        isConnectorAuthorizationError,
      },
      'scope',
      input,
      signal
    );
    const [routedSpec, services] = run.mock.calls[0];
    expect(Object.keys(routedSpec.actions).sort()).toEqual(operations);
    expect(services.authTypes.map(({ id: authTypeId }) => authTypeId).sort()).toEqual(
      spec.auth?.types.map((type) => (typeof type === 'string' ? type : type.type)).sort()
    );
  });
});
