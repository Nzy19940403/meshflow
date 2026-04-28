# @meshflow/core

**基于水位线调度（Watermark Scheduling）的轻量级拓扑逻辑引擎。**

[![Documentation](https://img.shields.io/badge/docs-VitePress-blue.svg)](https://meshflow-docs.vercel.app/)
[![Demo](https://img.shields.io/badge/demo-Vercel-orange.svg)](https://meshflow-factory-demo.vercel.app/)

## 🏗️ 引擎定位

`@meshflow/core` 不预设任何业务场景。它是一个纯粹的**逻辑计算骨架**，负责管理节点（TaskNode）之间的拓扑依赖关系。

它只做三件事：
1. **构建拓扑图**：通过 Schema 定义节点及其层级。
2. **编排任务流**：管理节点间的联动规则（Rule）。
3. **确定性执行**：利用水位线（Watermark）机制，确保异步任务在复杂的依赖网中，依然能按正确的顺序提交。

---

## 🎯 核心能力

### 1. 任务依赖编排 (Topology)
引擎会自动解析节点间的依赖关系（A -> B, C -> D）。当上游节点变化时，下游节点会根据拓扑层级进行原子化更新，完美解决“循环计算”和“重复触发”问题。

### 2. 异步水位线调度 (Watermark)
在异步任务流中，由于网络波动，旧的任务可能比新的任务更晚返回。引擎通过内置的水位线令牌，确保只有最新的任务结果会被采纳，彻底杜绝异步竞态导致的数据覆盖风险。

### 3. 计算路径剪枝 (Pruning)
引擎会自动比对节点的值（Value Check）。如果某个节点的计算结果与之前一致，引擎将自动截断该路径的后续传播，实现极致的性能优化，支持 500+ 节点的实时复杂联动。

---

## ✨ 特性

- **🏗️ 纯粹 Headless**：无 UI 绑定，适配 Vue/React/Solid 或 Node.js 环境。
- **⚡ 极致类型推导**：提供完整的路径感知能力，支持超大规模 Schema 的深度类型检查。
- **🧩 开放式模块系统**：通过 `modules` 注入，你可以轻松给引擎套上“表单”、“动画”或“工作流”的壳子。
- **🚨 循环依赖检测**：在规则注册阶段即进行环检测，防止逻辑死循环。
- **📦 极简体积**：产物仅 **~13KB**，零第三方依赖。

---

## 🚀 核心概念演示

* **[数据表单场景]** 👉 使用 [**@meshflow/form**](https://www.npmjs.com/package/@meshflow/form) (基于 Core 封装的专业表单逻辑层)。
