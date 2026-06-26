/**
 * Auto-generate a @jsonforms UISchema from a MeshFormSchema.
 *
 * - Root object  → VerticalLayout
 * - Nested object → Group (with optional inner HorizontalLayout from x-layout)
 * - Leaf field   → Control with scope pointing to the JSON Schema property
 */

import type { UISchemaElement } from '@jsonforms/core'
import type { MeshFormSchema, MeshObjectSchema, MeshFieldSchema } from '../forms/jsonforms/types'

type AnyProp = MeshFieldSchema | MeshObjectSchema

function isObj(p: AnyProp): p is MeshObjectSchema {
  return p.type === 'object'
}

/** Build Control / Group elements for the direct children of an object schema */
function buildElements(schema: MeshObjectSchema, scopePrefix: string): UISchemaElement[] {
  const order = schema['x-order'] ?? Object.keys(schema.properties)

  return order
    .map((key): UISchemaElement | null => {
      const prop = schema.properties[key]
      if (!prop) return null

      if (isObj(prop)) {
        // Nested object → Group containing its leaf Controls
        const childScope = `${scopePrefix}/${key}/properties`
        const leafControls = buildLeafControls(prop, childScope)

        const innerElements: UISchemaElement[] =
          prop['x-layout'] === 'horizontal'
            ? [{ type: 'HorizontalLayout', elements: leafControls } as UISchemaElement]
            : leafControls

        return {
          type: 'Group',
          label: prop.title ?? key,
          elements: innerElements,
        } as UISchemaElement
      }

      // Leaf field → Control
      return { type: 'Control', scope: `${scopePrefix}/${key}` } as UISchemaElement
    })
    .filter((el): el is UISchemaElement => el !== null)
}

/** Return only leaf Control elements for the children of an object schema */
function buildLeafControls(schema: MeshObjectSchema, scopePrefix: string): UISchemaElement[] {
  const order = schema['x-order'] ?? Object.keys(schema.properties)
  return order
    .map((key): UISchemaElement | null => {
      const prop = schema.properties[key]
      if (!prop || isObj(prop)) return null
      return { type: 'Control', scope: `${scopePrefix}/${key}` } as UISchemaElement
    })
    .filter((el): el is UISchemaElement => el !== null)
}

export function generateUiSchema(schema: MeshFormSchema): UISchemaElement {
  return {
    type: 'VerticalLayout',
    elements: buildElements(schema, '#/properties'),
  }
}
