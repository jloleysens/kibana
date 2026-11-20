/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger, LogLevelId, LogMessageSource, LogMeta } from '@kbn/logging';
import type { ValidationDiagnostic } from './tokens';

/** Keeps plugin diagnostics separate from persisted workflow events. */
export const createValidationLogger = (
  enabled: Record<LogLevelId, boolean>,
  records: ValidationDiagnostic[],
  context: string[] = []
): Logger => {
  const append = (level: LogLevelId, message: LogMessageSource | Error, meta?: LogMeta): void => {
    if (enabled[level])
      records.push({
        level,
        context,
        message: typeof message === 'function' ? message() : String(message),
        ...(meta === undefined ? {} : { meta }),
      });
  };
  return {
    trace: (message, meta) => append('trace', message, meta),
    debug: (message, meta) => append('debug', message, meta),
    info: (message, meta) => append('info', message, meta),
    warn: (message, meta) => append('warn', message, meta),
    error: (message, meta) => append('error', message, meta),
    fatal: (message, meta) => append('fatal', message, meta),
    isLevelEnabled: (level) => enabled[level],
    get: (...paths) => createValidationLogger(enabled, records, [...context, ...paths]),
    log: (record) => append(record.level.id, record.error ?? record.message, record.meta),
  };
};
