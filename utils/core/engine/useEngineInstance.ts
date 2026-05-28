
import { useSetRule } from "../dependency/useSetRule";
import { useSetStrategy } from '../dependency/useStrategy';
 
import { useDependency, useCheckCycleInGraph } from "../dependency/useDepenency";
 
import { useOnError } from "../hooks/useOnError";
import { useOnSuccess } from "../hooks/useOnSuccess";
import { usePluginManager } from "../plugins/usePlugin";
import { useOnStart } from "../hooks/useOnStart";
import { EntangleArgType, FullHistory, InternalMeshFlowHistory, MeshFlowHistory, MeshFlowTaskNode, MeshPath, SetRuleOptions, SuggestKey } from "../types/types";
import { useScheduler } from "./useScheduler";
 
 
type HistoryTool = {
    (getEngineCtx: () => {
        BN: (updates: any[],source:number) => void;
    }):FullHistory;
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
        _GetNextDependency,
        _GetPrevDependency,
        _GetAllPrevDependency,
        _GetAllNextDependency,
        _rebuildDirectDependencyMaps,
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
    
        // 定义严格的注入签名：只允许访问 _batchNotify
        let initHistoryFn: (getEngineCtx: () => {
            BN: (updates: any[],source:number) => void;
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
            // 💡 修复点：彻底移除 getNode 和 requestUpdate，只塞入 _batchNotify
            () => ({
                BN: (updates: any[],source:number) => _batchNotify(updates,source)
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
            _GetAllNextDependency,
            _GetNextDependency,
            _GetPrevDependency,
            _GetAllPrevDependency,
            _GetUidToLevelMap: () => uidToLevelMap,
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
        _batchNotify,
        _notifyAll,
        _useEntangle,
        _updateEntangleLevel,

        dispose:schedulerDispose,
        _stageValueFn,
 
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
        
   
        _updateEntangleLevel(); 
        
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
                const { _directNextMap, _directPrevMap } = _rebuildDirectDependencyMaps(
                    dependencyOrder.flat()
                );
                directChildDependencyGraph = _directNextMap;
                directParentDependencyGraph = _directPrevMap;
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
    options: SetRuleOptions<NM,TKeys,K>) => {
        SetRule(outDegreePath, inDegreePath, key as SuggestKey<NM> , options);
        isRulesChanged = true;
        
     
        requestGraphUpdate();
       
    };
    const setRulesWrapper = <TKeys extends SuggestKey<NM>,K extends SuggestKey<NM> | (string & {})>(
        outDegreePaths: P[],
        inDegreePath: P,
        key:K ,
        options: SetRuleOptions<NM,TKeys,K>
    ) => {
        SetRules(outDegreePaths, inDegreePath, key as SuggestKey<NM>, options);
        isRulesChanged = true;
        
        requestGraphUpdate();
        
    };

    const notifyAllWrapper = async () => {
        
        CheckCycleInGraph();
        await _notifyAll();
        // isReady = true;
    };

    const useEntangleWrapper = <State = any>(config: EntangleArgType<P,State,NM>)=>{
       
        _useEntangle(config);
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
        scheduler._batchNotify(updates);
    };

    const StageValue = (path: P,key:SuggestKey<NM>, value: any)=>{
    
        const node = GetNodeByPath(path);
        _stageValueFn(node.uid,key,value)
    }
    const customDispose = () => {
        // 第一步：销毁调度器内部数据
        schedulerDispose();

        // 第二步：物理清空当前闭包中的海量拓扑数据 (斩草除根)
        activeTopologyUids.clear();
        
        dependencyGraph.length = 0;
        _dependencyGraph.length = 0;
        
        predecessorGraph.length = 0;
        _predecessorGraph.length = 0;
        
        directChildDependencyGraph.length = 0;
        directParentDependencyGraph.length = 0;
        
        dependencyOrder.length = 0;
        uidToLevelMap.clear();

        // 第三步：销毁插件
        destroyPlugin();
    };
   

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
        dispose:customDispose,
        StageValue,
        SilentSet,

        SettleTasks
    };
 

    return instance  
}



 