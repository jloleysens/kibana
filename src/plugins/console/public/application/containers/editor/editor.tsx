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

import React, { useCallback, memo, useState, useEffect } from 'react';
import { debounce } from 'lodash';
import { EuiProgress } from '@elastic/eui';

import { PanelsContainer } from '../../../../../kibana_react/public';
import { StorageKeys } from '../../../services';
import {
  useServicesContext,
  useRequestReadContext,
  useTextObjectsReadContext,
} from '../../contexts';

import { RequestPanel } from './request_panel';
import { ResponsePanel } from './response_panel';

const INITIAL_PANEL_WIDTH = 50;
const PANEL_MIN_WIDTH = '100px';

const DEFAULT_INPUT_VALUE = `GET _search
{
  "query": {
    "match_all": {}
  }
}`;

export const Editor = memo(() => {
  const {
    services: { storage, objectStorageClient },
  } = useServicesContext();

  const [initialTextValue, setInitialTextValue] = useState<string | undefined>();

  const { currentTextObjectId } = useTextObjectsReadContext();

  const {
    requestInFlight,
    lastResult: { data, error },
  } = useRequestReadContext();

  const [firstPanelWidth, secondPanelWidth] = storage.get(StorageKeys.WIDTH, [
    INITIAL_PANEL_WIDTH,
    INITIAL_PANEL_WIDTH,
  ]);

  const onPanelWidthChange = useCallback(
    debounce((widths: number[]) => {
      storage.set(StorageKeys.WIDTH, widths);
    }, 300),
    []
  );

  useEffect(() => {
    setInitialTextValue(undefined);
    if (currentTextObjectId) {
      objectStorageClient.text
        .get(currentTextObjectId, ['text'])
        .then(({ text }) => setInitialTextValue(text ?? DEFAULT_INPUT_VALUE));
    }
  }, [currentTextObjectId, objectStorageClient]);

  return (
    <>
      {requestInFlight ? (
        <div className="conApp__requestProgressBarContainer">
          <EuiProgress size="xs" color="accent" position="absolute" />
        </div>
      ) : null}

      <PanelsContainer onPanelWidthChange={onPanelWidthChange} resizerClassName="conApp__resizer">
        <RequestPanel
          minWidth={PANEL_MIN_WIDTH}
          initialWidth={firstPanelWidth}
          initialTextValue={initialTextValue}
        />
        <ResponsePanel
          minWidth={PANEL_MIN_WIDTH}
          initialWidth={secondPanelWidth}
          requestInFlight={requestInFlight}
          data={data}
          error={error}
        />
      </PanelsContainer>
    </>
  );
});
