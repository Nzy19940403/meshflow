
import { useSetRule } from "../dependency/useSetRule";
import { useSetStrategy } from '../dependency/useStrategy';
 
import { useDependency, useCheckCycleInGraph } from "../dependency/useDepenency";
 
import { useOnError } from "../hooks/useOnError";
import { useOnSuccess } from "../hooks/useOnSuccess";
import { usePluginManager } from "../plugins/usePlugin";
import { useOnStart } from "../hooks/useOnStart";
import { EntangleArgType, FullHistory, InternalMeshFlowHistory, MeshFlowHistory, MeshFlowTaskNode, MeshPath, SetRuleOptions, SuggestKey } from "../types/types";
import { useScheduler } from "./useScheduler";
 
 
 

// type HistoryFactory = {
//     (maxStep?: number): ()=>MeshFlowHistory;
//     isMeshModuleInited: boolean;
// } 
// type HistoryTool ={
//     (): MeshFlowHistory;
//     isMeshModuleInited: boolean;
// }

type HistoryTool = {
    (getEngineCtx: () => {
        batchNotify: (updates: any[]) => void;
    }): FullHistory;
    isMeshModuleInited: boolean;
};
  
  // 🌟 历史模块的默认工厂函数（未初始化状态）
type HistoryFactory = {
    (maxStep?: number): HistoryTool; // 执行后返回 HistoryTool
    isMeshModuleInited: boolean;
};

/**
 * 🌟 入口函数
 * @template T - UI 信号类型 (Signal)
 * @template P - 路径联合类型 ("user.name" | "user.age") 也支持number或者symbol
 * @template S - 业务元数据类型 (默认使用表单的 Meta，但也允许传入 any)
 */
export function useEngineInstance<T, P extends MeshPath,S = any,M extends Record<string, any> = {},NM = any>(
    data:S,
    options:{
        config: { useGreedy: boolean;useEntangleStep?:number,NODE_QUOTA_PER_FRAME?:number },
        UITrigger?: {
            signalCreator: () => T;
            signalTrigger: (signal: T) => void;
        },
        modules:{
            useHistory?:HistoryFactory|HistoryTool,
            useInternalForm?:<T,P>(scheduler:any,data:any)=>any,
            useSchemaValidators?: <P>(Finder: (path: P) => any) => {
                SetValidators: (path: P, options: {
                    logic: (val: any, GetByPath: any) => any;
                    condition: (data: any) => boolean;
                }) => void;
            }
       
        } & M,
        plugins:{}
    }
) {
    let isRulesChanged: boolean = false;
    let isCircleChecking: boolean = false;
    let isEntangleDirty:boolean = false;
    let isEntangleChecking:boolean = false;

    // const dependencyGraph = new Map<P, Set<P>>();

    // const predecessorGraph = new Map<P, Set<P>>();

    // let directChildDependencyGraph = new Map<P, Set<P>>();

    // let directParentDependencyGraph = new Map<P, Set<P>>();

    // let dependencyOrder: P[][] = [];

    //这是所有使用setrule建立过依赖关系的节点集合，用uid作为map的key值，value是这个路径被建立了几次依赖
    const activeTopologyUids:Map<number,number> = new Map()

    const dependencyGraph:Array<Array<number>> = [];
    const _dependencyGraph:Array<Set<number>> = []; //初始化时候的影子依赖，等依赖关系稳定后就清除

    const predecessorGraph:Array<Array<number>> = [];
    const _predecessorGraph:Array<Set<number>> = [];// 影子依赖

    let directChildDependencyGraph:Array<Array<number>> = [];

    let directParentDependencyGraph:Array<Array<number>> = [];

    let dependencyOrder: number[][] = [];

    let uidToLevelMap: Map<number, number> = new Map();

    // let isReady: boolean = false;

    const {
        GetNextDependency,
        GetPrevDependency,
        GetAllPrevDependency,
        GetAllNextDependency,
        rebuildDirectDependencyMaps,
    } = useDependency<P>(
        () => dependencyGraph,
        () => predecessorGraph,
        () => directParentDependencyGraph, //传入直接父路径map集合
        () => directChildDependencyGraph, //传入直接子路径map集合

         
       
    );

    const historyInternalModule: InternalMeshFlowHistory = {} as any;

    // 2. 暴露给 UI 的 API (白名单模式)
    let historyExports: MeshFlowHistory = {} as MeshFlowHistory;
   
    if (options.modules.useHistory) {
        
        const historyFactory = options.modules.useHistory;
    
        // 定义严格的注入签名：只允许访问 batchNotify
        let initHistoryFn: (getEngineCtx: () => {
            batchNotify: (updates: any[]) => void;
        }) => FullHistory;

        // 核心逻辑：检测是否已经手动初始化
        if (historyFactory.isMeshModuleInited) {
            // 已初始化：比如用户传了 useHistory(50)
            initHistoryFn = historyFactory as HistoryTool;; 
        } else {
            // 未初始化：用户直接传了 useHistory，由引擎以默认 100 步进行初始化
            initHistoryFn = (historyFactory as HistoryFactory)(); 
        }
 
        // 🌟 核心大换血：执行依赖注入！
        const {
            Undo,
            Redo,
            StartTransaction,
            CommitTransaction,
            RecordMutation,
            GetCurrentVersion,
            RecordSilentMutation,
            updateUndoSize,
            updateRedoSize,
        } = initHistoryFn(
            // 💡 修复点：彻底移除 getNode 和 requestUpdate，只塞入 batchNotify
            () => ({
                batchNotify: (updates: any[]) => batchNotify(updates)
            })
        );

        // 内部调度使用
        historyInternalModule.StartTransaction = StartTransaction;
        historyInternalModule.CommitTransaction = CommitTransaction;
        historyInternalModule.RecordMutation = RecordMutation;
        historyInternalModule.GetCurrentVersion = GetCurrentVersion
        historyInternalModule.RecordSilentMutation = RecordSilentMutation
        // 外部 UI 使用
        historyExports = {
            Undo,
            Redo,
            updateUndoSize,
            updateRedoSize
        };
    }

    const isRenderGateRegistered:boolean = !!options.modules.useMeshRenderGate
  
    type RenderGateFactory = <NodeType>(
        getResolver: () => (uid: number) => NodeType
    ) => {
        init:any
    }

    let batchRenderExport = {} as ReturnType<RenderGateFactory>;

    if(isRenderGateRegistered){
        const isRenderGateInited:boolean = options.modules.useMeshRenderGate.isMeshModuleInited;
        ;

        const rawModule = options.modules.useMeshRenderGate;
        const initFn = (isRenderGateInited ? rawModule : rawModule()) as RenderGateFactory;

        batchRenderExport = initFn<MeshFlowTaskNode<P, any, NM>>(() => GetNodeByUid);
    }

   

    //钩子代码
    const { onError, callOnError } = useOnError();
    const { onSuccess, callOnSuccess } = useOnSuccess();

    const { onStart, callOnStart } = useOnStart<{ path: P }>();

    //插入插件管理
    const { emit, usePlugin,destroyPlugin } = usePluginManager();
 
    const uiTriggerFn = (isRenderGateRegistered
        ? { ...batchRenderExport }
        : { ...options.UITrigger }
    ) as any;

   

    // 🌟 2. 提前实例化旋转门，传入代理函数
   

    const scheduler = useScheduler<T,P,typeof uiTriggerFn,NM>(
        // data,
        {
            useGreedy: options.config.useGreedy,
            useEntangleStep:options.config.useEntangleStep||100,
            NODE_QUOTA_PER_FRAME:options.config.useEntangleStep||100
        },
        {
            GetDependencyOrder: () => dependencyOrder,
            GetAllNextDependency,
            GetNextDependency,
            GetPrevDependency,
            GetAllPrevDependency,
            GetUidToLevelMap: () => uidToLevelMap,
        },
        historyInternalModule,
        {
            callOnError,
            callOnSuccess,
            callOnStart,
            emit,
        },
        uiTriggerFn
    );

    const {
        SetBucket,
        GetBucket,
        GetGroupByPath,
        GetNodeByPath,
        GetNodeByUid,
        batchNotify,
        notifyAll,
        useEntangle,
        updateEntangleLevel,

        dispose,
        stageValueFn,
 
        SettleTasks,
        SilentSet,
    } = scheduler;

    if(isRenderGateRegistered){
       batchRenderExport.init(); 
    }
    

    let formExports = {};
    if(options.modules.useInternalForm){
         const {
            uiSchema,
            GetFormData
        } = options.modules.useInternalForm<T,P>(
            scheduler,
            data
        );

        formExports = {
            uiSchema,
            GetFormData
        }
    };
    // 🌟 初始化验证器导出
    let validatorExports: { 
        SetValidators?: (path: P, options: { logic: (val: any, GetByPath: any) => any, condition: (data: any) => boolean }) => void 
    } = {};
    if (options.modules.useSchemaValidators) {
        // 这里的 P 是 useEngineInstance 的 P，是精准的 AllPath
        const { SetValidators } = options.modules.useSchemaValidators<P>(GetNodeByPath);
        validatorExports = { SetValidators };
    }
 
    const { SetRule, SetRules } = useSetRule<P,NM>(
        GetNodeByPath,
        SetBucket,
        GetBucket,
        dependencyGraph,
        predecessorGraph,
        _dependencyGraph,
        _predecessorGraph,
        activeTopologyUids
    );

    const { SetStrategy } = useSetStrategy<P,NM>(GetNodeByPath,GetBucket);

 

    const check = useCheckCycleInGraph<P,NM>(dependencyGraph,activeTopologyUids);

    //必须被调用，否则denpenencyorder没法更新
    const CheckCycleInGraph = () => {
        //计算是否有环的时候顺便让当前顺序被存储
        //这里对dependencyOrder重新赋值
        const res = check();
        dependencyOrder = res.steps;
        uidToLevelMap = res.levelMap;
     
        //更新完levelmap之后需要去更新一下纠缠关系的level
        forceSyncEngineState();
    };

    const forceSyncEngineState = () => {
        if (!isEntangleDirty) return; // 没脏，0.00001ms 退出
        
   
        updateEntangleLevel(); 
        
        isEntangleDirty = false;
 
    }

    const requestEntangleLevelUpdate = ()=>{
       
        if(isEntangleChecking) return;
        isEntangleChecking = true
        
        Promise.resolve().then(forceSyncEngineState).finally(()=>{
            isEntangleChecking = false;
        });
    }

    const requestGraphUpdate = () => {
        // 如果已经在检查中，直接跳过，等待当前的微任务完成
        if (isCircleChecking) return;
    
        isCircleChecking = true;
        
        // 使用 Promise.resolve() 代替 new Promise，更简洁
        Promise.resolve().then(() => {
            // 1. 执行环检测
            CheckCycleInGraph();
    
            // 2. 如果规则确实变了，重建直连依赖图
            if (isRulesChanged) {
                const { directNextMap, directPrevMap } = rebuildDirectDependencyMaps(
                    dependencyOrder.flat()
                );
                directChildDependencyGraph = directNextMap;
                directParentDependencyGraph = directPrevMap;
            }
        }).finally(() => {
            // 重置状态
            isCircleChecking = false;
            isRulesChanged = false;
        });
    };

    const setRuleWrapper = <
    K extends SuggestKey<NM>, // 🌟 直接用这个最强王者
    TKeys extends SuggestKey<NM>  
    >(
    outDegreePath: P, 
    inDegreePath: P, 
    key: K  , 
    options: SetRuleOptions<NM,TKeys>) => {
        SetRule(outDegreePath, inDegreePath, key as SuggestKey<NM> , options);
        isRulesChanged = true;
        
     
        requestGraphUpdate();
       
    };
    const setRulesWrapper = <TKeys extends SuggestKey<NM>>(
        outDegreePaths: P[],
        inDegreePath: P,
        key: SuggestKey<NM> | (string & {})  ,
        options: SetRuleOptions<NM,TKeys>
    ) => {
        SetRules(outDegreePaths, inDegreePath, key as SuggestKey<NM>, options);
        isRulesChanged = true;
        
        requestGraphUpdate();
        
    };

    const notifyAllWrapper = async () => {
        
        CheckCycleInGraph();
        await notifyAll();
        // isReady = true;
    };

    const useEntangleWrapper = <State = any>(config: EntangleArgType<P,State,NM>)=>{
       
        useEntangle(config);
        isEntangleDirty = true;

        requestEntangleLevelUpdate();

    }

    const SetValue = (path: P,key:SuggestKey<NM>, value: any) => {
        forceSyncEngineState()
        let node = GetNodeByPath(path);
      
        node.dependOn(() => {
            return value;
        },key as SuggestKey<NM>);
    };

    const GetValue = (path: P, key:SuggestKey<NM> = "value") => {
        const node = GetNodeByPath(path).proxy;
        
        return node[key as keyof typeof node];
    };

    const SetValues = (updates: { path: P, key: SuggestKey<NM>, value: any }[]) => {
        forceSyncEngineState();
        // 直接调用 scheduler 暴露出来的 batchUpdate
        scheduler.batchNotify(updates);
    };

    const StageValue = (path: P,key:SuggestKey<NM>, value: any)=>{
    
        const node = GetNodeByPath(path);
        stageValueFn(node.uid,key,value)
    }
  
   

    const instance = {
      
        
        SetRule: setRuleWrapper,
        SetRules: setRulesWrapper,
        SetStrategy,
 
        useEntangle:useEntangleWrapper,

       
        usePlugin,
 

        SetValue, //设置节点的value
        GetValue,
        SetValues,
 

        GetGroupByPath,
        notifyAll: notifyAllWrapper,
        

        GetAllDependency: () => dependencyGraph,
        GetDependencyOrder: () => dependencyOrder,
 
        historyExports,
        formExports,
        validatorExports,
        batchRenderExport,
        hasRenderGate:()=>isRenderGateRegistered,

        onError,
        onSuccess,
        onStart,

        scheduler,

        destroyPlugin,
        dispose,
        StageValue,
        SilentSet,

        SettleTasks
    };
 

    return instance  
}



// import { useSetRule } from "../dependency/useSetRule";
// import { useSetStrategy } from '../dependency/useStrategy';
// import { useDependency, useCheckCycleInGraph } from "../dependency/useDepenency";
// import { useOnError } from "../hooks/useOnError";
// import { useOnSuccess } from "../hooks/useOnSuccess";
// import { usePluginManager } from "../plugins/usePlugin";
// import { useOnStart } from "../hooks/useOnStart";
// import { EntangleArgType, MeshFlowHistory, MeshFlowTaskNode, MeshPath, SetRuleOptions, SuggestKey } from "../types/types";
// import { useScheduler } from "./useScheduler";
// import { KeysOfUnion } from "../utils/util";

// // 类型定义保持不变...
// type HistoryFactory = { (maxStep?: number): () => MeshFlowHistory; isMeshModuleInited: boolean; }
// type HistoryTool = { (): MeshFlowHistory; isMeshModuleInited: boolean; }

// /**
//  * 🌟 将巨型闭包工厂重构为强类型 Class 引擎
//  */
// export class MeshEngine<T, P extends MeshPath, S = any, M extends Record<string, any> = {}, NM = any> {
//     public isRulesChanged: boolean = false;
//     public isCircleChecking: boolean = false;
//     public isEntangleDirty: boolean = false;
//     public isEntangleChecking: boolean = false;
//     public isReady: boolean = false;

//     // 🌟 将所有拓扑图数组提升为实例属性
//     public activeTopologyUids = new Map<number, number>();
//     public dependencyGraph: Array<Array<number>> = [];
//     public _dependencyGraph: Array<Set<number>> = [];
//     public predecessorGraph: Array<Array<number>> = [];
//     public _predecessorGraph: Array<Set<number>> = [];
//     public directChildDependencyGraph: Array<Array<number>> = [];
//     public directParentDependencyGraph: Array<Array<number>> = [];
//     public dependencyOrder: number[][] = [];
//     public uidToLevelMap: Map<number, number> = new Map();

//     public scheduler: any;
//     public historyExports: any = {};
//     public formExports: any = {};
//     public validatorExports: any = {};
//     public batchRenderExport: any = {};
    
//     // 钩子和插件
//     public onError: any;
//     public onSuccess: any;
//     public onStart: any;
//     public destroyPlugin: any;
//     public usePlugin: any;

//     private _rebuildDirectDependencyMaps: any;
//     private _checkCycle: any;

//     constructor(public data: S, public options: any) {
//         // 1. 初始化依赖管理
//         const { GetAllNextDependency, GetNextDependency, GetPrevDependency, GetAllPrevDependency, rebuildDirectDependencyMaps } = useDependency<P>(
//             () => this.dependencyGraph,
//             () => this.predecessorGraph,
//             () => this.directParentDependencyGraph,
//             () => this.directChildDependencyGraph
//         );
//         this._rebuildDirectDependencyMaps = rebuildDirectDependencyMaps;

//         // 2. 初始化历史记录
//         const historyInternalModule: any = {};
//         if (options.modules.useHistory) {
//             const historyFactory = options.modules.useHistory;
//             const historyApi = historyFactory.isMeshModuleInited ? (historyFactory as HistoryTool) : (historyFactory as HistoryFactory)();
//             const { Undo, Redo, PushIntoHistory, CreateHistoryAction, updateUndoSize, updateRedoSize } = historyApi();
//             historyInternalModule.pushIntoHistory = PushIntoHistory;
//             historyInternalModule.createHistoryAction = CreateHistoryAction;
//             this.historyExports = { Undo, Redo, updateUndoSize, updateRedoSize };
//         }

//         const isRenderGateRegistered = !!options.modules.useMeshRenderGate;
        
//         // 3. 钩子和插件
//         const { onError, callOnError } = useOnError();
//         const { onSuccess, callOnSuccess } = useOnSuccess();
//         const { onStart, callOnStart } = useOnStart<{ path: P }>();
//         const { emit, usePlugin, destroyPlugin } = usePluginManager();

//         this.onError = onError;
//         this.onSuccess = onSuccess;
//         this.onStart = onStart;
//         this.usePlugin = usePlugin;
//         this.destroyPlugin = destroyPlugin;

//         // 4. 初始化 Scheduler
//         const uiTriggerFn = (isRenderGateRegistered ? { ...this.batchRenderExport } : { ...options.UITrigger }) as any;
//         this.scheduler = useScheduler<T, P, typeof uiTriggerFn, NM>(
//             {
//                 useGreedy: options.config.useGreedy,
//                 useEntangleStep: options.config.useEntangleStep || 100,
//                 NODE_QUOTA_PER_FRAME: options.config.useEntangleStep || 100
//             },
//             {
//                 GetDependencyOrder: () => this.dependencyOrder,
//                 GetAllNextDependency, GetNextDependency, GetPrevDependency, GetAllPrevDependency,
//                 GetUidToLevelMap: () => this.uidToLevelMap,
//             },
//             historyInternalModule,
//             { callOnError, callOnSuccess, callOnStart, emit },
//             uiTriggerFn
//         );

//         // 5. 渲染门
//         if (isRenderGateRegistered) {
//             const rawModule = options.modules.useMeshRenderGate;
//             const initFn = (rawModule.isMeshModuleInited ? rawModule : rawModule());
//             this.batchRenderExport = initFn(() => this.scheduler.GetNodeByUid);
//             this.batchRenderExport.init();
//         }

//         // 6. 验证器和表单
//         if (options.modules.useInternalForm) {
//             const { uiSchema, GetFormData } = options.modules.useInternalForm(this.scheduler, data);
//             this.formExports = { uiSchema, GetFormData };
//         }
//         if (options.modules.useSchemaValidators) {
//             const { SetValidators } = options.modules.useSchemaValidators(this.scheduler.GetNodeByPath);
//             this.validatorExports = { SetValidators };
//         }

//         // 7. 初始化核心规则
//         const { SetRule, SetRules } = useSetRule<P, NM>(
//             this.scheduler.GetNodeByPath,
//             this.scheduler.SetBucket,
//             this.scheduler.GetBucket,
//             this.dependencyGraph,
//             this.predecessorGraph,
//             this._dependencyGraph,
//             this._predecessorGraph,
//             this.activeTopologyUids
//         );
//         this._rawSetRule = SetRule;
//         this._rawSetRules = SetRules;

//         const { SetStrategy } = useSetStrategy<P, NM>(this.scheduler.GetNodeByPath, this.scheduler.GetBucket);
//         this.SetStrategy = SetStrategy;

//         this._checkCycle = useCheckCycleInGraph<P, NM>(this.dependencyGraph, this.activeTopologyUids);
//     }

//     private _rawSetRule: any;
//     private _rawSetRules: any;
//     public SetStrategy: any;

//     // 🌟 将原本的 wrapper 函数定义为箭头函数属性，断开外部闭包
//     public CheckCycleInGraph = () => {
//         const res = this._checkCycle();
//         this.dependencyOrder = res.steps;
//         this.uidToLevelMap = res.levelMap;
//         this.forceSyncEngineState();
//     };

//     public forceSyncEngineState = () => {
//         if (!this.isEntangleDirty) return;
//         this.scheduler.updateEntangleLevel();
//         this.isEntangleDirty = false;
//     };

//     public requestEntangleLevelUpdate = () => {
//         if (this.isEntangleChecking) return;
//         this.isEntangleChecking = true;
//         Promise.resolve().then(this.forceSyncEngineState).finally(() => {
//             this.isEntangleChecking = false;
//         });
//     };

//     public requestGraphUpdate = () => {
//         if (this.isCircleChecking) return;
//         this.isCircleChecking = true;
//         Promise.resolve().then(() => {
//             this.CheckCycleInGraph();
//             if (this.isRulesChanged) {
//                 const { directNextMap, directPrevMap } = this._rebuildDirectDependencyMaps(this.dependencyOrder.flat());
//                 this.directChildDependencyGraph = directNextMap;
//                 this.directParentDependencyGraph = directPrevMap;
//             }
//         }).finally(() => {
//             this.isCircleChecking = false;
//             this.isRulesChanged = false;
//         });
//     };

//     public SetRule = <K extends SuggestKey<NM>, TKeys extends SuggestKey<NM> = SuggestKey<NM>>(outPath: P, inPath: P, key: K, options: SetRuleOptions<NM, TKeys>) => {
//         this._rawSetRule(outPath, inPath, key, options);
//         this.isRulesChanged = true;
//         this.requestGraphUpdate();
//     };

//     public SetRules = <TKeys extends KeysOfUnion<NM>>(outPaths: P[], inPath: P, key: KeysOfUnion<NM> | (string & {}), options: SetRuleOptions<NM, TKeys>) => {
//         this._rawSetRules(outPaths, inPath, key, options);
//         this.isRulesChanged = true;
//         this.requestGraphUpdate();
//     };

//     public notifyAll = async () => {
//         this.CheckCycleInGraph();
//         await this.scheduler.notifyAll();
//         this.isReady = true;
//     };

//     public useEntangle = <State = any>(config: EntangleArgType<P, State, NM>) => {
//         this.scheduler.useEntangle(config);
//         this.isEntangleDirty = true;
//         this.requestEntangleLevelUpdate();
//     };

//     public SetValue = (path: P, key: SuggestKey<NM>, value: any) => {
//         this.forceSyncEngineState();
//         let node = this.scheduler.GetNodeByPath(path);
//         node.dependOn(() => value, key);
//     };

//     public GetValue = (path: P, key = "value") => {
//         const node = this.scheduler.GetNodeByPath(path).proxy;
//         return node[key as keyof typeof node];
//     };

//     public SetValues = (updates: { path: P, key: SuggestKey<NM>, value: any }[]) => {
//         this.forceSyncEngineState();
//         this.scheduler.batchNotify(updates);
//     };

//     public StageValue = (path: P, key: SuggestKey<NM>, value: any) => {
//         const node = this.scheduler.GetNodeByPath(path);
//         this.scheduler.stageValueFn(node.uid, key, value);
//     };

//     public SilentSet = (path: P, key: SuggestKey<NM>, value: any) => {
//         const node = this.scheduler.GetNodeByPath(path);
//         if (!node) return false;
//         if (Object.is(node.state[key as string], value)) return false;
//         node.state[key as string] = value;
//         this.scheduler.refresTarget(node.uid);
//         return true;
//     };

//     public GetGroupByPath = (path: P) => this.scheduler.GetGroupByPath(path);
//     public CancelTask = () => this.scheduler.CancelTask();
//     public SettleTasks = () => this.scheduler.SettleTasks();
//     public hasRenderGate = () => !!this.options.modules.useMeshRenderGate;
    
//     // 🌟 这就是原本在快照里作乱的方法，现在变成了没有闭包的原型方法！
//     public GetAllDependency = () => this.dependencyGraph;
//     public GetDependencyOrder = () => this.dependencyOrder;
// }

// /**
//  * 暴露给外部的 Hook API，保持向下兼容
//  */
// export function useEngineInstance<T, P extends MeshPath, S = any, M extends Record<string, any> = {}, NM = any>(
//     data: S,
//     options: any
// ) {
//     return new MeshEngine<T, P, S, M, NM>(data, options);
// }