/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { RemoteModule } from '@kbn/core-remote-common';

type Provider = NonNullable<RemoteModule['providers']>[number];
type Contribution = NonNullable<RemoteModule['contributions']>[number];

export interface StaticRemoteModule {
  readonly providers: Array<Omit<Provider, 'token'> & { readonly token: string }>;
  readonly contributions: Array<Omit<Contribution, 'kind'> & { readonly kind: string }>;
}

type Data = string | Data[] | { [key: string]: Data };

/** Interprets declaration data and imported createToken literals, never plugin JavaScript. */
export const readRemoteManifest = (file: string): StaticRemoteModule => {
  const readExport = (path: string, name: string, visited: Set<string>): Data => {
    const key = `${path}#${name}`;
    if (visited.has(key)) throw new Error(`Cyclic remote declaration: ${key}`);
    const ancestry = new Set([...visited, key]);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const resolveModule = createRequire(path).resolve;
    const resolve = (request: string): string => {
      try {
        return resolveModule(request);
      } catch (error) {
        if (!request.startsWith('.')) throw error;
        return resolveModule(`${request}.ts`);
      }
    };
    const invalid = (): never => {
      throw new Error(`Invalid static remote declaration: ${key}`);
    };
    const read = (node: ts.Expression): Data => {
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return read(node.expression);
      if (ts.isStringLiteral(node)) return node.text;
      if (ts.isArrayLiteralExpression(node)) return node.elements.map(read);
      if (ts.isObjectLiteralExpression(node)) {
        const entries = node.properties.map((property): [string, Data] => {
          if (!ts.isPropertyAssignment(property)) return invalid();
          if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
            return invalid();
          return [property.name.text, read(property.initializer)];
        });
        if (new Set(entries.map(([property]) => property)).size !== entries.length)
          return invalid();
        return Object.fromEntries(entries);
      }
      if (ts.isIdentifier(node)) return readExport(path, node.text, ancestry);
      if (ts.isCallExpression(node) && node.arguments.length === 1) {
        const [argument] = node.arguments;
        if (!ts.isStringLiteral(argument)) return invalid();
        if (node.expression.getText(source) === 'require.resolve') return resolve(argument.text);
        if (ts.isIdentifier(node.expression)) {
          const factory = node.expression.text;
          const imported = source.statements.some(
            (statement) =>
              ts.isImportDeclaration(statement) &&
              ts.isStringLiteral(statement.moduleSpecifier) &&
              statement.moduleSpecifier.text === '@kbn/core-di' &&
              statement.importClause?.namedBindings &&
              ts.isNamedImports(statement.importClause.namedBindings) &&
              statement.importClause.namedBindings.elements.some(
                (binding) =>
                  binding.name.text === factory &&
                  (binding.propertyName?.text ?? binding.name.text) === 'createToken'
              )
          );
          if (imported) return argument.text;
        }
      }
      return invalid();
    };
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) {
        const declaration = statement.declarationList.declarations.find(
          (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name
        );
        if (declaration?.initializer) return read(declaration.initializer);
      }
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        const binding = statement.importClause.namedBindings.elements.find(
          (candidate) => candidate.name.text === name
        );
        if (binding) {
          return readExport(
            resolve(statement.moduleSpecifier.text),
            binding.propertyName?.text ?? binding.name.text,
            ancestry
          );
        }
      }
    }
    return invalid();
  };
  const object = (value: Data): { [key: string]: Data } => {
    if (typeof value === 'string' || Array.isArray(value)) {
      throw new Error(`Expected object in remote manifest: ${file}`);
    }
    return value;
  };
  const text = (value: Data): string => {
    if (typeof value !== 'string') throw new Error(`Expected string in remote manifest: ${file}`);
    return value;
  };
  const list = (value: Data | undefined): Data[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`Expected array in remote manifest: ${file}`);
    return value;
  };
  const data = object(readExport(file, 'remoteModule', new Set()));
  return {
    providers: list(data.providers).map((value) => {
      const provider = object(value);
      const placement = text(provider.placement);
      const role = provider.role === undefined ? undefined : text(provider.role);
      if (placement !== 'executor' && placement !== 'coordinator') {
        throw new Error(`Invalid remote placement: ${placement}`);
      }
      if (role !== undefined && role !== 'default' && role !== 'root' && role !== 'catalog') {
        throw new Error(`Invalid remote provider role: ${role}`);
      }
      return {
        token: text(provider.token),
        placement,
        role,
        modulePath: text(provider.modulePath),
        exportName: text(provider.exportName),
      };
    }),
    contributions: list(data.contributions).map((value) => {
      const contribution = object(value);
      return {
        kind: text(contribution.kind),
        stepType: text(contribution.stepType),
        modulePath: text(contribution.modulePath),
        exportName: text(contribution.exportName),
      };
    }),
  };
};
