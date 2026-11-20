/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  selectRemoteDeclarations,
  type RemoteModuleData,
  type RemoteProviderData,
} from './select_declarations';

const root: RemoteProviderData = {
  token: 'root',
  role: 'root',
  placement: 'executor',
  modulePath: '/root',
  exportName: 'Root',
};
const owner: RemoteProviderData = {
  token: 'owner',
  placement: 'coordinator',
  modulePath: '/owner',
  exportName: 'Owner',
};
const graph = { id: 'graph', root: 'root', dependencies: [], contributions: ['step'] };
const modules = (needs: string[]): RemoteModuleData[] => [
  {
    providers: [root],
    contributions: [
      { kind: 'step', stepType: 'step', modulePath: '/step', exportName: 'Step', needs },
    ],
  },
  { providers: [owner], contributions: [] },
];

it('selects a provider-only owner if and only if a selected entry needs it', () => {
  expect(
    selectRemoteDeclarations(modules(['owner']), graph).providers.map(({ token }) => token)
  ).toEqual(['root', 'owner']);
  expect(selectRemoteDeclarations(modules([]), graph).providers.map(({ token }) => token)).toEqual([
    'root',
  ]);
  expect(
    selectRemoteDeclarations(modules(['owner']), { ...graph, contributions: [] }).providers.map(
      ({ token }) => token
    )
  ).toEqual(['root']);
});

it('follows transitive needs from providers and safely terminates cycles', () => {
  const declarations = modules(['owner']);
  declarations[1] = {
    providers: [
      { ...owner, needs: ['other'] },
      { ...owner, token: 'other', needs: ['owner'] },
    ],
    contributions: [],
  };
  expect(selectRemoteDeclarations(declarations, graph).providers.map(({ token }) => token)).toEqual(
    ['root', 'owner', 'other']
  );
});

it('follows needs from an explicit root and from preserved legacy provider seeds', () => {
  const declarations = modules([]);
  declarations[0] = {
    providers: [
      { ...root, needs: ['owner'] },
      { ...owner, token: 'legacy', needs: ['other'] },
    ],
    contributions: [],
  };
  declarations.push({ providers: [{ ...owner, token: 'other' }], contributions: [] });
  const selected = selectRemoteDeclarations(declarations, graph);
  expect(selected.providers.map(({ token }) => token)).toEqual([
    'root',
    'legacy',
    'owner',
    'other',
  ]);
  expect(selected.selectionReport).toEqual([
    { token: 'root', selectedBy: ['explicit'] },
    { token: 'legacy', selectedBy: ['legacy'] },
    { token: 'owner', selectedBy: ['needs'] },
    { token: 'other', selectedBy: ['needs'] },
  ]);
});

it('fails closed for a missing needed provider rather than producing a broken DI graph', () => {
  expect(() => selectRemoteDeclarations(modules(['missing']), graph)).toThrow(
    'exactly one provider for missing'
  );
});

it('deduplicates identical provider declarations, including equivalent needs ordering', () => {
  const declarations = modules(['owner']);
  declarations.push({ providers: [{ ...owner, role: 'default', needs: [] }], contributions: [] });
  const selected = selectRemoteDeclarations(declarations, graph);
  expect(selected.providers.filter(({ token }) => token === 'owner')).toHaveLength(1);
});

it.each([
  { modulePath: '/different' },
  { placement: 'executor' as const },
  { exportName: 'Different' },
  { needs: ['different'] },
])('rejects non-identical provider declarations (%j)', (changed) => {
  const declarations = modules(['owner']);
  declarations.push({ providers: [{ ...owner, ...changed }], contributions: [] });
  expect(() => selectRemoteDeclarations(declarations, graph)).toThrow(
    'Conflicting remote providers for owner'
  );
});
