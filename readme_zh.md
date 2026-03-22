# MeshFlow

> **逻辑如力场，坍缩至势能最低处。**

[English](./README.md) | [中文] 

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-red.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docs](https://img.shields.io/badge/docs-meshflow--docs-blue)](https://meshflow-docs.nzyhave.fun/)

**MeshFlow** 是一款基于 **“逻辑力场 (Logic Force Field)”** 模型的响应式拓扑调度引擎。

它不依赖复杂的黑盒算法，而是通过朴素的物理直觉——**将逻辑连动的深度抽象为物理高度**。利用核心的 **“水位线闸门 (Waterline Gate)”** 调度策略，MeshFlow 能让复杂的异步联动像水往低处流一样自发收敛，从结构上彻底解决异步竞态、钻石依赖与循环约束难题。
 

## 🌌 核心设计：什么是“逻辑力场”？

“逻辑力场”并非虚构的理论，而是一套将**逻辑抽象为物理位能**的设计模型。MeshFlow 通过以下三个维度模拟物理世界的自发收敛：

### 1. 逻辑深度 = 物理高度 (Topological Gradient)
在 MeshFlow 中，每一个节点都处在不同的“海拔”上。
* **引力轨道**：通过 `SetRule` 定义的先后顺序，实际上建立了从高位向低位流淌的“引力轨道”。
* **自发演化**：一旦源头数据发生变化，系统利用这种“势能差”驱动数据像水一样顺着拓扑路径自动向下游传播，无需手动触发。



### 2. 水位线 = 闸门控制 (Waterline Gate)
为了处理“钻石依赖”，力场引入了分层管理的闸门机制。
* **等位同步**：同一层级的节点被视为在同一“水位线”上。
* **防乱序**：只有当当前层级的所有逻辑（包括异步 Promise）彻底结算、水位“找平”后，下一层的闸门才会开启。这确保了下游节点永远不会在不稳定的中间态被错误触发。



### 3. 能量耗散 = 逻辑坍缩 (Energy Dissipation)

系统的演化本质上是能量的耗散。为了确保系统最终回归静止，MeshFlow 区分了三种收敛机制：

- **有向收敛 (DAG)**：在单向轨道中，能量随水位线流尽后自发归零。这是由拓扑结构保证的确定性静止。
- **阻尼收敛 (Cycle)**：在纠缠回路中，引入 **阻尼 (Damping)** 概念。当逻辑变化量小于自己的预设阈值时不应继续通过emit发射预言，系统进入静默态。这种“逻辑摩擦力”克服了循环震荡的惯性，迫使系统向 **势能最低点** 坍缩。
- **熔断收敛 (Cycle)**：如果用户未提供阻尼约束，或震荡超出了安全边界，引擎将判定为能量发散，立即执行强制熔断以保护计算资源。


---

## ✨ 引擎特性 (Features)

- **⚡ 极致剪枝 (Energy Dissipation)**：基于桶计算的记忆化机制，自动识别并截断无效的能量传导路径。
- **🛡️ 时序屏障 (Temporal Barrier)**：依托 **Token 与 Version** 机制，彻底杜绝异步回调产生的“幽灵更新”。系统自动丢弃过时的预言，确保逻辑演化永不偏移。
- **📦 框架无关**：零外部依赖，体积约 10kB。完美适配 Vue、React 或原生 JavaScript。

 

## 🧪 实验场 (Live Demo)

在9*9数独的复杂约束场中，观测逻辑如何自动完成势能坍缩：
👉 **[81-Node Topology Sudoku Demo](https://meshflow-docs.nzyhave.fun/demos/sudoku)**

 
## 📂 源码导览 (Source)

核心调度逻辑位于：[`utils/core/`](./utils/core/)  

*代码即是力场，逻辑即是物理。*
 

## 📜 协议 (License)

本项目采用 [GNU AGPL v3.0](./LICENSE) 协议。

 