/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectorRateLimiterConfig } from '../config';
import { parseDuration } from './parse_date';

export class ConnectorRateLimiter {
  private logsByConnectors: Map<
    string,
    Array<{ readonly timestamp: number; readonly reservationId?: string }>
  >;
  private readonly config?: ConnectorRateLimiterConfig;

  constructor({ config }: { config?: ConnectorRateLimiterConfig }) {
    this.logsByConnectors = new Map();
    this.config = config;
  }

  log(connectorTypeId: string) {
    this.logExecution(connectorTypeId);
  }

  reserve(connectorTypeId: string, executionId: string): void {
    const type = this.trimLeadingDot(connectorTypeId);
    this.cleanupOldLogs(type);
    if (
      this.logsByConnectors.get(type)?.some(({ reservationId }) => reservationId === executionId)
    ) {
      throw new Error('Connector execution already reserved');
    }
    this.logExecution(type, executionId);
  }

  refund(connectorTypeId: string, executionId: string): void {
    const type = this.trimLeadingDot(connectorTypeId);
    const entries = this.logsByConnectors.get(type);
    if (!entries) return;
    this.logsByConnectors.set(
      type,
      entries.filter(({ reservationId }) => reservationId !== executionId)
    );
  }

  private logExecution(connectorTypeId: string, reservationId?: string): void {
    if (!this.config) {
      return;
    }
    const trimmedConnectorTypeId = this.trimLeadingDot(connectorTypeId);
    if (this.config[trimmedConnectorTypeId]) {
      const now = Date.now();
      if (!this.logsByConnectors.has(trimmedConnectorTypeId)) {
        this.logsByConnectors.set(trimmedConnectorTypeId, []);
      }
      this.logsByConnectors.get(trimmedConnectorTypeId)!.push({ timestamp: now, reservationId });
    }
  }

  isRateLimited(connectorTypeId: string): boolean {
    if (this.config) {
      const trimmedConnectorTypeId = this.trimLeadingDot(connectorTypeId);
      this.cleanupOldLogs(trimmedConnectorTypeId);
      if (this.config[trimmedConnectorTypeId]) {
        const count = this.logsByConnectors.get(trimmedConnectorTypeId)?.length ?? 0;
        return count > this.config[trimmedConnectorTypeId].limit;
      }
    }
    return false;
  }

  getLogs(connectorTypeId: string): number[] {
    return (
      this.logsByConnectors
        .get(this.trimLeadingDot(connectorTypeId))
        ?.map(({ timestamp }) => timestamp) || []
    );
  }

  private cleanupOldLogs(connectorTypeId: string) {
    const connectorConfig = this.config?.[connectorTypeId];
    if (connectorConfig) {
      const now = Date.now();
      const cutoff = now - parseDuration(connectorConfig.lookbackWindow);
      const filtered =
        this.logsByConnectors
          .get(connectorTypeId)
          ?.filter(({ timestamp }) => timestamp >= cutoff) || [];
      if (filtered.length > 0) {
        this.logsByConnectors.set(connectorTypeId, filtered);
      } else {
        this.logsByConnectors.delete(connectorTypeId);
      }
    }
  }

  private trimLeadingDot(connectorTypeId: string): string {
    if (connectorTypeId.charAt(0) === '.') {
      return connectorTypeId.replace(/^\./, '');
    }
    return connectorTypeId;
  }
}
