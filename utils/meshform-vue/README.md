# @meshflow/form-vue

**`@meshflow/form` 的 Vue 3 渲染层 —— 用 `@jsonforms/vue` 驱动渲染，用 `meshflow` 驱动联动。**

[![NPM Version](https://img.shields.io/npm/v/@meshflow/form-vue.svg)](https://www.npmjs.com/package/@meshflow/form-vue)
[![Peer Dependency](https://img.shields.io/badge/peer--deps-%40meshflow%2Fform-%2361dafb)](https://www.npmjs.com/package/@meshflow/form)

## 🌟 核心优势

- **🧩 标准 JSONForms 协议**：渲染层完全遵循 `@jsonforms/vue` 的 Renderer 注册体系，扩展方式与社区保持一致。
- **⚡ meshflow 联动引擎**：字段间依赖由 DAG / 有环图调度，支持 500+ 节点的复杂联动场景。
- **🎨 Vuetify 开箱即用**：内置基于 Vuetify 3 的控件渲染器（Select / Input / Number / Checkbox）。
- **📐 Schema 驱动布局**：通过 `x-layout`、`x-widget` 等扩展字段控制布局与渲染方式，无需手写 UISchema。
- **🔗 三种联动 API**：`from()` 语法糖、原生 `SetRule/SetRules`、有环图 `useEntangle` 均可混用。

---

## 📦 安装

```bash
npm install @meshflow/form-vue
```

**Peer Dependencies（需自行安装）：**

```bash
npm install vue@^3 vuetify@^3 @jsonforms/core@^3 @jsonforms/vue@^3 @meshflow/core @meshflow/form
```

---

## 🚀 快速上手

### 1. 定义 Schema

```typescript
import type { MeshFormSchema } from '@meshflow/form-vue'

const orderSchema: MeshFormSchema = {
  type: 'object',
  title: '采购单',
  properties: {
    product: {
      type: 'object',
      title: '产品信息',
      'x-layout': 'horizontal',   // 水平排列
      properties: {
        category: {
          type: 'string',
          title: '产品类目',
          default: 'software',
          'x-widget': 'select',
          'x-options': [
            { label: '软件授权', value: 'software' },
            { label: '硬件设备', value: 'hardware' },
          ],
        },
        quantity: { type: 'integer', title: '数量', default: 1 },
        price:    { type: 'number',  title: '单价', default: 0, 'x-readonly': true },
      },
    },
    billing: {
      type: 'object',
      title: '结算',
      properties: {
        total: { type: 'number', title: '合计', default: 0, 'x-disabled': true },
      },
    },
  },
}
```

### 2. 初始化引擎 + 设置联动

```typescript
import { useMeshFormVue, from } from '@meshflow/form-vue'

const engine = useMeshFormVue('order-form', orderSchema)

engine.define({
  // billing.total = product.quantity × product.price
  'billing.total.value': from(
    ['product.quantity', 'product.price'],
    (qty, price) => qty * price,
  ),

  // product.price 跟随 category 变化
  'product.price.value': from('product.category', (cat) => ({
    software: 999,
    hardware: 29999,
  })[cat] ?? 0),
})
```

### 3. 渲染表单

```vue
<template>
  <MeshForm :engine="engine" :schema="orderSchema" @submit="handleSubmit">
    <template #actions="{ submit }">
      <button @click="submit">提交</button>
    </template>
  </MeshForm>
</template>

<script setup lang="ts">
import { MeshForm, useMeshFormVue, from, deleteEngine } from '@meshflow/form-vue'
import { onUnmounted } from 'vue'

const engine = useMeshFormVue('order-form', orderSchema)
// ... engine.define(...)

function handleSubmit(data: Record<string, any>) {
  console.log(data)
}

onUnmounted(() => deleteEngine('order-form'))
</script>
```

> **注意**：需在应用入口注册 Vuetify，`MeshForm` 内部控件依赖 Vuetify 组件。

---

## 📐 MeshFormSchema 字段参考

### 对象节点（`MeshObjectSchema`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `'object'` | 固定值 |
| `title` | `string` | 分组标题 |
| `properties` | `Record<string, MeshFieldSchema \| MeshObjectSchema>` | 子字段 |
| `x-layout` | `'vertical' \| 'horizontal'` | 子字段排列方向，默认 `vertical` |
| `x-order` | `string[]` | 指定字段渲染顺序 |

### 叶子字段（`MeshFieldSchema`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `'string' \| 'number' \| 'integer' \| 'boolean'` | 数据类型 |
| `title` | `string` | 字段标签 |
| `default` | `any` | 初始值 |
| `x-widget` | `'input' \| 'number' \| 'select' \| 'checkbox'` | 控件类型（不填则按 type 推断） |
| `x-options` | `{ label: string; value: any }[]` | 下拉选项（静态） |
| `x-hidden` | `boolean` | 是否隐藏（可由联动规则动态控制） |
| `x-disabled` | `boolean` | 是否禁用 |
| `x-readonly` | `boolean` | 是否只读 |
| `x-required` | `boolean` | 是否必填 |
| `x-placeholder` | `string` | 占位文字 |
| `x-theme` | `string` | Vuetify color（如 `'success'`、`'error'`） |
| `x-min` | `number` | 数字字段最小值 |
| `x-maxLength` | `number` | 文本字段最大长度 |

---

## 🔗 联动 API

### 方式一：`from()` + `define()`（推荐）

`define()` 的 key 格式为 `"字段路径.属性"`，属性可以是 `value`、`hidden`、`disabled`、`options`、`placeholder` 等。

```typescript
engine.define({
  // 单源依赖
  'billing.total.value': from('product.price', (price) => price * 1.1),

  // 多源依赖
  'billing.total.value': from(
    ['product.price', 'product.quantity'],
    (price, qty) => price * qty,
  ),

  // 带副作用：options 变化时重置 value
  'product.name.options': from('product.category', (cat) => getOptions(cat), {
    effect: ({ options, value }) => {
      const valid = options.some((o) => o.value === value)
      return valid ? undefined : { value: options[0]?.value ?? '' }
    },
    effectArgs: ['options', 'value'],
  }),
})
```

### 方式二：原生 `SetRule / SetRules`（DAG）

```typescript
// 单源
engine.setRule('product.price', 'billing.total', 'value', {
  logic: ({ slot }) => slot.triggerTargets[0].value * 1.1,
})

// 多源
engine.setRules(['product.price', 'product.quantity'], 'billing.total', 'value', {
  logic: ({ slot }) => {
    const [price, qty] = slot.triggerTargets
    return price.value * qty.value
  },
})
```

### 方式三：`useEntangle`（有环图 / 双向联动）

适用于两个字段需要相互影响的场景（如汇率换算、数量与总价的双向同步）。

```typescript
engine.entangle({
  cause: 'fieldA',
  impact: 'fieldB',
  via: ['value'],
  emit: (cause, impact) => {
    // cause 变化时如何影响 impact
    return { key: 'value', delta: cause.value * 0.1 }
  },
})
```

---

## 🛠️ Engine API

```typescript
const engine = useMeshFormVue('form-id', schema)

engine.define(rules)           // 批量设置联动规则
engine.setRule(...)            // 原生 meshflow SetRule
engine.setRules(...)           // 原生 meshflow SetRules
engine.entangle(...)           // 有环图联动

engine.graph.upstream(path)         // 全量上游节点
engine.graph.downstream(path)       // 全量下游节点
engine.graph.directUpstream(path)   // 直接上游
engine.graph.directDownstream(path) // 直接下游
engine.graph.order()                // 拓扑执行顺序

engine.hooks.onSuccess(cb)     // 每次计算完成回调
engine.config.notifyAll()      // 手动触发全量刷新

deleteEngine('form-id')        // 销毁引擎（组件 unmount 时调用）
```

---

## 🎛️ MeshForm Props / Events / Slots

```typescript
// Props
engine:    ReturnType<typeof useMeshFormVue>  // 必填，引擎实例
schema:    MeshFormSchema                     // 必填，表单 Schema
uischema?: UISchemaElement                   // 可选，自定义 UISchema（不填则自动生成）

// Events
@submit(data: Record<string, any>)           // 提交时触发，携带当前表单数据

// Slots
#actions="{ submit, getFormData }"           // 操作区插槽
```

---

## 🔌 自定义 Renderer

如需替换默认的 Vuetify 控件，可自行编写 Renderer 并注册：

```typescript
import { meshRenderers } from '@meshflow/form-vue'
import { rankWith, isStringControl } from '@jsonforms/core'
import MyInput from './MyInput.vue'

const myRenderers = [
  { tester: rankWith(10, isStringControl), renderer: MyInput },
  ...meshRenderers,  // 兜底使用默认 renderer
]
```

在 `MyInput.vue` 中通过注入 `MESH_NODE_MAP_KEY` 拿到 meshflow 节点：

```typescript
import { inject, computed } from 'vue'
import { rendererProps, useJsonFormsControl, type ControlProps } from '@jsonforms/vue'
import { MESH_NODE_MAP_KEY } from '@meshflow/form-vue'

const props = defineProps({ ...rendererProps() })
const { control } = useJsonFormsControl(props as ControlProps)
const nodeMap = inject(MESH_NODE_MAP_KEY)
const node = computed(() => nodeMap?.value?.[control.value.path])
```

---

## 📄 License

AGPL-3.0-or-later
