/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { rootCertificates } from 'node:tls';
import { Agent, getGlobalDispatcher, type Dispatcher } from 'undici';
import type { IBasePath, HttpSelfClientSslConfig } from '@kbn/core-http-server';
import type { HttpConfig } from './http_config';

export interface SelfHttpConfig {
  readonly selfHttp: Pick<HttpConfig['selfHttp'], 'ssl' | 'maxRedirects'>;
  readonly ssl: Pick<
    HttpConfig['ssl'],
    'certificate' | 'certificateAuthorities' | 'enabled' | 'requestCert' | 'rejectUnauthorized'
  >;
}

type VerificationMode = HttpConfig['selfHttp']['ssl']['verificationMode'];

type ConnectOptions = NonNullable<Agent.Options['connect']>;

interface SelfHttpDispatcherProviderParams {
  readonly basePath: IBasePath;
  readonly getHttpConfig: () => SelfHttpConfig;
  readonly target: 'auto' | 'local';
  readonly ssl?: Readonly<Record<'local' | 'public', HttpSelfClientSslConfig>>;
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

const extractLeafCertificate = (certificate: string): string => {
  return certificate.match(PEM_CERTIFICATE)?.[0] ?? certificate;
};

const buildConnectOptions = (
  verificationMode: VerificationMode,
  certificateAuthorities: readonly string[],
  { exclusiveTrust = false }: { exclusiveTrust?: boolean } = {}
): ConnectOptions => {
  // Omitting `ca` keeps Node's default trust store, which includes NODE_EXTRA_CA_CERTS.
  // Passing `rootCertificates` instead would replace it and trust less than `full` does.
  // Exclusive trust is the local-`full` pin: only this process's leaf, no public roots.
  // Exclusive trust still needs partial-chain: a CA-issued leaf is not a
  // self-signed root, but it is the only acceptable trust endpoint.
  const connect: ConnectOptions = exclusiveTrust
    ? { ca: [...certificateAuthorities], allowPartialTrustChain: true }
    : certificateAuthorities.length === 0
    ? {}
    : { ca: [...rootCertificates, ...certificateAuthorities], allowPartialTrustChain: true };

  switch (verificationMode) {
    case 'none':
      return { ...connect, rejectUnauthorized: false };
    case 'certificate':
      return { ...connect, rejectUnauthorized: true, checkServerIdentity: () => undefined };
    case 'full':
      return { ...connect, rejectUnauthorized: true };
    default:
      throw new Error(`Unknown selfHttp.ssl.verificationMode: ${verificationMode}`);
  }
};

/** Applies a per-request headers timeout on top of any dispatcher's shared pool. */
export const withHeadersTimeout =
  (headersTimeout: number): Dispatcher.DispatcherComposeInterceptor =>
  (dispatch) =>
  (opts, handler) =>
    dispatch({ ...opts, headersTimeout }, handler);

export class SelfHttpDispatcherProvider {
  private readonly dispatchers = new Map<
    'local' | 'public',
    { agent?: Agent; trustKey?: string }
  >();

  constructor(private readonly params: SelfHttpDispatcherProviderParams) {}

  public get(
    url: URL,
    target: 'local' | 'public',
    headersTimeout?: number
  ): Dispatcher | undefined {
    const dispatcher = this.getBaseDispatcher(url, target);
    if (headersTimeout === undefined) {
      return dispatcher;
    }
    // Per-request timeouts compose over the shared dispatcher (or the global one for
    // plain HTTP), so every timeout value reuses the same connection pool. The composed
    // proxy holds no resources of its own, so there is nothing extra to close.
    return (dispatcher ?? getGlobalDispatcher()).compose(withHeadersTimeout(headersTimeout));
  }

  public async close(): Promise<void> {
    const dispatchers = [...this.dispatchers.values()];
    this.dispatchers.clear();
    await Promise.all(dispatchers.map(({ agent }) => agent?.close()));
  }

  public getSslConfig(target: 'local' | 'public'): HttpSelfClientSslConfig {
    if (this.params.ssl) {
      const ssl = this.params.ssl[target];
      return {
        verificationMode: ssl.verificationMode,
        certificateAuthorities: [...ssl.certificateAuthorities],
        exclusiveTrust: ssl.exclusiveTrust,
        clientCertificateRequired: ssl.clientCertificateRequired,
      };
    }
    const config = this.params.getHttpConfig();
    const usesLocalTarget = target === 'local';
    const configuredMode = config.selfHttp.ssl.verificationMode;
    // SslConfig already materializes PKCS#12 keystores into ssl.certificate.
    const localCertificate = usesLocalTarget ? config.ssl.certificate : undefined;
    // Local hops use this process's listener. The cert SAN is usually the public
    // hostname, not `localhost` / the bind address, so `full` would fail identity.
    // Pin the listener leaf only; honor explicit `certificate` / `none`.
    const pinLocalLeaf =
      usesLocalTarget && configuredMode === 'full' && typeof localCertificate === 'string';
    const additionalCertificateAuthorities = pinLocalLeaf
      ? [extractLeafCertificate(localCertificate)]
      : usesLocalTarget
      ? [config.ssl.certificate, ...(config.ssl.certificateAuthorities ?? [])]
      : config.selfHttp.ssl.certificateAuthorities ?? [];
    const certificateAuthorities = additionalCertificateAuthorities.filter(
      (certificate): certificate is string => certificate !== undefined
    );
    const verificationMode = pinLocalLeaf ? 'certificate' : configuredMode;
    return {
      verificationMode,
      certificateAuthorities,
      exclusiveTrust: pinLocalLeaf,
      clientCertificateRequired:
        usesLocalTarget &&
        config.ssl.enabled &&
        config.ssl.requestCert &&
        config.ssl.rejectUnauthorized,
    };
  }

  private getBaseDispatcher(url: URL, target: 'local' | 'public'): Dispatcher | undefined {
    if (url.protocol !== 'https:') return undefined;
    const { verificationMode, certificateAuthorities, exclusiveTrust } = this.getSslConfig(target);

    // Node's global dispatcher already verifies fully, so it only stays usable in `full` mode.
    if (certificateAuthorities.length === 0 && verificationMode === 'full') {
      this.replaceDispatcher(target, undefined, undefined);
      return undefined;
    }

    const trustKey = `${target}:${verificationMode}:${
      exclusiveTrust ? 'pin' : 'ca'
    }:${certificateAuthorities.join('\n')}`;
    const profile = this.dispatchers.get(target) ?? {};
    if (profile.agent && profile.trustKey === trustKey) {
      return profile.agent;
    }

    this.replaceDispatcher(
      target,
      new Agent({
        connect: buildConnectOptions(verificationMode, certificateAuthorities, {
          exclusiveTrust,
        }),
      }),
      trustKey
    );
    return this.dispatchers.get(target)?.agent;
  }

  private replaceDispatcher(
    target: 'local' | 'public',
    dispatcher: Agent | undefined,
    trustKey: string | undefined
  ): void {
    const previousDispatcher = this.dispatchers.get(target)?.agent;
    this.dispatchers.set(target, { agent: dispatcher, trustKey });
    if (previousDispatcher && previousDispatcher !== dispatcher) void previousDispatcher.close();
  }
}
