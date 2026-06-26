<template>
  <v-skeleton-loader v-if="!ready" type="article, actions" />
  <div v-else class="mesh-form">
    <json-forms
      :schema="props.schema"
      :uischema="effectiveUiSchema"
      :data="formData"
      :renderers="meshRenderers"
      @change="() => {}"
    />
    <slot name="actions" :submit="submit" :getFormData="getFormData" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, provide, onMounted, nextTick } from 'vue'
import { JsonForms } from '@jsonforms/vue'
import { meshRenderers } from './renderers/renderers'
import { MESH_NODE_MAP_KEY } from './inject-keys'
import { generateUiSchema } from './generateUiSchema'
import type { MeshFormSchema } from '../forms/jsonforms/types'

const props = defineProps<{
  engine: any
  schema: MeshFormSchema
  uischema?: any
}>()

const emit = defineEmits<{
  (e: 'submit', data: Record<string, any>): void
}>()

const ready = ref(false)
const formData = ref({})

// Use explicit uiSchema if provided, otherwise auto-generate from schema
const effectiveUiSchema = computed(() =>
  props.uischema ?? generateUiSchema(props.schema)
)

// ── Node map ──────────────────────────────────────────────────────────────
function buildNodeMap(node: any, map: Record<string, any> = {}): Record<string, any> {
  if (!node) return map
  if (node.type !== 'group') {
    if (node.path != null && node.path !== '') map[node.path] = node
  }
  for (const child of node.children ?? []) buildNodeMap(child, map)
  return map
}

const nodeMap = computed<Record<string, any>>(() => {
  const root = props.engine?.modules?.internalModules?.internalForm?.uiSchema
  return root ? buildNodeMap(root) : {}
})

provide(MESH_NODE_MAP_KEY, nodeMap)

// ── Public API ────────────────────────────────────────────────────────────
function getFormData(): Record<string, any> {
  return props.engine?.modules?.internalModules?.internalForm?.GetFormData?.() ?? {}
}

async function submit() {
  emit('submit', getFormData())
}

onMounted(async () => {
  await nextTick()
  setTimeout(async () => {
    await props.engine?.config?.notifyAll?.()
    ready.value = true
  }, 0)
})
</script>

<style scoped>
.mesh-form { width: 100%; }
</style>
