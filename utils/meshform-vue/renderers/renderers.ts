/**
 * meshform-vue renderer registry.
 * Each entry pairs a tester (priority function) with a renderer component.
 * @jsonforms/core dispatches to the highest-priority matching renderer.
 */

import {
  rankWith,
  isStringControl,
  isNumberControl,
  isIntegerControl,
  isBooleanControl,
  isEnumControl,
  uiTypeIs,
  or,
  schemaMatches,
  type JsonFormsRendererRegistryEntry,
} from '@jsonforms/core'

import MeshControlRenderer from './MeshControlRenderer.vue'
import MeshGroupRenderer from './MeshGroupRenderer.vue'
import { markRaw } from 'vue'

// Tester for fields with x-options (custom select via schema extension)
const hasXOptions = schemaMatches(
  (schema: any) => Array.isArray(schema?.['x-options']) && schema['x-options'].length > 0
)

export const meshRenderers: JsonFormsRendererRegistryEntry[] = [
  // ── Leaf field controls ──────────────────────────────────────────────────
  { tester: rankWith(3, isStringControl),   renderer: markRaw(MeshControlRenderer) },
  { tester: rankWith(3, isNumberControl),   renderer: markRaw(MeshControlRenderer) },
  { tester: rankWith(3, isIntegerControl),  renderer: markRaw(MeshControlRenderer) },
  { tester: rankWith(3, isBooleanControl),  renderer: markRaw(MeshControlRenderer) },
  // Select: enum OR x-options (higher priority than plain string)
  { tester: rankWith(5, or(isEnumControl, hasXOptions)), renderer: markRaw(MeshControlRenderer) },

  // ── Layout / Group elements ──────────────────────────────────────────────
  { tester: rankWith(2, uiTypeIs('VerticalLayout')),   renderer: markRaw(MeshGroupRenderer) },
  { tester: rankWith(2, uiTypeIs('HorizontalLayout')), renderer: markRaw(MeshGroupRenderer) },
  { tester: rankWith(2, uiTypeIs('Group')),            renderer: markRaw(MeshGroupRenderer) },
]
