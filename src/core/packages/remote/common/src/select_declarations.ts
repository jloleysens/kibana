/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RemoteProviderDeclaration, RemoteContributionDeclaration } from './types';

export type RemoteProviderData = Omit<RemoteProviderDeclaration, 'token' | 'needs'> & {
  readonly token: string;
  readonly needs?: readonly string[];
};
export type RemoteContributionData = Omit<RemoteContributionDeclaration, 'kind' | 'needs'> & {
  readonly kind: string;
  readonly needs?: readonly string[];
};
export interface RemoteModuleData {
  readonly providers: readonly RemoteProviderData[];
  readonly contributions: readonly RemoteContributionData[];
}
export interface RemoteSelectionReport {
  readonly token: string;
  readonly selectedBy: ReadonlyArray<'explicit' | 'legacy' | 'needs'>;
}

const providerIdentity = (provider: RemoteProviderData): string =>
  JSON.stringify({
    placement: provider.placement,
    role: provider.role ?? 'default',
    modulePath: provider.modulePath,
    exportName: provider.exportName,
    needs: [...new Set(provider.needs ?? [])].sort(),
  });

/** Selects legacy colocated seeds and the transitive declared needs from every discovered owner. */
export const selectRemoteDeclarations = (
  modules: readonly RemoteModuleData[],
  graph: {
    readonly id: string;
    readonly root: string;
    readonly dependencies: readonly string[];
    readonly contributions: readonly string[];
  }
): {
  providers: RemoteProviderData[];
  contributions: RemoteContributionData[];
  selectionReport: RemoteSelectionReport[];
} => {
  const declarations = new Map<string, RemoteProviderData>();
  for (const provider of modules.flatMap((module) => module.providers)) {
    const previous = declarations.get(provider.token);
    if (previous && providerIdentity(previous) !== providerIdentity(provider))
      throw new Error(`Conflicting remote providers for ${provider.token}`);
    declarations.set(provider.token, previous ?? provider);
  }
  const selected = new Map<string, RemoteProviderData>();
  const reasons = new Map<string, Set<'explicit' | 'legacy' | 'needs'>>();
  const queue: RemoteProviderData[] = [];
  const admit = (token: string, reason: 'explicit' | 'legacy' | 'needs') => {
    const provider = declarations.get(token);
    if (!provider) throw new Error(`Graph ${graph.id} requires exactly one provider for ${token}`);
    const selectedBy = reasons.get(token) ?? new Set<'explicit' | 'legacy' | 'needs'>();
    selectedBy.add(reason);
    reasons.set(token, selectedBy);
    if (!selected.has(token)) {
      selected.set(token, provider);
      queue.push(provider);
    }
  };
  const explicit = new Set([graph.root, ...graph.dependencies]);
  for (const token of explicit) admit(token, 'explicit');
  const contributions = modules
    .flatMap((module) => module.contributions)
    .filter(({ kind }) => graph.contributions.includes(kind));
  if (new Set(contributions.map(({ stepType }) => stepType)).size !== contributions.length)
    throw new Error(`Graph ${graph.id} has duplicate step types`);

  // Preserve implicit colocated providers during adoption; annotate needs per family, then retire legacy seeding.
  for (const module of modules) {
    if (
      !module.providers.some(({ token }) => explicit.has(token)) &&
      !module.contributions.some(({ kind }) => graph.contributions.includes(kind))
    )
      continue;
    for (const provider of module.providers) {
      if (provider.role === 'root' && provider.token !== graph.root) continue;
      if (provider.role === 'catalog' && !explicit.has(provider.token)) continue;
      if (!explicit.has(provider.token)) admit(provider.token, 'legacy');
    }
  }
  for (const contribution of contributions)
    for (const token of contribution.needs ?? []) admit(token, 'needs');
  for (let index = 0; index < queue.length; index++)
    for (const token of queue[index].needs ?? []) admit(token, 'needs');
  return {
    providers: [...selected.values()],
    contributions,
    selectionReport: [...reasons].map(([token, selectedBy]) => ({
      token,
      selectedBy: [...selectedBy],
    })),
  };
};
