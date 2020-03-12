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

import React, { useState, memo } from 'react';
import {
  EuiFlexGroup,
  EuiButtonIcon,
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiPopover,
  EuiFlexItem,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';

import { Panel } from '../../../../../kibana_react/public';
import { useTextObjectsCRUD } from '../../hooks/text_objects';
import { useTextObjectsReadContext } from '../../contexts';
import { DeleteFileModal, FileSaveErrorIcon } from '../../components';

import { addDefaultValues } from '../file_tree/file_tree';
import { Editor as EditorUI } from './legacy/console_editor';

interface Props {
  initialWidth: number;
  minWidth: string;
  initialTextValue?: string;
}

export const RequestPanel = memo<Props>(({ initialWidth, minWidth, initialTextValue }) => {
  const [isFileOptionsOpen, setFileOptionsOpen] = useState(false);
  const [isDeleteModalVisible, setDeleteModalVisible] = useState(false);
  const textObjectsCRUD = useTextObjectsCRUD();

  const {
    textObjects,
    currentTextObjectId,
    persistingTextObjectWithId,
    textObjectsSaveError,
  } = useTextObjectsReadContext();

  const currentTextObject = textObjects[currentTextObjectId];

  let content;

  if (currentTextObject && initialTextValue != null) {
    const fileOptions = [
      <EuiContextMenuItem key="clone" icon="copy" onClick={() => {}}>
        {i18n.translate('console.cloneFileButtonLabel', {
          defaultMessage: 'Clone',
        })}
      </EuiContextMenuItem>,

      <EuiContextMenuItem
        key="rename"
        icon="pencil"
        onClick={() => {}}
        disabled={currentTextObject.isScratchPad}
      >
        {i18n.translate('console.renameFileButtonLabel', {
          defaultMessage: 'Rename',
        })}
      </EuiContextMenuItem>,

      <EuiContextMenuItem
        key="delete"
        icon="trash"
        onClick={() => setDeleteModalVisible(true)}
        disabled={currentTextObject.isScratchPad}
      >
        {i18n.translate('console.deleteFileButtonLabel', {
          defaultMessage: 'Delete',
        })}
      </EuiContextMenuItem>,
    ];

    content = (
      <>
        <div className="conAppPanelHeader">
          <EuiFlexGroup>
            <EuiFlexItem>
              <EuiFlexGroup gutterSize="s" alignItems="center">
                <EuiFlexItem grow={false}>
                  <EuiText size="s">{addDefaultValues([currentTextObject])[0].name}</EuiText>
                </EuiFlexItem>

                <EuiFlexItem grow={false}>
                  {persistingTextObjectWithId === currentTextObjectId ? (
                    <EuiText size="s" color="subdued">
                      {i18n.translate('console.saveFileStatusText', {
                        defaultMessage: 'Saving...',
                      })}
                    </EuiText>
                  ) : textObjectsSaveError[currentTextObjectId] ? (
                    <FileSaveErrorIcon errorMessage={textObjectsSaveError[currentTextObjectId]} />
                  ) : null}
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiFlexItem grow={false} />
            </EuiFlexItem>

            <EuiFlexItem grow={false}>
              <EuiPopover
                id="popover"
                button={
                  <EuiButtonIcon
                    iconType="gear"
                    aria-label="Options"
                    onClick={() => setFileOptionsOpen(!isFileOptionsOpen)}
                  />
                }
                isOpen={isFileOptionsOpen}
                closePopover={() => setFileOptionsOpen(false)}
                panelPaddingSize="none"
                anchorPosition="downLeft"
              >
                <EuiContextMenuPanel items={fileOptions} />
              </EuiPopover>
            </EuiFlexItem>
          </EuiFlexGroup>
        </div>

        {isDeleteModalVisible && (
          <DeleteFileModal
            fileName={currentTextObject.name ?? 'Untitled'}
            onClose={() => setDeleteModalVisible(false)}
            onDeleteConfirmation={() => {
              textObjectsCRUD.delete(currentTextObject).finally(() => {
                setDeleteModalVisible(false);
              });
            }}
          />
        )}

        <div className="conAppContainer">
          <EditorUI textObject={{ ...currentTextObject, text: initialTextValue }} />
        </div>
      </>
    );
  }

  return (
    <Panel
      className="conAppPanel"
      style={{ height: '100%', position: 'relative', minWidth }}
      initialWidth={initialWidth}
    >
      {content}
    </Panel>
  );
});
