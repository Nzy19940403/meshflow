/**
 * meshform-vue — Vue 3 rendering layer for meshform.
 *
 * Wraps meshform (framework-agnostic) + @jsonforms/vue (renderer dispatch)
 * + Vuetify (UI components).
 *
 * Install peer deps:
 *   npm install @jsonforms/core @jsonforms/vue
 *
 * Usage:
 *   import { useMeshFormVue, MeshForm, from, deleteEngine } from '@/utils/meshform-vue'
 *
 *   const engine = useMeshFormVue('myForm', schema)
 *   engine.define({
 *     'total.value': from(['price', 'qty'], (p, q) => p * q),
 *   })
 *
 *   // template: <MeshForm :engine="engine" :schema="schema" />
 */

export { useMeshFormVue, deleteEngine, from } from './useMeshFormVue'
export type { MeshFormSchema, FromDescriptor, MeshGraph } from './useMeshFormVue'

export { default as MeshForm } from './MeshForm.vue'

export { meshRenderers } from './renderers/renderers'

export { MESH_NODE_MAP_KEY } from './inject-keys'

// Re-export meshflow primitive types for users who prefer the raw API
export type { SetRuleOptions, GhostProposalApi, MeshNodeProxy } from '../forms/useMeshForm'
