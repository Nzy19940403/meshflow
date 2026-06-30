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

type NodeProp = 'value' | 'hidden' | 'disabled' | 'readonly'
              | 'required' | 'options' | 'placeholder' | 'label' | 'theme'

type JsonLeafPaths<T, Prefix extends string = ''> =
  T extends { type: 'object'; properties: infer P }
    ? string extends keyof P
      // P 的 key 是 string（运行时宽类型） → 不递归，直接返回字符串通配
      ? Prefix extends '' ? string : `${Prefix}.${string}`
      : P extends Record<string, any>
        ? { [K in keyof P & string]: JsonLeafPaths<P[K], Prefix extends '' ? K : `${Prefix}.${K}`> }[keyof P & string]
        : never
    : Prefix

type MeshDefineRules<S extends MeshFormSchema> =
  // S['properties'] 的 key 是 string（宽类型）→ 未具体化的 MeshObjectSchema，退化为无类型约束
  // S['properties'] 的 key 是字面量联合 → 具体 schema，走路径推断
  string extends keyof S['properties']
    ? Record<string, FromDescriptor>
    : Partial<Record<`${JsonLeafPaths<S>}.${NodeProp}`, FromDescriptor>>

export function useMeshFormVue<S extends MeshFormSchema, M extends Record<string, any> = {}>(
  id: string,
  schema: S,
  options?: {
    modules?: M
    config?: { useGreedy?: boolean }
  }
) {
  const engine = useMeshFormJson(id, schema, {
    ...options,
    UITrigger: {
      signalCreator: () => ref(0),
      signalTrigger: (s: any) => { s.value++ },
    },
  })

  return engine as Omit<typeof engine, 'define'> & {
    define: (rules: MeshDefineRules<S>) => void
  }
}

// Re-export core API so meshform-vue users have a single import source
export { deleteEngine, from }
export type { MeshFormSchema, FromDescriptor, MeshGraph }
