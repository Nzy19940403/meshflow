 
 
import { KeysOfUnion } from "../utils/util";


/**
 * @description 核心内部事件名枚举
 * @group 类型管理
 * @category 事件类型
 */
export const enum MeshFlowEventsName {
  FlowStart = 0,
  FlowSuccess = 1,
  FlowEnd = 2,
  FlowAbort = 3,
  FlowWait = 4,
  FlowFire = 5,
  
  NodeStart = 6,
  NodeSuccess = 7,
  NodeProcessing = 8,
  NodeError = 9,
  NodePending = 10,
  NodeRevive = 11,
  
  NodeIntercept = 12,
  NodeRelease = 13,
  NodeStagnate = 14,
  
  NodeBucketSuccess = 15,
  
  EntangleWarn = 16,
  EntangleBlocked = 17,

  EntangleEpochChange = 18,
  EntangleEmitCalled = 19,

  TransactionAbort = 20
}

/**
 * @description 基础事件负载定义
 * @internal
 */
export interface BaseMeshEvents {
  [MeshFlowEventsName.FlowStart]: { path: MeshPath; token: symbol };
  [MeshFlowEventsName.FlowWait]: { type: number; detail?: any };
  [MeshFlowEventsName.FlowFire]: { path: MeshPath; type: number; detail?: any };

  [MeshFlowEventsName.NodeStart]: { path: MeshPath; calledBy: number };
  [MeshFlowEventsName.NodeSuccess]: { path: MeshPath; calledBy: number };
  [MeshFlowEventsName.NodeProcessing]: { path: MeshPath; calledBy: number };
  [MeshFlowEventsName.NodeError]: { path: MeshPath; error: any };
  [MeshFlowEventsName.NodePending]: { path: MeshPath };

  [MeshFlowEventsName.NodeIntercept]: { path: MeshPath; type: number; detail?: any };
  [MeshFlowEventsName.NodeRelease]: { path: MeshPath; type: number; detail?: any };
  [MeshFlowEventsName.NodeStagnate]: { path: MeshPath; type: number };

  [MeshFlowEventsName.NodeBucketSuccess]: { path: MeshPath; key: string; value: any; calledBy: number };

  [MeshFlowEventsName.EntangleWarn]: { path: string; type: 'no_keys' | 'no_level' };
  [MeshFlowEventsName.EntangleBlocked]: { observer: string; target: string; count: number };

  [MeshFlowEventsName.EntangleEpochChange]:{timestamp:number}
  [MeshFlowEventsName.EntangleEmitCalled]:{observer: string; target: string;via:any}
  [MeshFlowEventsName.TransactionAbort]:0
}

/**
 * @description 完整事件扩展定义
 * @group 类型管理
 * @category 事件类型
 */
export interface MeshEvents extends BaseMeshEvents {
  [MeshFlowEventsName.FlowSuccess]: { duration: string; token: symbol };
  [MeshFlowEventsName.FlowEnd]: { type: number };
  [MeshFlowEventsName.FlowAbort]: { token: symbol };

  // 逆转未来时候的事件
  [MeshFlowEventsName.NodeRevive]: { path: MeshPath; triggerPath: MeshPath };

}
 /**
 * @internal
 */
export type MeshEventName = keyof MeshEvents;
 /**
 * @internal
 */
export type MeshEmit = <K extends MeshEventName>(
  event: K,
  data?: MeshEvents[K]
) => void;
/**
 * @group 类型管理
 * @category 历史类型
 * 
*/
export type HistoryActionItem = {
  undoAction: () => void;
  redoAction: () => void;
};
/**
 * @group 类型管理
 * @category 历史类型
 * 
*/
export type MeshFlowHistory = {
  Undo: () => void;
  Redo: () => void;
  updateUndoSize: any; // 如果是 Vue 可以是 Ref<boolean>
  updateRedoSize: any;
  PushIntoHistory: (action: HistoryActionItem, cleanRedo?: boolean) => void;
  CreateHistoryAction: (
    metadata: [{ path: string; value: any }, { path: string; value: any }],
    cb: any
  ) => {
    undoAction: () => any;
    redoAction: () => any;
  };
};

/**
 * @group 类型管理
 * @category 错误类型
 */
export interface MeshErrorContext {
  path: string;
  error: any;
}
/**
 * MeshPath：多模态路径标识符
 * @description 
 * 定义 MeshFlow 节点的唯一寻址路径。支持多种原始类型以适配不同的业务场景：
 * - **string**: 💡 推荐。语义化最强，支持深度路径嵌套（如 `user.profile.id`）。
 * - **number**: ✅ 稳定。常用于位操作、枚举 ID 或高性能数组索引节点，与引擎内部 UID 逻辑契合度高。
 * - **symbol**: ⚠️ **实验性**。用于创建绝对私有的节点，防止意外覆盖。
 * @note **关于 Symbol 的约束**：
 * 目前版本下，Symbol 路径无法被标准 JSON 序列化，可能会出现意料之外的bug。
 * @group 类型管理
 * @category 路径类型
 */
export type MeshPath = string | number | symbol;

// export interface MeshBucket<P> {
//   evaluate: (context: any) => Promise<any> | any;
//   [key: string]: any;
// }

 /**
 * @internal
 */
export type MeshNodeProxy<Node, V, NM, Extra = {}> = Extra & V & Node & NM;

 /**
 *  
 * @description task节点类型
 * @group 类型管理
 * @category 节点类型
 */
export interface MeshFlowTaskNode<
  P extends MeshPath = MeshPath,
  V = any,
  NM = any
> {
  path: P;
  uid: number; //内部id
  type: string;

  state: V;

  // nodeBucket: Record<keyof NM, SchemaBucket<P>>;
  nodeBucket: Record<SuggestKey<NM>, number>;
  notifyKeys: Set<SuggestKey<NM>>;
  // --- 响应式信号 ---
  // 用于通知 UI 组件重绘 (对应 Vue Ref 或 React State)
  dirtySignal: any;

  proxy: MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM>;

  calledBy:TriggerCause

  meta: NM ; //存放业务元数据
  dependOn: (cb: (val: V) => V, key?:SuggestKey<NM>) => void;
  createView: <E extends Record<string, any> = {}>(extraProps?: E) => MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM, E>;
}
 /**
 *  
 * @description group节点类型
 * @group 类型管理
 * @category 节点类型
 */
export interface MeshFlowGroupNode<P extends MeshPath = MeshPath> {
  path: P;
  uid: number; // 依然需要 UID 做渲染 Key
  type: "group";

  // 核心职责：持有子节点索引
  // 这里存子节点的 Path，渲染时去 Scheduler 或者是 GroupsMap 里找
  children: Array<P>;
  dirtySignal: any;
  meta: Record<string, any>;
  createView: (extraProps?: Record<string, any>) => any;
}
/**
 * @internal
 * */ 
export interface StandardUITrigger<T> {
    signalCreator: () => T;
    signalTrigger: (signal: T) => void;
}
 /**
 * @internal
 */
export interface DependOnContext<P extends MeshPath> {
  path: P;
  getNode: (path: P) => MeshFlowTaskNode<P>;
  // 你可以根据需要扩展，比如 getValue, emit 等
}

 

/** 
* @group 参数类型
* @category 依赖设置
* @description 桶计算的逻辑块入参类型
*/
export interface logicApi<NM,TKeys extends SuggestKey<NM>> {
  slot: {
    triggerTargets: Array<
      // 🌟 核心修改：将属性映射与 { proxy: any } 进行交叉
      (Record<IsNever<TKeys> extends true ? (InternalKeys | SuggestKey<NM>) : TKeys, any>) 
      & { proxy: any } 
    >;
    affectedTatget: any;
    targetMeta:any
  };
}
 /**
 *  
 * @description 节点开放的一些内部键值
 * @group 类型管理
 * @category 节点类型
 */
export type InternalKeys = 'path'|'uid'|'type'|'meta'|'state'
 /**
 * 节点规则配置接口
 * @group 参数类型
 * @category 依赖设置
 * @typeParam NM - 状态大盘的类型定义
 * @typeParam TKeys - 当前节点关联的键集合
 * @params logic - 桶计算的逻辑块，一个桶里面可以装多个逻辑块，根据策略进行计算，逻辑块入参参考{}
 */
export interface SetRuleOptions<NM, TKeys extends (SuggestKey<NM> | Exclude<InternalKeys, 'state'>)  > {
/**
   * 结果覆盖值 (静态产出)
   * * @description
   * 规则命中后的确定性结果。其行为在不同策略下表现如下：
   * * - **【必备】OR 策略**：作为 If-Then 模型的成果。当 logic 返回真值时，此字段提供节点最终产出的数据。
   * - **【可选】PRIORITY 策略**：作为静态覆盖。若配置此值，将无条件替换 logic 的计算结果；若不配置，则直接采用 logic 的返回值。
   * - **【可选】MERGE 策略**：作为结构化补丁。用于在逻辑运算之外，额外合并一份静态的配置增量。
   * * @note 💡 **最佳实践**：
   * 在 `OR` 模式下，建议永远配合 `value` 使用以获得明确的业务状态。
   */
  value?: any;
  /**
   * 逻辑优先级 (仅在 PRIORITY 策略下生效)
   */
  priority?: number;
  forceNotify?: boolean;
  /**
   * 核心逻辑片段 (Logic Fragment)
   * * @description
   * 节点规则的执行体。它是碎片化的，允许针对同一节点注册多个逻辑片段。
   * * **策略影响 (Strategy Impact)：**
   * - **OR (逻辑或)**: 只要有一个逻辑片段返回真值，即终止计算并输出该值。
   * - **PRIORITY (优先级)**: 按 `priority` 顺序执行，取第一个非 `undefined` 的返回值。
   * - **MERGE (增量聚合)**: 执行所有逻辑片段，并将结果进行深度合并 (Object/Array)。
   * * @param api 注入的运行上下文 {@link logicApi}
   */
  logic: (api: logicApi<NM,TKeys>) => any;
 /**
   * 后置副作用 (Post-Settlement Effect)
   * * @description 
   * 节点计算完成后的回调钩子。
   * 
   * * @param args 由 {@link effectArgs} 指定的实时数据快照。
   */
  effect?: (args: any) => any;
   /**
   * 📥 副作用参数声明
   * * @description 
   * 显式定义需要注入给 `effect` 函数的参数。
   * 引擎会从全局状态大盘 (NM) 中摘取这些字段的最新值，打包传递给副作用函数。
   */
  effectArgs?: Array<KeysOfUnion<NM>>;
  /**
   * 桶的缓存策略
   * * @description 
   * 控制计算结果的记忆化 (Memoization) 行为。
   * - `shallow` (默认): 基于依赖项进行浅比较，未变则直接复用缓存。
   * - `none`: 彻底禁用缓存，每次唤醒必执行。
   */
  cacheStrategy?: "none" | "shallow";
  /**
   *  触发键定义 (精准点火开关)
   * * @description 
   * 定义该“法条”对源节点中哪些字段的变更敏感。
   * * **触发行为：**
   * - **已定义**：仅当列表中的 Key 发生变更时，才执行 `logic`。实现精准的按需计算。
   * - **未定义 (Default)**：源节点（TriggerPath）内的**任意**字段变更都会唤醒本条逻辑。
   */
  triggerKeys?: Array<TKeys>;
}

/** 
* @group 参数类型
* @category 纠缠设置
* @description 提案的update可选的参数，参考{@link GhostProposalApi}
*/
export type EntangleOp = "add" | "intersect" | "union" | "merge" | "remove";

/**
 * 幽灵提案 API (Ghost Proposal API)
 * * ### 架构思想：延迟决议 (Deferred Resolution)
 * 在复杂的 DAG (有向无环图) 状态机中，如果在副作用函数中直接修改目标状态（如 `tgt.price = 100`），
 * 极易引发不可控的竞态条件 (Race Condition)、级联重绘或死循环。
 *   为了系统性地规避上述风险，MeshFlow 设计了 **“幽灵提案”** 机制。其核心交互模式借鉴了 **Git 的 Pull Request**：
 * 1. **📝 提交提案 (Propose)**：引擎限制了对状态的直接修改。所有通过此 API 发起的操作（`set` / `update` / `patch`）
 * 都不会立即生效，而是转化为数据对象并暂存于引擎的缓冲池 (`_ghostBuffer`) 中。
 * 2. **🛡️ 统一清算 (Resolve)**：当当前批次的所有计算流执行完毕后，引擎会作为调度中心，统一收集并合并这些提案。
 * 3. **⚖️ 权重裁决 (Weight)**：面对多源并发修改，引擎严格按照提案的**权重 (`weight`)** 和预设策略进行确定性计算，而非依赖执行的先后顺序。
 * > **💡 总结**：幽灵提案机制将不可控的“时间依赖”转化为了安全的“逻辑依赖”，从而保证了每次状态计算的原子性与确定性。
 * @example
 * // 场景：多个规则并发更新购物车总价
 * engine.config.useEntangle({
 * // ...
 * emit: (src, tgt, propose) => {
 * // 提交增量修改提案，而非直接操作 tgt.totalPrice
 * propose.update('totalPrice', src.price, 'add');
 * }
 * });
 * @group 参数类型
 * @category 纠缠设置
 */
export interface GhostProposalApi<State,NM> {
/**
   * 提交【绝对值覆盖】提案
   * @description 直接用新值覆盖目标节点的指定状态。
   * @param key 目标节点的状态属性名
   * @param value 期望设置的新值
   * @param weight 提案权重 (默认: 1)。当同一批次内有多个规则试图 `set` 同一个 key 时，权重最高者获胜。
   */
  set: (key: SuggestKey<NM>, value: any, weight?: number) => void;
/**
   * 提交【增量运算】提案
   * @description 提交一个增量操作，引擎会在清算时将其与目标节点的旧值进行合并计算。
   * @param key 目标节点的状态属性名
   * @param delta 增量数据 (如累加的数值、需追加的数组元素)
   * @param op 运算策略 (默认: 'add')。支持：累加(add)、移除(remove)、交集(intersect)、并集(union)、深度合并(merge)。
   */
  update: (key: SuggestKey<NM>, delta: any, op?: EntangleOp) => void;
/**
   * 提交【函数式补丁】提案
   * @description 基于目标节点的当前状态进行纯函数推导，适用于高度依赖旧值的复杂状态计算。
   * @param key 目标节点的状态属性名
   * @param patchFn 状态计算回调。接收该 key 的当前旧值 (`oldState`)，需返回计算后的新值。
   ** @note ⚠️ **性能预警**：
   * `patch` 模式虽然具备最高的自由度，在常规业务逻辑（如表单联动、状态切换）中可放心使用。
   * 但由于其返回对象通常会触发堆内存分配，在高频纠缠的情况下会显著增加 GC压力。
   * 为了追求极致的内存性能并减少 GC 压力，请优先考虑性能更优的update方法。
   */
  patch:<
    K extends SuggestKey<NM>, 
    // 🌟 1. 自动计算 V (Value) 的类型
    V = IsAny<State> extends false 
        ? State 
        :IsNever<NM> extends true ? any :  
        (IsAny<NM> extends false ? (K extends keyof NM ? NM[K] : any) : any)
  > 
  (key: K, patchFn: (oldState: V) => V) => void;
}
  
/**
 * 幽灵提案数据载体 (Internal Ghost Payload)
 * * @description
 * 这是 {@link GhostProposalApi} 调用的内部物化结构。
 * 当用户在 `emit` 中调用 `propose` 的相关方法时，引擎会实例化此对象并推入 `_ghostBuffer` 缓冲池，等待当前批次调度结束时由 `resolveGhosts` 统一清算。
 * * @internal 引擎内部流转类型，普通开发者无需手动构造。
 * @group Core Api
 * @category Entanglement
 */
export type EntangleGhost<T=any> = {
  key: string;      // 要改变目标节点的哪个属性 (如 'disabled', 'value')
  value?: any;         // 建议的值
  delta?: number | any;
  weight?: number;  // 权重 (默认 1)
  op?: EntangleOp;
  patch?:(oldState:T)=>T
};
/**
 * @internal
 * */ 
export type IsAny<T> = 0 extends (1 & T) ? true : false;
/**
 * @internal
 * */ 
export type IsNever<T> = [T] extends [never] ? true : false;



/**
 * 量子纠缠机制的配置选项
 * @typeParam P - 路径标识类型
 * @group 参数类型
 * @category 纠缠设置
 */
export type EntangleArgType<P extends MeshPath,State = any,NM=any,  IsProxy extends boolean = boolean> = {
  cause:P;
  impact:P;
  via:Array<
  SuggestKey<NM>
  // IsAny<NM> extends true ? string :
  // IsNever<NM> extends true ? string : keyof NM |(string & {}) 
  >;
  isProxy?: IsProxy;
  filter?: (
    cause: IsProxy extends true ? any : MeshFlowTaskNode<P>, 
    impact: IsProxy extends true ? any : MeshFlowTaskNode<P>
  ) => boolean;
  /**
     * @params propose  提案调用参考{@link GhostProposalApi}
    */
  emit:(
    cause: IsProxy extends true ? any : MeshFlowTaskNode<P>, 
    impact: IsProxy extends true ? any : MeshFlowTaskNode<P>,
    propose:GhostProposalApi<State, NM>) => void | EntangleGhost<State> | undefined | Promise<void | EntangleGhost<State> | undefined>; // 预言推演逻辑
};
 /**
 * 引擎点火溯源标识 (Trigger Cause)
 * * @description
 * 用于标识当前计算任务是被何种机制唤醒的。
 * 在复杂的 DAG 图与量子纠缠网络中，精准的溯源不仅有助于 DevTools 的可视化链路追踪，
 * 更是引擎底层防范“无间断递归”和“环路死锁”的核心判定依据。
 * @group 类型管理
 * @category 内部任务触发类型
 */
export const enum TriggerCause {
  /**
   * **正向因果推导 (CAUSALITY)**
   * @description 顺向的拓扑传播。即：上游依赖节点的值发生变更，导致当前节点按照标准的 DAG 边方向被触发重算。
   * @note 这是引擎最基础、最常规的自然点火原因。
   */
  CAUSALITY = 0,   // 因果推导（正常）
/**
   * **纠缠源头 (INVERSION)**
   * @description 当前节点作为量子纠缠 (`useEntangle`) 的**“直接标的”**被唤醒。
   * 即：它是被幽灵提案直接修改的那个节点。它打破了原有的触发链，成为了新一轮拓扑计算的“新源头”。
   */
  INVERSION = 1,   // 逆转回跳（纠缠）
  /**
   * **纠缠连锁余波 (REPERCUSSION)**
   * @description 由 `INVERSION` 节点引发的下游连带更新。
   * 即：当前节点本身并没有被纠缠直接修改，但因为它的上游节点是被纠缠修改的，它顺着 DAG 拓扑被“余波”唤醒。
   */
  REPERCUSSION = 2  // 连锁：由逆转回跳引发的因果推导
}
 /**
 *  
 * @description 节点状态类型
 * @group 类型管理
 * @category 节点类型
 */
export const enum NodeStatus {
  NONE    = 0,
  READY   = 1 << 0, // 1 
  STAGING = 1 << 1, // 2
  RESURE  = 1 << 2, // 4
  DIRTY   = 1 << 3, // 8 (备用：标记节点是否需要重算)
  PROCESSED  = 1 << 4, // 16  替代 processed 数组
  PROCESSING = 1 << 5, // 32  替代 processingSet 数组
}
/**
 * 异常字典：汇总内核运行时的循环依赖、实例缺失等核心错误
 * @description
 * 该枚举定义了 MeshFlow 在拓扑计算、引擎初始化及节点校验阶段可能抛出的标准化错误。
 * 建议在逻辑层通过 `try-catch` 捕获并匹配这些错误常量，以实现精确的错误处理。
 * @group 类型管理
 * @category 错误类型
 */
export const MeshError = {
  cycle : "Circular dependency detected",
  EngineNotFound : "Engine not found.",
  EngineIdRepeated : "engineID repeated",
  WrongId : "Wrong id",
  DuplicatePath: (path: any) => `[MeshFlow] Duplicate Path: ${String(path)}`
} as const;
/**
 * 引擎预设的桶计算策略
 * @description 决定了当一个节点绑定了多个规则时，引擎如何处理冲突、优先级以及最终值的推导。
 * 所有策略均原生支持异步逻辑，并严格保障异步链条中的按序执行原则。
 * @group 类型管理
 * @category 桶计算策略类型
 */
export enum DefaultStrategy {
 /**
   * **逻辑或 / 短路回退策略 (OR)**
   * * @description
   * 按序执行规则。当找到第一个满足条件（逻辑返回真值）的规则时，立即中断后续规则执行（短路机制）。
   * * **核心行为：**
   * 1. **短路匹配**：若 `rule.logic` 返回 truthy，将提取该规则的 `value` 作为最终结果并中断。
   * 2. **异步原子性**：严格按照声明顺序 `await`，保证高优先级规则先被检验。
   * 3. **底色回退**：若所有普通规则均未匹配（或返回 falsy），则回退使用 `__base__` 规则的值作为兜底保障。
   */
  OR = "OR",
/**
   * **绝对优先级策略 (PRIORITY)**
   * * @description
   * 严格遵循规则顺序的“首中制”策略，适用于互斥型逻辑判断。
   * * **核心行为：**
   * 1. **非空即中**：按序执行，首个返回 **非 `undefined`** 的规则直接获胜，立即中断后续计算。
   * 2. **无视布尔值**：与 `OR` 策略不同，即使逻辑返回 `false`、`0` 或 `null`，只要不是 `undefined`，依然视为有效命中。
   */
  PRIORITY = "PRIORITY",
/**
   * **聚合策略 (MERGE)**
   * * @description
   * 收集桶内所有规则的产出，并按照规则定义的先后顺序进行**结构化合并**。
   * * **核心特性：**
   * 1. **有序覆盖**：后执行的规则结果具有更高优先级。
   * - **对象**：执行浅层合并 `{ ...old, ...new }`，同名键值由后者覆盖。
   * - **数组**：执行末尾追加 `[...old, ...new]`。
   * 2. **异步原子性**：原生支持异步规则。即使存在 Promise，引擎也会通过异步链条严格保证合并顺序与规则声明顺序一致。
   * 3. **底色机制 (__base__)**：支持 `entityId` 为 `__base__` 的特殊规则。其产出作为节点的“底色数据”，会被普通规则的非空产出所覆盖。
   * * @example
   * // 场景：多个规则共同定义一个配置对象
   * // Rule A: { a: 1 }
   * // Rule B (async): 返回 { b: 2 }
   * // 最终结果: { a: 1, b: 2 }
   */
  MERGE = "MERGE",
}
 

/**
 * MeshFlow 引擎核心 API
 * @description 提供了状态读写、规则注册、依赖分析及生命周期钩子等底层能力。
 * @group Core Api
 * @category Engine
 */
export interface EngineCoreAPI<P extends MeshPath, NM> {
  /**
   * 引擎配置与规则管理
   * @group 核心模块
   */
  config: {
/**
   * @category DAG
   * @description 建立一对一依赖关系，并自动加入异步校验队列。
   * @remarks
   * **安全性保障**：引擎会自动探测循环依赖（Cycle Detection）。
   * **性能优化**：校验逻辑被设计为“异步批量执行”。即便你在一个宏任务（如同步代码块）内连续调用 100 次 `SetRule`，
   * 引擎也只会通过微任务（Microtask）在下一刻触发 **一次** 全局环路扫描，确保初始化零负担。
   * @throws {MeshError.cycle} 当新建立的规则与现有规则构成环路（如 A -> B -> A）时抛出。
   * @example
   * ```ts
   * // 场景：A 节点的 count 变化时，B 节点的 value 自动加 1
   * engine.config.SetRule('path/A', 'path/B', 'value', {
   *   triggerKeys: ['count'],
   *   logic: ({ slot }) => {
   *     // 从 slot 中安全解构出触发源的数据快照
   *     const [sourceValue] = slot.triggerTargets;
   *     return sourceValue.count + 1;
   *   }
   * });
   * ```
   */
    SetRule: <
    K extends KeysOfUnion<NM>,
    TKeys extends KeysOfUnion<NM>  ,
    >(outDegreePath: P, inDegreePath: P, key: K,options: SetRuleOptions<NM, TKeys>) => void;
    
  /**
   * @category DAG
   * @description 建立多对一的聚合依赖关系，将多个源节点状态收敛至目标节点。
   * @remarks
   * **聚合逻辑**：只要 `outDegreePaths` 数组中的任何一个节点发生变更（匹配 `triggerKeys`），
   * 引擎就会触发一次目标节点的 `logic` 计算。
   * **数据快照**：`slot.triggerTargets` 将按照你传入路径的顺序，完整提供所有源节点的数据快照。
   * **性能保障**：同样受“微任务批处理”保护，自动检测跨节点构成的复杂环路。
   * @example
   * ```ts
   * // 场景：计算总分。当 A 节点或 B 节点的 score 变化时，C 节点的 total 自动更新
   * engine.config.SetRules(['path/A', 'path/B'], 'path/C', 'total', {
   *   triggerKeys: ['score'],
   *   logic: ({ slot }) => {
   *     // 按照输入顺序解构：targetA 对应 path/A，targetB 对应 path/B
   *     const [targetA, targetB] = slot.triggerTargets;
   *     return targetA.score + targetB.score;
   *   }
   * });
   * ```
   */
    SetRules: <  
    K extends KeysOfUnion<NM>,
    TKeys extends KeysOfUnion<NM>>( outDegreePaths: P[],
      inDegreePath: P,
      key: K,
      options: SetRuleOptions<NM,TKeys>) => void;
    
/**
     * 设置引擎的桶计算策略
     * * @description 
     * 该配置决定了引擎在处理 DAG 节点冲突或多规则并行时的决策逻辑。
     * 默认情况下，引擎可能使用 {@link DefaultStrategy.OR} 策略。
     * * @param strategy - 策略类型。支持传入预设的 {@link DefaultStrategy}，也支持传入自定义策略的字符串标识。
     * * @example
     * // 设置为优先级模式，确保高权重规则生效
     * engine.config.SetStrategy(DefaultStrategy.PRIORITY);
     * * @example
     * // 设置为合并模式，适用于表单多字段联合校验或数据聚合
     * engine.config.SetStrategy(DefaultStrategy.MERGE);
     */
    SetStrategy: (strategy: typeof DefaultStrategy | string) => void;
    
   /**
 * 触发全量拓扑计算  
 * @description
 * 强行无视当前节点的脏状态，从依赖网的所有源头节点（Root Nodes）开始，重新点火并贯穿执行整个拓扑图。
 * 常用于引擎初始化完成、动态增删规则或需要强制同步全局状态的场景。
 * @async
 * @returns {Promise<void>}
 * @example
 *  初始化最后调用
 *  engine.config.notifyAll();
 * * ### 核心运行机制：
 * 1. **环路预检**：执行前自动调用 `CheckCycleInGraph`，确保图结构合法。
 * 2. **拓扑分层**：基于依赖关系获取完整的拓扑排序，识别出所有入度为 0 的源头。
 */
    notifyAll: () => void;
    
    /** 挂载外部插件 */
    usePlugin: (plugin: any) => void;
    
    /** 检查当前引擎是否启用了渲染网关 (Render Gate) */
    hasRenderGate: () => boolean;
    
    /** 挂载量子纠缠 (Entanglement) 机制 */
    useEntangle: <State=any>(entangleFn: any) => void;
  };

  /**
   * 数据大盘读写接口
   * @group 核心模块
   */
  data: {
    /**
     * 写入数据触发点火
     * @param path 节点的唯一路径标识
     * @param value 要写入的最新值
     */
    SetValue: (path: P,key: SuggestKey<NM>, value: any) => void;
    
    /** 读取指定节点的值 */
    GetValue: (path: P,key:SuggestKey<NM>) => any;
    
    /** 批量写入数据 */
    SetValues: (updates: { path: P, key: SuggestKey<NM>, value: any }[]) => void;

 /**
 *  
 * * @description 
 * 该方法不会立即中断当前引擎任务，而是将修改意图推入 `stageBuffer`。
 * 主要用于处理外部高频干预（如自动空投、WebSocket 流、或是跨帧的连续修改）。
 * * @features
 * 1. **非侵入性**：如果引擎正在运行，它会静默排队，待当前纠缠落地后再通过 monitor 自动收割。
 * 2. **自动点火**：如果引擎处于静止态，它会触发微任务级别的“聚合点火”，确保多笔修改只启动一次 Task。
 * 3. **协助纠缠**：作为外部与纠缠系统之间的“避震器”，防止高频交互导致因果链条（Token）频繁重置。
 * * @param path - 目标节点的路径 (nodeProxy.path)
 * @param key - 需要修改的属性键名 (必须是模型定义的 SuggestKey)
 * @param value - 注入的原始物理值 (注入后将作为下一轮纠缠的种子)
 * * @example
 * engine.data.StageValue(path, 'isDead', false);
 */
    StageValue:(path: P,key: SuggestKey<NM>, value: any) => void;
    /**
 *  静默更新 (Silent Update)
 * * @description 
 * 强制篡改节点状态而不触发任何纠缠任务（Task）。
 * 该操作是“非响应式”的，引擎不会感知到此次变化，也不会产生拓扑波动。
 * * @example
 * // 场景：系统重置（降噪）
 * // 先将所有背景节点的干扰项“强行降噪”为 0，再通过 SetValue 触发一次“纯净”的任务流。
 * list.forEach(node => engine.data.SilentSet(node.path, 'count', 0));
 * engine.data.SetValue('N5', 'count', 500); // 此时只有 N5 是唯一的能量源
 * * @param path - 节点的唯一路径
 * @param key - 需要修改的状态键名
 * @param value - 目标值
 * @returns {boolean} 是否成功修改了内存值（若值相等或路径无效则返回 false）
 */
    SilentSet:(path: P,key: SuggestKey<NM>, value: any) => boolean;
    /** 根据路径获取对应分组的数据 */
    GetGroupByPath: (path: P) => any;

     /**
      * 事务性任务列表，支持传入回调，回调的入参是resolve和reject，在回调里面调用resolve就会启动task，这个task执行完就会执行下一个回调
     */
    SettleTasks: (array: TransactionArray) => void;
  };

  /**
   * 拓扑图与依赖分析
   * @group 核心模块
   */
  dependency: {
    /** 获取整个图的完整依赖树快照 */
    GetAllDependency: () => Record<string, any>;
    
    /** 获取当前 DAG 图的拓扑排序执行顺序 */
    GetDependencyOrder: () => string[];
  };

  /**
   * 引擎生命周期钩子
   * @group 核心模块
   */
  hooks: {
    /** 引擎执行过程发生错误时的回调 */
    onError: (cb: (err: MeshErrorContext | Error) => void) => void;
    
    /** 当前批次任务全部执行成功时的回调 */
    onSuccess: (cb: () => void) => void;
    
    /** 引擎开始点火执行时的回调 */
    onStart: (cb: () => void) => void;
  };
}

/**
 * MeshFlow 引擎初始化配置项
 * @group 参数类型
 * @category 入口函数 
 * @typeParam NM - 元数据对象的类型定义，会根据这个类型解析出键值，这些键值就是triggerKeys的来源
 * @typeParam M - 动态扩展模块的映射类型
 * @typeParam T - UI 触发器的信号类型
 */
export interface MeshFlowOptions<NM = any, M = any, T = any> {
  /**
   * 元数据类型声明
   * @description 显式指定状态大盘中各节点的类型定义。
   */
  metaType?: NM;

  /**
   * 引擎运行参数配置
   */
  config?: {
    /** * 是否开启贪婪模式
     * @default false
     * @description 开启后，引擎会尝试在单次微任务循环中执行尽可能多的逻辑。
     */
    useGreedy: boolean;
    /** * 量子纠缠步长 
     * @description 控制 `useEntangle` 触发时的递归深度限制。
     */
    useEntangleStep?: number;
  };

  /**
   * 扩展模块挂载
   * @description 传入您想在 `engine.modules` 中使用的插件或工具（如 history, validator 等）。
   * @example { history: useHistory, form: useInternalForm }
   */
  modules?: M;

  /**
   * UI 框架桥接触发器
   * @description 用于和 React/Vue 等框架的响应式系统进行底层解耦通信。
   */
  UITrigger?: {
    /** 信号创建函数 */
    signalCreator: () => T;
    /** 信号触发回调 */
    signalTrigger: (signal: T) => void;
  };
}


export type SuggestKey<T> = IsAny<T> extends true 
  ? MeshPath 
  : IsNever<T> extends true 
    ? MeshPath 
    : (T extends any ? keyof T : never) | (string & {});


export type TransactionArray = Array<(resolve: (res?:any)=>any,reject: (error?:any)=>any)=>any>