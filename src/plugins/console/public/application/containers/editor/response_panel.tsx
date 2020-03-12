/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { memo } from 'react';

import { Panel } from '../../../../../kibana_react/public';
import { NetworkRequestStatusBar } from '../../components';
import { EditorOutput } from './legacy/console_editor';

interface Props {
  initialWidth: number;
  minWidth: string;
  requestInFlight: boolean;
  data?: any;
  error?: any;
}

export const ResponsePanel = memo<Props>(
  ({ initialWidth, minWidth, requestInFlight, data, error }) => {
    const lastDatum = data?.[data.length - 1] ?? error;

    return (
      <Panel
        className="conAppPanel"
        style={{ height: '100%', position: 'relative', minWidth }}
        initialWidth={initialWidth}
      >
        <>
          <div className="conAppPanelHeader">
            <NetworkRequestStatusBar
              className="conApp__networkRequestBar"
              requestInProgress={requestInFlight}
              requestResult={
                lastDatum
                  ? {
                      method: lastDatum.request.method.toUpperCase(),
                      endpoint: lastDatum.request.path,
                      statusCode: lastDatum.response.statusCode,
                      statusText: lastDatum.response.statusText,
                      timeElapsedMs: lastDatum.response.timeMs,
                    }
                  : undefined
              }
            />
          </div>

          <div className="conAppContainer">
            <EditorOutput />
          </div>
        </>
      </Panel>
    );
  }
);
