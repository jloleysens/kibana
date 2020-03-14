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

import React, { FunctionComponent } from 'react';
import { EuiBottomBar, EuiFlexGroup, EuiFlexItem, EuiButtonEmpty, EuiPopover } from '@elastic/eui';
import { i18n } from '@kbn/i18n';

interface Props {
  onClickHistory: () => void;
  onClickSettings: () => void;
  onClickHelp: () => void;
}

export const TopNavMenu: FunctionComponent<Props> = ({
  onClickHistory,
  onClickSettings,
  onClickHelp,
}) => (
  <EuiBottomBar paddingSize="s">
    <EuiFlexGroup gutterSize="s" justifyContent="spaceBetween">
      <EuiFlexItem grow={false}>
        <EuiButtonEmpty
          color="ghost"
          size="s"
          iconType="help"
          iconSide="left"
          onClick={onClickHelp}
          data-test-subj="consoleHelpButton"
        >
          {i18n.translate('console.topNav.helpTabLabel', {
            defaultMessage: 'Help',
          })}
        </EuiButtonEmpty>
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="s" justifyContent="flexStart">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              color="ghost"
              size="s"
              onClick={onClickHistory}
              data-test-subj="consoleHistoryButton"
            >
              {i18n.translate('console.topNav.historyTabLabel', {
                defaultMessage: 'History',
              })}
            </EuiButtonEmpty>
          </EuiFlexItem>

          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              color="ghost"
              size="s"
              onClick={onClickSettings}
              data-test-subj="consoleSettingsButton"
            >
              {i18n.translate('console.topNav.settingsTabLabel', {
                defaultMessage: 'Settings',
              })}
            </EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
    </EuiFlexGroup>
  </EuiBottomBar>
);
