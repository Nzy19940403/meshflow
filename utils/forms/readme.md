# @meshflow/form

**基于 @meshflow/core 的高性能、强类型、无头（Headless）表单逻辑驱动器。**

[![NPM Version](https://img.shields.io/npm/v/@meshflow/form.svg)](https://www.npmjs.com/package/@meshflow/form)
[![Peer Dependency](https://img.shields.io/badge/peer--deps-%40meshflow%2Fcore-%2361dafb)](https://www.npmjs.com/package/@meshflow/core)

## 🌟 核心优势

`@meshflow/form` 是专为复杂中后台设计的表单逻辑层。它不提供任何 UI 组件，而是通过**拓扑任务编排**，赋予表单处理 500+ 节点复杂联动的能力。

- **🏗️ 真正的无头架构**：通过 `UITrigger` 与 UI 框架（Vue/React/Solid）解耦，逻辑运行在纯 JS 引擎中。
- **⚡ 极致类型推导**：基于 TypeScript 的路径感知，实现超大规模 Schema 的自动路径补全。
- **🧩 插件化扩展**：支持通过 `modules` 注入功能模块（如 Undo/Redo 历史记录）。
- **🌊 异步时序安全**：内置水位线机制，原生解决高频操作下的异步回填竞态问题。

---

## 🚀 快速上手

#### 安装
```bash
npm install @meshflow/form
```

##### 初始化引擎
```typescript
import { useMeshForm } from "@meshflow/form";

const schema = {
    type: 'group',
    name: 'billing',
    label: '计费与汇总',
    children: [
        { type: 'number', name: 'totalPrice', label: '预估月度总价', value: 0, },
        { type: 'input', name: 'priceDetail', label: '计费项说明', value: '基础配置费用'}
    ]
};
const engine = useMeshForm('engine', schema, {
  UITrigger: {
    // Vue 响应式绑定
    signalCreateor: () => ref(0),
    signalTrigger(signal) { 
      signal.value++; 
    }
  }
});
```

##### 添加联动依赖
```typescript
engine.config.SetRule("billing.totalPrice", "billing.priceDetail", "value", {
  logic: ({ slot }) => {
    const [total] = slot.triggerTargets; // 从触发目标中解构出 totalPrice
    return total > 2000 ? "大客户折扣" : undefined;
  }
});
```