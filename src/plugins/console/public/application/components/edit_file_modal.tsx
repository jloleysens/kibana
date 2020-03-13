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

import React, { useState, FunctionComponent } from 'react';
import {
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiOverlayMask,
  EuiButtonEmpty,
  EuiButton,
  EuiFormRow,
  EuiFieldText,
  EuiText,
  EuiSpacer,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';

export interface Props {
  initialFileName?: string;
  onClose: () => void;
  onSubmit: (fileName: string) => void;
}

export const EditFileModal: FunctionComponent<Props> = ({ onClose, initialFileName, onSubmit }) => {
  const [fileName, setFileName] = useState(initialFileName ?? '');
  const [isPristine, setIsPristine] = useState(true);
  const [errors, setErrors] = useState<string | null>(null);
  const isInvalid = Boolean(!isPristine && errors);

  return (
    <EuiOverlayMask>
      <EuiModal onClose={onClose}>
        <EuiModalHeader>
          <EuiModalHeaderTitle>Delete File</EuiModalHeaderTitle>
        </EuiModalHeader>

        <form
          onSubmit={e => {
            if (e) {
              e.preventDefault();
            }
            if (isPristine) {
              setErrors('Please provide a file name');
              return;
            }
            if (!errors) {
              onSubmit(fileName);
            }
          }}
        >
          <EuiModalBody>
            <EuiFormRow display="rowCompressed" label="Filename">
              <EuiFieldText
                className="conAppFileNameTextField"
                compressed
                isInvalid={isInvalid}
                value={fileName}
                onChange={event => {
                  if (isPristine) {
                    setIsPristine(false);
                  }
                  const name = event.target.value;
                  setErrors(!name ? 'File name is required' : null);
                  setFileName(name);
                }}
              />
            </EuiFormRow>

            {errors && (
              <>
                <EuiSpacer size="s" />
                <EuiText size="s" color="danger">
                  {errors}
                </EuiText>
                <EuiSpacer size="s" />
              </>
            )}
          </EuiModalBody>

          <EuiModalFooter>
            <EuiButtonEmpty onClick={onClose}>
              {i18n.translate('console.editModal.cancelButtonLabel', {
                defaultMessage: 'Cancel',
              })}
            </EuiButtonEmpty>

            <EuiButton fill color="primary" onClick={() => onSubmit(fileName)}>
              {initialFileName
                ? i18n.translate('console.editModal.editButtonLabel', {
                    defaultMessage: 'Edit',
                  })
                : i18n.translate('console.editModal.createButtonLabel', {
                    defaultMessage: 'Create',
                  })}
            </EuiButton>
          </EuiModalFooter>
        </form>
      </EuiModal>
    </EuiOverlayMask>
  );
};
