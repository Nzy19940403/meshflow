export interface MeshEvents {
    'node:start': { path: MeshPath };
    'node:success': { path: MeshPath;};
    'node:bucket:success':{path:MeshPath,key:string,value:any}
 
    'node:error': { path: MeshPath; error: any };
    'node:intercept': { path: MeshPath;  type:number,detail?:any };
    'node:release': { path: MeshPath; type:number,detail?:any}
    'node:stagnate': { path: MeshPath;type:number }
    'node:processing': { path:MeshPath }
    'flow:wait':{type:number;detail?:any}
    'flow:fire': { path: MeshPath;type:number ; detail?:any };
    'flow:start':{path:MeshPath}
    'flow:success':{duration:string}
    'flow:end':{type:number}

    'node:pending':{path:MeshPath}

};

export type MeshEventName = keyof MeshEvents;

export type MeshEmit = <K extends MeshEventName>(
    event: K, 
    data: MeshEvents[K]
  ) => void;

export type HistoryActionItem = {
    undoAction:()=>void
    redoAction:()=>void
}

export type MeshFlowHistory = {
    Undo: () => void;
    Redo: () => void;
    initCanUndo: any; // 如果是 Vue 可以是 Ref<boolean>
    initCanRedo: any;
    PushIntoHistory:(action: HistoryActionItem, cleanRedo?: boolean) => void,
    CreateHistoryAction:(metadata: [
        { path: string; value: any; }, 
        { path: string; value: any; }
    ], cb: any) => {
        undoAction: () => any;
        redoAction: () => any;
    },
}

export interface MeshFlowEngineMap {}

export type MeshPath = string | number | symbol;

export interface MeshBucket<P> {
    evaluate: (context: any) => Promise<any> | any;
    [key: string]: any;
}

export interface MeshFlowTaskNode <
   
    P extends MeshPath = MeshPath,
    S = any,
    V = any,
> {
    path:P;
    uid:number;//内部id
    type:string;

    state:{
        value:V
    }

    buckets: Record<string, MeshBucket<P>>;
    notifyKeys:Set<keyof S>
    // --- 响应式信号 ---
    // 用于通知 UI 组件重绘 (对应 Vue Ref 或 React State)
    dirtySignal: any;


    meta:S; //存放业务元数据
    dependOn:(cb:(val:V)=>V)=>void
}

export interface MeshFlowGroupNode<P extends MeshPath = MeshPath> {
    path: P;
    uid: number;     // 依然需要 UID 做渲染 Key
    type: 'group';
    
    // 核心职责：持有子节点索引
    // 这里存子节点的 Path，渲染时去 Scheduler 或者是 GroupsMap 里找
    children: Array<P>;   
    
    meta:Record<string,any>; 
}

export interface DependOnContext<P extends MeshPath> {
    path: P;
    getNode: (path: P) => MeshFlowTaskNode<P> ;
    // 你可以根据需要扩展，比如 getValue, emit 等
}