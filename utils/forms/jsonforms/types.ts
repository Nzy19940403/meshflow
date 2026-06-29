// Re-export JsonSchema from @jsonforms/core as the authoritative base type.
export type { JsonSchema, UISchemaElement } from '@jsonforms/core'

export type MeshWidgetType = 'input' | 'number' | 'select' | 'checkbox' | (string & {})

export interface MeshFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'integer'
  title?: string
  description?: string
  default?: any
  enum?: any[]
  'x-widget'?: MeshWidgetType
  'x-placeholder'?: string
  'x-options'?: { label: string; value: any }[]
  'x-required'?: boolean
  'x-disabled'?: boolean
  'x-hidden'?: boolean
  'x-readonly'?: boolean
  'x-theme'?: string
  'x-min'?: number
  'x-maxLength'?: number
  [key: `x-${string}`]: any
}

export interface MeshObjectSchema {
  type: 'object'
  title?: string
  description?: string
  properties: Record<string, MeshFieldSchema | MeshObjectSchema>
  'x-order'?: string[]
  'x-layout'?: 'vertical' | 'horizontal'
}

export type MeshFormSchema = MeshObjectSchema
