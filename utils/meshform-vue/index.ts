import type { FromDescriptor, MeshGraph } from './useMeshFormVue'

export { default as MeshForm } from './MeshForm.vue'

export { from } from './useMeshFormVue'
export type { MeshFormSchema, FromDescriptor, MeshGraph } from './useMeshFormVue'

/** Type for template ref on MeshForm. */
export type MeshFormInstance = {
  engine: {
    define: (rules: Record<string, FromDescriptor>) => void
    entangle: (...args: any[]) => any
    graph: MeshGraph
    hooks: { onSuccess: (cb: () => void) => void }
    config: { notifyAll: () => Promise<void> }
    [key: string]: any
  }
  submit: () => Promise<void>
  getFormData: () => Record<string, any>
}

export { meshRenderers } from './renderers/renderers'
export { MESH_NODE_MAP_KEY } from './inject-keys'

// Escape hatch: direct engine management
export { useMeshFormVue, deleteEngine } from './useMeshFormVue'

// Re-export meshflow primitive types
export type { SetRuleOptions, GhostProposalApi, MeshNodeProxy } from '../forms/useMeshForm'
