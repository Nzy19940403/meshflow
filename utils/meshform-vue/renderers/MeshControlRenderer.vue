<template>
  <div v-if="!state.hidden" class="mesh-control">
    <!-- Select -->
    <v-select
      v-if="state.widgetType === 'select'"
      :model-value="state.value"
      :items="state.options"
      item-title="label"
      item-value="value"
      :label="state.label"
      :disabled="state.disabled"
      :readonly="state.readonly"
      :required="state.required"
      :placeholder="state.placeholder"
      :color="state.theme"
      density="comfortable"
      variant="outlined"
      @update:model-value="handleChange"
    />

    <!-- Checkbox -->
    <v-checkbox
      v-else-if="state.widgetType === 'checkbox'"
      :model-value="state.value"
      :label="state.label"
      :disabled="state.disabled"
      :readonly="state.readonly"
      :color="state.theme ?? 'primary'"
      density="comfortable"
      @update:model-value="handleChange"
    />

    <!-- Number -->
    <v-text-field
      v-else-if="state.widgetType === 'number'"
      :model-value="state.value"
      type="number"
      :label="state.label"
      :disabled="state.disabled"
      :readonly="state.readonly"
      :required="state.required"
      :placeholder="state.placeholder"
      :color="state.theme"
      :min="state.min"
      density="comfortable"
      variant="outlined"
      @update:model-value="(v: string) => handleChange(v === '' ? null : Number(v))"
    />

    <!-- Default: text input -->
    <v-text-field
      v-else
      :model-value="state.value"
      :label="state.label"
      :disabled="state.disabled"
      :readonly="state.readonly"
      :required="state.required"
      :placeholder="state.placeholder"
      :color="state.theme"
      :maxlength="state.maxLength"
      density="comfortable"
      variant="outlined"
      @update:model-value="handleChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { rendererProps, useJsonFormsControl, type ControlProps } from '@jsonforms/vue'
import { MESH_NODE_MAP_KEY } from '../inject-keys'

const props = defineProps({ ...rendererProps() })
const { control } = useJsonFormsControl(props as ControlProps)

const nodeMap = inject(MESH_NODE_MAP_KEY)

// Look up the meshflow node for this field path
const node = computed(() => nodeMap?.value?.[control.value.path])

/**
 * Reactive state — reading node.dirtySignal.value inside this computed
 * establishes Vue reactive tracking via the UITrigger bridge.
 * Every time meshflow fires the signal, this computed re-runs and
 * the template reflects the new values.
 */
const state = computed(() => {
  const _sig = node.value?.dirtySignal?.value // UITrigger subscription
  const n = node.value
  const schema = control.value.schema as any

  // Determine widget type: node.type (set by schemaConverter) takes priority
  let widgetType: 'input' | 'number' | 'select' | 'checkbox' = 'input'
  const nodeType = n?.type as string
  if (nodeType === 'select' || nodeType === 'checkbox' || nodeType === 'number') {
    widgetType = nodeType
  } else if (schema?.type === 'boolean') {
    widgetType = 'checkbox'
  } else if (schema?.type === 'number' || schema?.type === 'integer') {
    widgetType = 'number'
  }

  // Build select options from node or schema enum
  const options: { label: string; value: any }[] =
    n?.options ??
    (schema?.enum ?? []).map((v: any) => ({ label: String(v), value: v })) ??
    []
  if (options.length > 0) widgetType = 'select'

  return {
    widgetType,
    value: n != null ? n.value : (schema?.default ?? ''),
    disabled: !!n?.disabled,
    readonly: !!n?.readonly,
    hidden: !!n?.hidden,
    required: !!n?.required,
    label: n?.label ?? control.value.label ?? control.value.path,
    placeholder: n?.placeholder ?? schema?.['x-placeholder'] ?? '',
    theme: n?.theme ?? schema?.['x-theme'],
    options,
    min: n?.min ?? schema?.['x-min'],
    maxLength: n?.maxLength ?? schema?.['x-maxLength'],
  }
})

function handleChange(newValue: any) {
  node.value?.dependOn?.(() => newValue, 'value')
}
</script>

<style scoped>
.mesh-control {
  width: 100%;
}
</style>
