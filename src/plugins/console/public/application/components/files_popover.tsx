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

import React, { FunctionComponent, useState } from 'react';
import { flow } from 'fp-ts/lib/function';
import {
  EuiListGroup,
  EuiSpacer,
  EuiListGroupItem,
  EuiButtonEmpty,
  EuiFieldSearch,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';

import { sortTextObjectsAsc, TextObjectWithId } from '../../../common/text_object';
import { useTextObjectsActionContext, useTextObjectsReadContext } from '../contexts';

type EnhancedTextObjectWithId = TextObjectWithId & {
  displayName?: JSX.Element;
};

const addDefaultValues = (textObjects: TextObjectWithId[]): TextObjectWithId[] =>
  textObjects.map(textObject => ({
    ...textObject,
    name: textObject.isScratchPad ? 'Default' : textObject.name ?? `Untitled`,
  }));

const filterTextObjects = (
  searchTerm: string,
  textObjects: TextObjectWithId[]
): EnhancedTextObjectWithId[] =>
  textObjects.flatMap(textObject => {
    const idx = textObject?.name?.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (typeof idx === 'number' && idx > -1) {
      return [
        {
          ...textObject,
          displayName: (
            <>
              {textObject!.name!.slice(0, idx)}
              {<b>{textObject!.name!.slice(idx, idx + searchTerm.length)}</b>}
              {textObject!.name!.slice(idx + searchTerm.length, textObject!.name!.length)}
            </>
          ),
        },
      ];
    }
    return [];
  });

const searchAndSort = (searchTerm: string | undefined) =>
  flow(
    (textObjects: TextObjectWithId[]) =>
      searchTerm ? filterTextObjects(searchTerm, textObjects) : textObjects,
    sortTextObjectsAsc
  );

export const FilesPopover: FunctionComponent = () => {
  const disabled = false; // TODO: This should be linked to isSubmitting

  const [searchFilter, setSearchFilter] = useState<string | undefined>(undefined);

  const { textObjects } = useTextObjectsReadContext();
  const dispatch = useTextObjectsActionContext();

  const prepareData = flow(addDefaultValues, searchAndSort(searchFilter));

  const filteredTextObjects: EnhancedTextObjectWithId[] = prepareData(
    Object.values(textObjects).filter(Boolean)
  );

  // TODO: Identify default file and remove current file from the list
  // className: classNames({
  //     conApp__fileTree__scratchPadEntry: isScratchPad,
  //     'conApp__fileTree__entry--selected': id === currentTextObjectId,
  //   }),

  return (
    <div className="conApp__fileListContainer">
      <EuiFieldSearch
        inputRef={ref => ref?.focus()}
        compressed
        onChange={event => {
          setSearchFilter(event.target.value);
        }}
        value={searchFilter ?? ''}
      />

      <EuiSpacer size="s" />

      <EuiButtonEmpty
        size="xs"
        flush="left"
        disabled={disabled}
        onClick={() => {
          dispatch({
            type: 'setCreateFileModalVisible',
            payload: true,
          });
        }}
        data-test-subj="consoleCreateFileButton"
      >
        {i18n.translate('console.fileTree.forms.createButtonAriaLabel', {
          defaultMessage: 'Create a file',
        })}
      </EuiButtonEmpty>

      <EuiListGroup className="conApp__fileList">
        {filteredTextObjects.map(({ id, displayName, name }) => (
          <EuiListGroupItem
            key={id}
            onClick={() => {
              dispatch({
                type: 'setCurrent',
                payload: id,
              });
            }}
            label={displayName ?? name}
            size="s"
          />
        ))}
      </EuiListGroup>
    </div>
  );
};
