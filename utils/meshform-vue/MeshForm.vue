<template>
  <v-skeleton-loader v-if="!ready" type="article, actions" />
  <div v-else class="mesh-form">
    <json-forms
      :schema="props.schema"
      :uischema="effectiveUiSchema"
      :data="formData"
      :renderers="effectiveRenderers"
      @change="() => {}"
    />
    <slot name="actions" :submit="submit" :getFormData="getFormData" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, provide, onMounted, onUnmounted, nextTick, shallowRef } from 'vue'
import { JsonForms } from '@jsonforms/vue'
import { meshRenderers } from './renderers/renderers'
import { MESH_NODE_MAP_KEY } from './inject-keys'
import { generateUiSchema } from './generateUiSchema'
import { useMeshFormVue, deleteEngine } from './useMeshFormVue'
import type { MeshFormSchema, FromDescriptor } from './useMeshFormVue'
 

const props = defineProps<{
  schema: MeshFormSchema
  /** Initial field values — same shape as JSON Forms :data prop */
  data?: Record<string, any>
  /** Dependency rules, applied before notifyAll() */
  rules?: Record<string, FromDescriptor>
  /** Override auto-generated UISchema */
  uischema?: any
  /** Custom renderers, prepended before meshRenderers */
  renderers?: any[]
}>()

const emit = defineEmits<{
  (e: 'submit', data: Record<string, any>): void
  /** Fired after every engine computation cycle — same shape as JSON Forms @change data */
  (e: 'change', data: Record<string, any>): void
}>()

// Unique engine ID per component instance
const engineId = crypto.randomUUID()
const engine = useMeshFormVue(engineId, props.schema)

// Register rules before notifyAll()
if (props.rules) {
  engine.define(props.rules)
}

 

// Emit @change after every engine computation (initial notifyAll + user input).
// Registered synchronously so it's in place before the first notifyAll() call.
// JSON round-trip guarantees a new object reference so Vue ref detects changes.
engine.hooks.onSuccess(() => {
  emit('change', JSON.parse(JSON.stringify(getFormData())))
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNodeMap(node: any, map: Record<string, any> = {}): Record<string, any> {
  if (!node) return map
  if (node.path != null && node.path !== '') map[node.path] = node
  for (const child of node.children ?? []) buildNodeMap(child, map)
  return map
}

/** Flatten { a: { b: 1 } } to { 'a.b': 1 } */
function flattenData(obj: Record<string, any>, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenData(val, path))
    } else {
      result[path] = val
    }
  }
  return result
}

// Write :data initial values into engine nodes before notifyAll()
if (props.data) {
  const root = (engine as any)?.modules?.internalModules?.internalForm?.uiSchema
  const map = root ? buildNodeMap(root) : {}
  for (const [path, value] of Object.entries(flattenData(props.data))) {
    const node = map[path]
    if (node && value !== undefined) node.dependOn?.(() => value, 'value')
  }
}

// ── Reactive state ────────────────────────────────────────────────────────────

const ready = ref(false)
const formData = shallowRef({})

const effectiveUiSchema = computed(() =>
  props.uischema ?? generateUiSchema(props.schema)
)

const effectiveRenderers = computed(() =>
  props.renderers ? [...props.renderers, ...meshRenderers] : meshRenderers
)

const nodeMap = computed<Record<string, any>>(() => {
  const root = (engine as any)?.modules?.internalModules?.internalForm?.uiSchema
  return root ? buildNodeMap(root) : {}
})

provide(MESH_NODE_MAP_KEY, nodeMap)

// ── Public API ────────────────────────────────────────────────────────────────

function getFormData(): Record<string, any> {
  return (engine as any)?.modules?.internalModules?.internalForm?.GetFormData?.() ?? {}
}

async function submit() {
  emit('submit', getFormData())
}

onMounted(() => {
 
 
  (engine as any)?.config?.notifyAll?.()
  
  ready.value = true
 
})

onUnmounted(() => {
 
  try { deleteEngine(engineId) } catch { }
})

defineExpose({ engine, submit, getFormData })
</script>

<style scoped>
.mesh-form { width: 100%; }
</style>
