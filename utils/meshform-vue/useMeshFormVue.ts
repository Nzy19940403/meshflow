/**
 * useMeshFormVue — Vue-specific wrapper around meshform's useMeshFormJson.
 *
 * Bundles the Vue UITrigger (ref-based signal) so users of meshform-vue
 * don't need to wire it up manually.
 *
 * Usage:
 *   const engine = useMeshFormVue('myForm', schema)
 *   engine.define({ 'total.value': from(['price', 'qty'], (p, q) => p * q) })
 */

import { ref } from 'vue'
import {
  useMeshFormJson,
  deleteEngine,
  from,
  type MeshFormSchema,
  type FromDescriptor,
  type MeshGraph,
} from '@meshflow/form'

export function useMeshFormVue<M extends Record<string, any> = {}>(
  id: string,
  schema: MeshFormSchema,
  options?: {
    modules?: M
    config?: { useGreedy?: boolean }
  }
) {
  return useMeshFormJson(id, schema, {
    ...options,
    UITrigger: {
      signalCreator: () => ref(0),
      signalTrigger: (s: any) => { s.value++ },
    },
  })
}

// Re-export core API so meshform-vue users have a single import source
export { deleteEngine, from }
export type { MeshFormSchema, FromDescriptor, MeshGraph }
