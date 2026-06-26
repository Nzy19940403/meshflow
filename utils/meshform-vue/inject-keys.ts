import type { InjectionKey, Ref } from 'vue'

/**
 * Injected by MeshForm.vue — a flat map of meshflow path → node proxy.
 * All renderers inject this to look up their node by the path jsonforms gives them.
 */
export const MESH_NODE_MAP_KEY: InjectionKey<Ref<Record<string, any>>> =
  Symbol('meshNodeMap')
