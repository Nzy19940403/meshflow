import { SchemaBucket } from "../engine/bucket";
import { KeysOfUnion } from "../utils/util";

export interface BaseMeshEvents {
  "flow:start": { path: MeshPath,token:symbol };

  "node:start": { path: MeshPath,calledBy:number };
  "node:success": { path: MeshPath,calledBy:number };
  "node:processing": { path: MeshPath,calledBy:number };

  "node:error": { path: MeshPath; error: any };
  "node:intercept": { path: MeshPath; type: number; detail?: any };
  "node:release": { path: MeshPath; type: number; detail?: any };
  "node:stagnate": { path: MeshPath; type: number };
  

  "node:pending": { path: MeshPath };

  "flow:wait": { type: number; detail?: any };

  

  "flow:fire": { path: MeshPath; type: number; detail?: any };

  "node:bucket:success": { path: MeshPath; key: string; value: any,calledBy:number };

  'entangle:warn': { path: string; type: 'no_keys' | 'no_level' };
  'entangle:blocked': { observer: string; target: string; count: number };
}

export interface MeshEvents extends BaseMeshEvents {
//   "node:start": { path: MeshPath };
//   "node:success": { path: MeshPath };
//   "node:pending": { path: MeshPath };
//   "node:error": { path: MeshPath; error: any };
//   "node:intercept": { path: MeshPath; type: number; detail?: any };
//   "node:release": { path: MeshPath; type: number; detail?: any };
//   "node:stagnate": { path: MeshPath; type: number };
//   "node:processing": { path: MeshPath };
//   "flow:wait": { type: number; detail?: any };
//   "flow:fire": { path: MeshPath; type: number; detail?: any };
//   "flow:start": { path: MeshPath };

  "flow:success": { duration: string,token:symbol };
  "flow:end": { type: number };
  "flow:abort": {  token:symbol };

  //逆转未来时候的事件
  "node:revive":{path: MeshPath; triggerPath: MeshPath;}
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
    triggerTargets: Array<Record<TKeys , any>>;
    affectedTatget: any;
  };
}

 

export interface SetRuleOptions<NM, TKeys extends KeysOfUnion<NM>> {
  value?: any;
  priority?: number;
  forceNotify?: boolean;
  logic: (api: logicApi<TKeys>) => any;
  effect?: (args: any) => any;
  effectArgs?: Array<KeysOfUnion<NM>>;
  cacheStrategy?: "none" | "shallow";
  triggerKeys?: Array<TKeys>;
}

 
  
// 投射出的幽灵建议 (Ghost Proposal)
export type EntangleGhost<T=any> = {
  key: string;      // 要改变目标节点的哪个属性 (如 'disabled', 'value')
  value?: any;         // 建议的值
  delta?: number | any;
  weight?: number;  // 权重 (默认 1)
  op?: "add" | "intersect" | "union" | "merge" | "remove";
  patch?:(oldState:T)=>T
};

// 纠缠配置参数
export type EntangleArgType<P extends MeshPath> = {
  observer: P;      // 观测者 (谁引发了纠缠)
  target: P;        // 目标 (受影响的节点)
  triggerKeys: string[]; // (可选) 观测者的哪些属性变动才触发预言
  filter?: (obs: any, tgt: any) => boolean;
  emit: (
    observerState: any, 
    currentState: any
  ) => void | EntangleGhost | undefined 
      | Promise<void | EntangleGhost | undefined>; // 预言推演逻辑
};
 
export enum TriggerCause {
  CAUSALITY = 0,   // 因果推导（正常）
  INVERSION = 1,   // 逆转回跳（纠缠）
  REPERCUSSION = 2  // 连锁：由逆转回跳引发的因果推导
}