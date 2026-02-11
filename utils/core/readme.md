# @meshflow/core

**基于水位线调度（Watermark Scheduling）的轻量级拓扑逻辑引擎。**

## 🎯 它解决了什么问题？

在复杂的**中后台表单**或**大型配置系统**中，数据的联动关系往往错综复杂。`@meshflow/core` 专门解决以下痛点：

### 1. 异步回填的“覆盖”难题 (Race Conditions)
* **痛点**：用户连续切换两次下拉框，第一次请求（旧数据）由于网络延迟，比第二次请求（新数据）更晚返回，导致表单显示了错误的老数据。
* **方案**：`MeshFlow` 的水位线机制确保只有对应最新操作的异步结果会被最终采纳。

### 2. 钻石依赖的“重复计算” (Diamond Dependency)
* **痛点**：A 变了，B 和 C 都要变，而 D 依赖于 B 和 C。在普通监听模式下，D 会被触发两次。如果 D 是个昂贵的计算或接口，这会造成严重的性能浪费。
* **方案**：引擎通过拓扑层级分析，确保 D 只在 B 和 C 全部就绪后，才进行**单次**原子化更新。



### 3. 联动地狱 (Spaghetti Code)
* **痛点**：`if-else` 和嵌套的 `watch` 让联动逻辑散落在各处，极难维护。
* **方案**：将联动关系声明为“逻辑节点”。你只需关心数据流向，环检测和执行顺序交给引擎。

---

## ✨ 核心特性

* **🌊 水位线调度**：引入逻辑水位线机制，确保异步节点严格按序提交，彻底杜绝“旧数据覆盖新数据”的经典异步难题。
* **🏗️ 层级拓扑引擎**：基于 **Kahn 算法** 实现，自动计算节点深度等级，支持同层级节点并发执行。
* **⚡ 惰性求值与记忆化**：引入“桶计算”缓存机制，在拓扑传播过程中自动比对输入特征，仅在依赖项发生实质性变更时才触发逻辑重算。
* **⚡ 变更剪枝**：即使节点处于受影响路径上，若输入状态未通过有效性检查，引擎将自动截断该路径的后续传播，实现真正的计算最小化。
* **🚨 循环依赖检测**：在节点定义阶段实时进行 $O(V+E)$ 的环检测，提前发现逻辑死循环。
* **📦 极简轻量**：零依赖，体积仅 ~7kB(zipped)，适配任何 JavaScript 运行时。
* **🔌 插件化架构 (New)**：支持生命周期拦截与监听（如官方调试插件 `@meshflow/logger`）。
---
 
## 🚀 快速上手

#### 安装

```bash
npm install @meshflow/core
``` 
#### 初始化引擎
```typescript
import { useMeshFlow } from "@meshflow/core";
const schema = {
    type: 'group',
    name: 'billing',
    label: '计费与汇总',
    children: [
        { type: 'number', name: 'totalPrice', label: '预估月度总价', value: 0, },
        { type: 'input', name: 'priceDetail', label: '计费项说明', value: '基础配置费用'}
    ]
};
 
const engine = useMeshFlow<Ref<number,number>,AllPath>('main',schema, {
  // config:{
  //   useGreedy:true
  // },
  UITrigger:{//以vue为例
    signalCreateor: () => ref(0),
    signalTrigger(signal) {
      signal.value++;
    },
  }
});
```
#### 添加联动依赖
```typescript
//声明联动规则：当总价 > 2000 时，自动修改描述与主题
engine.config.SetRule("billing.totalPrice", "billing.priceDetail", "value", {
  logic: ({ slot }) => {
    const [total] = slot.triggerTargets; // 从触发目标中解构出 totalPrice
    return total > 2000 ? "大客户折扣" : undefined;
  }
});
engine.config.SetRule( "billing.totalPrice", "billing.priceDetail", "theme", {
    logic: (api) => {
        const [value] = api.slot.triggerTargets;
        return total > 2000 ? "warning" : undefined;
    },
});
//触发首屏计算
engine.config.notifyAll();
```

## 🛠️ 为什么选择 MeshFlow？

在传统的事件驱动开发中，当 A 变化触发 B 和 C，而 B 和 C 又共同触发 D 时（**钻石依赖**），D 往往会被重复触发，且异步回填的顺序无法保证。



`@meshflow/core` 通过内部的 **DAG（有向无环图）** 和 **Watermark** 机制，确保：

* **确定性**：无论异步耗时多久，最终状态始终保持一致。
* **原子性**：一次输入变化，仅触发一次拓扑链路的完整更新。