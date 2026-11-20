/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// Defaults to the Elastic Slack app when no connector is selected; the channel remains user-selected.
// Mirrors significant_events/server/lib/slack_app/service.ts, which depends on this plugin.
export const ELASTIC_APPS_SLACK_CONNECTOR_ID = 'elastic-apps-slack';
