/**
 * Converts MeshFormSchema (JSON Schema format) → FormFieldSchema (internal meshflow format).
 * This is a one-way, lossy conversion: JSON Schema → meshflow's node registration format.
 * Dynamic properties (disabled, hidden, options) are only seeded here as initial/static values;
 * runtime changes are fully managed by meshflow's SetRule / define().
 */

import type { FormFieldSchema, GroupField } from '../useForm'
import type { MeshFormSchema, MeshFieldSchema, MeshObjectSchema } from './types'

function isObjectSchema(s: MeshFieldSchema | MeshObjectSchema): s is MeshObjectSchema {
  return s.type === 'object'
}

function convertField(name: string, field: MeshFieldSchema): Exclude<FormFieldSchema, GroupField> {
  const base = {
    name,
    label: field.title ?? name,
    placeholder: field['x-placeholder'] ?? '',
    disabled: field['x-disabled'] ?? false,
    readonly: field['x-readonly'] ?? false,
    hidden: field['x-hidden'] ?? false,
    theme: field['x-theme'],
    validators: undefined as any,
    required: field['x-required'] ?? false,
  }

  // boolean → checkbox
  if (field.type === 'boolean') {
    return {
      ...base,
      type: 'checkbox',
      description: field.description,
      value: field.default ?? false,
    }
  }

  // select: explicit widget OR has x-options/enum
  const isSelect =
    field['x-widget'] === 'select' ||
    !!field['x-options'] ||
    (!!field.enum && field.enum.length > 0)

  if (isSelect) {
    const options =
      field['x-options'] ??
      (field.enum ?? []).map((v: any) => ({ label: String(v), value: v }))
    return {
      ...base,
      type: 'select',
      options,
      value: field.default ?? (options[0]?.value ?? null),
    }
  }

  // number / integer
  if (field.type === 'number' || field.type === 'integer') {
    return {
      ...base,
      type: 'number',
      value: field.default ?? 0,
      maxLength: field['x-maxLength'] ?? 100,
      min: field['x-min'],
    }
  }

  // default: text input
  return {
    ...base,
    type: 'input',
    value: field.default ?? '',
    maxLength: field['x-maxLength'] ?? 200,
  }
}

function convertObject(name: string, schema: MeshObjectSchema): GroupField {
  const order = schema['x-order'] ?? Object.keys(schema.properties)
  // Store label in the object so the proxy can return it via meta fallback
  const result: any = {
    type: 'group',
    name,
    label: schema.title ?? name,   // extra: not in GroupField type but readable via proxy.meta
    disabled: false,
    readonly: false,
    hidden: false,
    children: order.map(key => {
      const prop = schema.properties[key]
      if (!prop) return null
      if (isObjectSchema(prop)) return convertObject(key, prop)
      return convertField(key, prop as MeshFieldSchema)
    }).filter(Boolean),
  }
  return result as GroupField
}

/**
 * Convert a MeshFormSchema (JSON Schema format) into the internal FormFieldSchema
 * that meshflow's useInternalForm understands.
 * Root object gets name="" so it registers as the root path "".
 */
export function meshFormSchemaToFormFieldSchema(schema: MeshFormSchema): GroupField {
  return convertObject('', schema)
}
