/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import { StepCategory } from '@kbn/workflows';
import { z } from '@kbn/zod/v4';
import {
  DEFAULT_INDEX_BINDING,
  DEFAULT_ITEM_BINDING,
  MAP_BINDING_IDENTIFIER_REGEX,
  MAP_DIRECTIVE,
} from './data_map_runtime';
import type { FieldsNode } from './data_map_runtime';
import type { CommonStepDefinition } from '../../step_registry/types';
export {
  DEFAULT_INDEX_BINDING,
  DEFAULT_ITEM_BINDING,
  MAP_DIRECTIVE,
  MAP_BINDING_IDENTIFIER_REGEX,
} from './data_map_runtime';
export type { FieldsNode, MapDirectiveValue } from './data_map_runtime';

export const DataMapStepTypeId = 'data.map';

export const ConfigSchema = z.object({
  items: z.unknown(),
});

const FieldsNodeSchema: z.ZodType<FieldsNode> = z.lazy(() =>
  z.union([
    z.string(),
    z
      .object({
        [MAP_DIRECTIVE]: z
          .object({
            items: z.string(),
            item: z.string().regex(MAP_BINDING_IDENTIFIER_REGEX).optional(),
            index: z.string().regex(MAP_BINDING_IDENTIFIER_REGEX).optional(),
          })
          .optional(),
      })
      .and(z.record(z.string(), z.union([z.string(), FieldsNodeSchema]))),
  ])
);

export const InputSchema = z.object({ fields: z.record(z.string(), FieldsNodeSchema) });

export const OutputSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.record(z.string(), z.unknown()),
]);

export type DataMapStepConfigSchema = typeof ConfigSchema;
export type DataMapStepInputSchema = typeof InputSchema;
export type DataMapStepOutputSchema = typeof OutputSchema;

export const dataMapStepCommonDefinition: CommonStepDefinition<
  DataMapStepInputSchema,
  DataMapStepOutputSchema,
  DataMapStepConfigSchema
> = {
  id: DataMapStepTypeId,
  category: StepCategory.Data,
  label: i18n.translate('workflowsExtensions.dataMapStep.label', {
    defaultMessage: 'Map Collection',
  }),
  description: i18n.translate('workflowsExtensions.dataMapStep.description', {
    defaultMessage:
      'Transform arrays or single objects by renaming fields, removing keys, or computing new values',
  }),
  documentation: {
    details: i18n.translate('workflowsExtensions.dataMapStep.documentation.details', {
      defaultMessage: `The {stepType} step transforms arrays or single objects by applying a mapping configuration. For arrays, it maps each item and returns an array. For objects, it maps the single object and returns an object. Use {itemSyntax} to reference the current item and {indexSyntax} to access the item's position. The output is accessible via {outputSyntax}.

To map nested arrays, add a {mapDirective} key inside a nested field object with the form {mapDirectiveShape}. The {mapItems} value is a Liquid template expression rendered using the current context (the same rendering applied to all other fields), and each element is bound to the name given by {mapItemProp} (defaults to {mapItemDefault}). The iteration index is bound to the name given by {mapIndexProp} (defaults to {mapIndexDefault}), and parent variables remain in scope. Nested objects without {mapDirective} produce literal object output. 
If nested {mapItems} value in the source data resolves to any non-array value (including \`null\` or \`undefined\`), an empty array (\`[]\`) is going to be returned to guarantee output consistency. Nested recursion depth is limited to 10 levels.`,
      values: {
        stepType: DataMapStepTypeId,
        itemSyntax: '`{{ item.field }}`',
        indexSyntax: '`{{ index }}`',
        mapDirective: '`$map`',
        mapDirectiveShape: '`$map: { items: "${{ ... }}", item?: "...", index?: "..." }`',
        mapItems: '`items`',
        mapItemProp: '`item`',
        mapItemDefault: `\`"${DEFAULT_ITEM_BINDING}"\``,
        mapIndexProp: '`index`',
        mapIndexDefault: `\`"${DEFAULT_INDEX_BINDING}"\``,
        outputSyntax: '`{{ steps.stepName.output }}`',
      },
    }),
    examples: [
      `## Rename and project fields
\`\`\`yaml
- name: normalize-users
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_users.output }}"
  with:
    fields:
      id: "\${{ item.objectId }}"
      email: "\${{ item.mail }}"
      display_name: "\${{ item.givenName }} \${{ item.surname }}"
\`\`\``,

      `## Compute conditional fields with Liquid
\`\`\`yaml
- name: enrich-orders
  type: ${DataMapStepTypeId}
  items: "\${{ steps.get_orders.output.value }}"
  with:
    fields:
      order_id: "\${{ item.id }}"
      total: "\${{ item.price * item.quantity }}"
      status: >-
        {% if item.paid == true %}paid{% else %}pending{% endif %}
      discount: "\${{ item.price * 0.1 }}"
\`\`\``,

      `## Add static fields and use index
\`\`\`yaml
- name: tag-items
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_data.output.items }}"
  with:
    fields:
      position: "\${{ index }}"
      name: "\${{ item.name }}"
      source: "api"
      processed_at: "\${{ workflow.startedAt }}"
\`\`\``,

      `## Complex transformation from Active Directory
\`\`\`yaml
- name: normalize-ad-users
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_ad_users.output.value }}"
  with:
    fields:
      id: "\${{ item.objectId }}"
      email: "\${{ item.mail }}"
      display_name: "\${{ item.givenName }} \${{ item.surname }}"
      department: "\${{ item.department }}"
      source: "active_directory"
      status: >-
        {% if item.accountEnabled == true %}active{% else %}suspended{% endif %}
      
# Access the mapped array in subsequent steps
- name: use-normalized-data
  type: log
  with:
    message: "Processed \${{ steps.normalize-ad-users.output | size }} users"
\`\`\``,

      `## Normalize API response structure
\`\`\`yaml
- name: reshape-github-issues
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_issues.output }}"
  with:
    fields:
      issue_id: "\${{ item.id }}"
      title: "\${{ item.title }}"
      author: "\${{ item.user.login }}"
      state: "\${{ item.state }}"
      created: "\${{ item.created_at }}"
      url: "\${{ item.html_url }}"
\`\`\``,

      `## Map a single object
\`\`\`yaml
- name: reshape-user-profile
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_user.output }}"
  with:
    fields:
      user_id: "\${{ item.id }}"
      full_name: "\${{ item.firstName }} \${{ item.lastName }}"
      email: "\${{ item.email }}"
      is_active: "\${{ item.status == 'active' }}"

# When items is an object, output is also an object
- name: use-mapped-user
  type: log
  with:
    message: "User: \${{ steps.reshape-user-profile.output.full_name }}"
\`\`\``,

      `## Recursive array mapping with $map
\`\`\`yaml
- name: prune-nested-data
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_data.output }}"
  with:
    fields:
      id: "\${{ item.id }}"
      name: "\${{ item.name }}"
      tags:
        $map: { items: "\${{ item.tags }}", item: "tag" }
        label: "\${{ tag.label }}"
        color: "\${{ tag.color }}"
        owner: "\${{ item.name }}"
\`\`\``,

      `## Multi-level recursion with $map
\`\`\`yaml
- name: reshape-org
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_org.output }}"
  with:
    fields:
      org_name: "\${{ item.name }}"
      departments:
        $map: { items: "\${{ item.departments }}", item: "dept" }
        dept_name: "\${{ dept.name }}"
        employees:
          $map: { items: "\${{ dept.employees }}", item: "emp" }
          name: "\${{ emp.name }}"
          department: "\${{ dept.name }}"
          org: "\${{ item.name }}"
\`\`\``,

      `## Nested $map with defaults (item/index omitted)
\`\`\`yaml
- name: flatten-tags
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_data.output }}"
  with:
    fields:
      id: "\${{ item.id }}"
      tags:
        $map: { items: "\${{ item.tags }}" }
        label: "\${{ item.label }}"
        position: "\${{ index }}"
\`\`\``,

      `## Nested literal objects inside $map
\`\`\`yaml
- name: enrich-tags
  type: ${DataMapStepTypeId}
  items: "\${{ steps.fetch_data.output }}"
  with:
    fields:
      id: "\${{ item.id }}"
      tags:
        $map: { items: "\${{ item.tags }}", item: "tag" }
        label: "\${{ tag.label }}"
        color: "\${{ tag.color }}"
        owner:
          id: "\${{ tag.user.id }}"
          name: "\${{ tag.user.name }}"
\`\`\``,
    ],
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
