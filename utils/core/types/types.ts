 
import { KeysOfUnion } from "../utils/util";


/**
 * 🚀 核心内部事件名枚举
 * 使用 const enum 确保编译后直接内联为字符串，零运行时开销
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
}

/**
 * 🧱 基础事件负载定义
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
}

/**
 * 🌟 完整事件扩展定义
 * 包含流程控制及“逆转未来”等特殊场景
 */
export interface MeshEvents extends BaseMeshEvents {
  [MeshFlowEventsName.FlowSuccess]: { duration: string; token: symbol };
  [MeshFlowEventsName.FlowEnd]: { type: number };
  [MeshFlowEventsName.FlowAbort]: { token: symbol };

  // 逆转未来时候的事件
  [MeshFlowEventsName.NodeRevive]: { path: MeshPath; triggerPath: MeshPath };
}

export type MeshEventName = keyof MeshEvents;

export type MeshEmit = <K extends MeshEventName>(
  event: K,
  data: MeshEvents[K]
) => void;

export type HistoryActionItem = {
  undoAction: () => void;
  redoAction: () => void;
};

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


export interface MeshErrorContext {
  path: string;
  error: any;
}

export type MeshPath = string | number | symbol;

// export interface MeshBucket<P> {
//   evaluate: (context: any) => Promise<any> | any;
//   [key: string]: any;
// }
export type MeshNodeProxy<Node, V, NM, Extra = {}> = Extra & V & Node & NM;

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
  nodeBucket: Record<keyof NM, number>;
  notifyKeys: Set<keyof NM>;
  // --- 响应式信号 ---
  // 用于通知 UI 组件重绘 (对应 Vue Ref 或 React State)
  dirtySignal: any;

  proxy: MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM>;

  calledBy:TriggerCause

  meta: NM; //存放业务元数据
  dependOn: (cb: (val: V) => V, key?: keyof NM) => void;
  createView: <E extends Record<string, any> = {}>(extraProps?: E) => MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM, E>;
}

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

export interface StandardUITrigger<T> {
    signalCreator: () => T;
    signalTrigger: (signal: T) => void;
}

export interface DependOnContext<P extends MeshPath> {
  path: P;
  getNode: (path: P) => MeshFlowTaskNode<P>;
  // 你可以根据需要扩展，比如 getValue, emit 等
}

export interface logicApi<TKeys extends MeshPath> {
  slot: {
    triggerTargets: Array<Record<TKeys | InternalKeys , any>>;
    affectedTatget: any;
  };
}

export type InternalKeys = 'path'|'uid'|'type'|'meta'|'state'
 
export interface SetRuleOptions<NM, TKeys extends KeysOfUnion<NM>> {
  value?: any;
  priority?: number;
  forceNotify?: boolean;
  logic: (api: logicApi<TKeys>) => any;
  effect?: (args: any) => any;
  effectArgs?: Array<KeysOfUnion<NM>>;
  cacheStrategy?: "none" | "shallow";
  triggerKeys?: Array<TKeys| Exclude<InternalKeys,'state'> >;
}

 
export type EntangleOp = "add" | "intersect" | "union" | "merge" | "remove";

export interface GhostProposalApi<T> {
  // 直接覆盖值 (对应原来的 value 和 weight)
  set: (key: string, value: any, weight?: number) => void;
  // 增量修改 (对应原来的 delta 和 op)
  update: (key: string, delta: any, op?: EntangleOp) => void;
  // 函数式补丁 (对应原来的 patch)
  patch: (key: string, patchFn: (oldState: T) => T) => void;
}
  
// 投射出的幽灵建议 (Ghost Proposal)
export type EntangleGhost<T=any> = {
  key: string;      // 要改变目标节点的哪个属性 (如 'disabled', 'value')
  value?: any;         // 建议的值
  delta?: number | any;
  weight?: number;  // 权重 (默认 1)
  op?: EntangleOp;
  patch?:(oldState:T)=>T
};

// 纠缠配置参数
export type EntangleArgType<P extends MeshPath,IsProxy extends boolean = boolean> = {
  cause:P;
  impact:P;
  via:string[];
  isProxy?: IsProxy;
  filter?: (
    cause: IsProxy extends true ? any : MeshFlowTaskNode<P>, 
    impact: IsProxy extends true ? any : MeshFlowTaskNode<P>
  ) => boolean;
  
  emit:<T>(
    cause: IsProxy extends true ? any : MeshFlowTaskNode<P>, 
    impact: IsProxy extends true ? any : MeshFlowTaskNode<P>,
    propose:GhostProposalApi<T>) => void | EntangleGhost<T> | undefined | Promise<void | EntangleGhost<T> | undefined>; // 预言推演逻辑
};
 
export const enum TriggerCause {
  CAUSALITY = 0,   // 因果推导（正常）
  INVERSION = 1,   // 逆转回跳（纠缠）
  REPERCUSSION = 2  // 连锁：由逆转回跳引发的因果推导
}

export const enum NodeStatus {
  NONE    = 0,
  READY   = 1 << 0, // 1 
  STAGING = 1 << 1, // 2
  RESURE  = 1 << 2, // 4
  DIRTY   = 1 << 3, // 8 (备用：标记节点是否需要重算)
  PROCESSED  = 1 << 4, // 16  替代 processed 数组
  PROCESSING = 1 << 5, // 32  替代 processingSet 数组
}

export const enum MeshError {
  cycle = "Circular dependency detected",
  EngineNotFound = "Engine not found.",
  EngineIdRepeated = "engineID repeated",
  WrongId = "Wrong id"
}