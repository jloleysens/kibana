/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

type KiAttributeValue = string | number | boolean | string[];

export const omitNullAttributes = (
  attributes: Record<string, KiAttributeValue | null>
): Record<string, KiAttributeValue> =>
  Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, KiAttributeValue] => entry[1] !== null
    )
  );

/**
 * Drops attributes whose value is `null`, the workflow convention for "omit this attribute"
 * (`${{ value | default: nil }}`), and the `attributes` key itself when nothing is left. The
 * schema's transform does the same, but the workflow engine hands step handlers the rendered
 * input without parsing it, so the KI steps call this themselves. Other fields are untouched: a
 * null `expires_at` on update still clears the expiry.
 */
export const omitNullKiAttributes = <
  T extends { [field: string]: unknown; attributes?: Record<string, KiAttributeValue | null> }
>(
  ki: T
): T => {
  const { attributes } = ki;
  if (!attributes) {
    return ki;
  }
  const kept = omitNullAttributes(attributes);
  if (Object.keys(attributes).length > 0 && Object.keys(kept).length === 0) {
    const withoutAttributes = { ...ki };
    delete withoutAttributes.attributes;
    return withoutAttributes;
  }
  return { ...ki, attributes: kept };
};
