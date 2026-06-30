<template>
  <!-- Group with title (type: "Group" in uiSchema) -->
  <div v-if="layout.uischema.type === 'Group' && !groupHidden" class="mesh-group">
    <div v-if="groupLabel" class="mesh-group__header">
      <span class="mesh-group__title">{{ groupLabel }}</span>
      <v-divider class="mesh-group__divider" />
    </div>
    <div class="mesh-group__body" :class="layoutClass">
      <dispatch-renderer
        v-for="(element, index) in layout.uischema.elements"
        :key="`${layout.path}-${index}`"
        :schema="layout.schema"
        :uischema="element"
        :path="layout.path"
        :enabled="layout.enabled"
        :renderers="layout.renderers"
        :cells="layout.cells"
      />
    </div>
  </div>

  <!-- Horizontal layout — wrap each item in an explicit div so flex props are reliable -->
  <div v-else-if="layout.uischema.type === 'HorizontalLayout'" class="mesh-layout mesh-layout--horizontal">
    <div
      v-for="(element, index) in layout.uischema.elements"
      :key="`${layout.path}-${index}`"
      class="mesh-layout__item"
      :style="itemStyle(element)"
    >
      <dispatch-renderer
        :schema="layout.schema"
        :uischema="element"
        :path="layout.path"
        :enabled="layout.enabled"
        :renderers="layout.renderers"
        :cells="layout.cells"
      />
    </div>
  </div>

  <!-- Vertical layout (default) -->
  <div v-else class="mesh-layout mesh-layout--vertical">
    <dispatch-renderer
      v-for="(element, index) in layout.uischema.elements"
      :key="`${layout.path}-${index}`"
      :schema="layout.schema"
      :uischema="element"
      :path="layout.path"
      :enabled="layout.enabled"
      :renderers="layout.renderers"
      :cells="layout.cells"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { rendererProps, useJsonFormsLayout, DispatchRenderer, type LayoutProps } from '@jsonforms/vue'
import { MESH_NODE_MAP_KEY } from '../inject-keys'

const props = defineProps({ ...rendererProps() })
const { layout } = useJsonFormsLayout(props as LayoutProps)
const nodeMap = inject<any>(MESH_NODE_MAP_KEY)

const groupLabel = computed(() => {
  const uischema = layout.value.uischema as any
  return uischema?.label || uischema?.options?.label || null
})

// 若指定 options.nodePath，检查该路径下所有直接子节点是否全部 hidden
// 全 hidden → 整组不渲染（header 也消失），无需在引擎里注册 group-level 规则
const groupHidden = computed(() => {
  const nodePath = (layout.value.uischema as any)?.options?.nodePath as string | undefined
  if (!nodePath) return false
  const map = nodeMap?.value ?? {}
  const prefix = nodePath + '.'
  const children = Object.entries(map).filter(
    ([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('.')
  )
  if (!children.length) return false
  // 追踪每个子节点的 dirtySignal，确保 hidden 变化时重新计算
  children.forEach(([, n]) => n?.dirtySignal?.value)
  return children.every(([, n]) => n?.hidden === true)
})

const layoutClass = computed(() => {
  const uischema = layout.value.uischema as any
  const hint = uischema?.options?.['x-layout'] ?? 'vertical'
  return hint === 'horizontal'
    ? 'mesh-group__body--horizontal'
    : 'mesh-group__body--vertical'
})

/**
 * Per-item flex style.
 * Supports `options.span` (number) on individual UISchema elements to control
 * relative width. span=1 is the default unit (flex: 1 1 180px).
 * span=2 → flex: 2 1 360px (twice as wide), span=3 → full-row, etc.
 */
function itemStyle(element: any): Record<string, string> {
  const span: number = element?.options?.span ?? 1
  const basis = span * 180
  return { flex: `${span} 1 ${basis}px` }
}
</script>

<style scoped>
.mesh-group {
  width: 100%;
  margin-bottom: 8px;
}

.mesh-group__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  margin-top: 24px;
}

.mesh-group__title {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  flex-shrink: 0;
}

.mesh-group__divider {
  opacity: 0.15;
}

.mesh-group__body--vertical {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.mesh-group__body--horizontal {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
  width: 100%;
}

.mesh-layout--vertical {
  display: flex;
  flex-direction: column;
  width: 100%;
}

/* flex-wrap: each item gets flex from itemStyle(), falls back to flex:1 1 180px */
.mesh-layout--horizontal {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
  width: 100%;
}

.mesh-layout__item {
  flex: 1 1 180px;
  min-width: 0;   /* prevent overflow in flex context */
}
</style>
