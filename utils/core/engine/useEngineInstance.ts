
import { useSetRule } from "../dependency/useSetRule";
import { useSetStrategy } from '../dependency/useStrategy';
 

import { useExecutionTrace } from "../plugins/useExecutionTrace";
import { useDependency, useCheckCycleInGraph } from "../dependency/useDepenency";
 
import { useOnError } from "../hooks/useOnError";
import { useOnSuccess } from "../hooks/useOnSuccess";
import { usePluginManager } from "../plugins/usePlugin";
import { useOnStart } from "../hooks/useOnStart";
import { EntangleArgType, MeshFlowHistory, MeshFlowTaskNode, MeshPath, SetRuleOptions } from "../types/types";
import { useScheduler } from "./useScheduler";
import { KeysOfUnion } from "../utils/util";
 
 

type HistoryFactory = {
    (maxStep?: number): ()=>MeshFlowHistory;
    isMeshModuleInited: boolean;
} 
type HistoryTool ={
    (): MeshFlowHistory;
    isMeshModuleInited: boolean;
}
 

/**
 * 🌟 入口函数
 * @template T - UI 信号类型 (Signal)
 * @template P - 路径联合类型 ("user.name" | "user.age") 也支持number或者symbol
 * @template S - 业务元数据类型 (默认使用表单的 Meta，但也允许传入 any)
 */
export function useEngineInstance<T, P extends MeshPath,S = any,M extends Record<string, any> = {},NM = any>(
    data:S,
    options:{
        config: { useGreedy: boolean;useEntangleStep?:number },
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

    const dependencyGraph = new Map<P, Set<P>>();

    const predecessorGraph = new Map<P, Set<P>>();

    let directChildDependencyGraph = new Map<P, Set<P>>();

    let directParentDependencyGraph = new Map<P, Set<P>>();

    let dependencyOrder: P[][] = [];

    let pathToLevelMap: Map<P, number> = new Map();

    let isReady: boolean = false;

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
        () => directChildDependencyGraph //传入直接子路径map集合
    );

    const historyInternalModule: {
        pushIntoHistory?: MeshFlowHistory['PushIntoHistory'];
        createHistoryAction?: MeshFlowHistory['CreateHistoryAction'];
    } = {};
    let historyExports:Partial<Exclude<MeshFlowHistory,'pushIntoHistory'|'createHistoryAction'>> = {}
   
    if (options.modules.useHistory) {
        
        const historyFactory = options.modules.useHistory;
        let historyApi: ()=>MeshFlowHistory;

        // 核心逻辑：检测是否已经手动初始化
        if (historyFactory.isMeshModuleInited) {
            // 已初始化：无参调用获取当前实例
            historyApi = (historyFactory as HistoryTool); 
        } else {
            // 未初始化：由引擎以默认 100 步进行初始化
            historyApi = (historyFactory as HistoryFactory)() ; 
        }
 
        const {
            Undo,
            Redo,
            PushIntoHistory,
            CreateHistoryAction,
            updateUndoSize,
            updateRedoSize,
        } = historyApi();

        // 内部调度使用
        historyInternalModule.pushIntoHistory = PushIntoHistory;
        historyInternalModule.createHistoryAction = CreateHistoryAction;
     
        // 外部 UI 使用
        historyExports = {
            Undo,
            Redo,
            updateUndoSize,
            updateRedoSize
        };
    }

    const isRenderGateRegistered:boolean = !!options.modules.useMeshRenderGate
  
    type RenderGateFactory = <PathType, NodeType>(
        getResolver: () => (path: PathType) => NodeType
    ) => {
        init:any
    }

    let batchRenderExport = {} as ReturnType<RenderGateFactory>;

    if(isRenderGateRegistered){
        const isRenderGateInited:boolean = options.modules.useMeshRenderGate.isMeshModuleInited;
        ;

        const rawModule = options.modules.useMeshRenderGate;
        const initFn = (isRenderGateInited ? rawModule : rawModule()) as RenderGateFactory;

        batchRenderExport = initFn<P, MeshFlowTaskNode<P, any, NM>>(() => GetNodeByPath);
    }

   

    //钩子代码
    const { onError, callOnError } = useOnError();
    const { onSuccess, callOnSuccess } = useOnSuccess();

    const { onStart, callOnStart } = useOnStart<{ path: P }>();

    //插入插件管理
    const { emit, usePlugin,destroyPlugin } = usePluginManager();

    const { SetTrace, useTrace } = useExecutionTrace<P>();

    const Trace = useTrace();
    usePlugin(Trace);
 
    const uiTriggerFn = (isRenderGateRegistered
        ? { ...batchRenderExport }
        : { ...options.UITrigger }
    ) as any;

   

    // 🌟 2. 提前实例化旋转门，传入代理函数
   

    const scheduler = useScheduler<T,P,typeof uiTriggerFn,NM>(
        // data,
        {
            useGreedy: options.config.useGreedy,
            useEntangleStep:options.config.useEntangleStep||100
        },
        {
            GetDependencyOrder: () => dependencyOrder,
            GetAllNextDependency,
            GetNextDependency,
            GetPrevDependency,
            GetAllPrevDependency,
            GetPathToLevelMap: () => pathToLevelMap,
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
        GetGroupByPath,
        GetNodeByPath,
        notifyAll,
        useEntangle,
        updateEntangleLevel
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
        dependencyGraph,
        predecessorGraph,
        // scheduler
    );

    const { SetStrategy } = useSetStrategy<P,NM>(GetNodeByPath);

    // const { SetValidators } = useSchemaValidators<P>(GetNodeByPath);

    const check = useCheckCycleInGraph<P>(dependencyGraph);

    //必须被调用，否则denpenencyorder没法更新
    const CheckCycleInGraph = () => {
        //计算是否有环的时候顺便让当前顺序被存储
        //这里对dependencyOrder重新赋值
        const res = check();
        dependencyOrder = res.steps;
        pathToLevelMap = res.levelMap;
        
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

    const setRuleWrapper = <TKeys extends KeysOfUnion<NM>>(
    outDegreePath: P, 
    inDegreePath: P, 
    key: KeysOfUnion<NM> | (string & {})  , 
    options: SetRuleOptions<NM,TKeys>) => {
        SetRule(outDegreePath, inDegreePath, key as KeysOfUnion<NM> , options);
        isRulesChanged = true;
        
     
        requestGraphUpdate();
       
    };
    const setRulesWrapper = <TKeys extends KeysOfUnion<NM>>(
        outDegreePaths: P[],
        inDegreePath: P,
        key: KeysOfUnion<NM> | (string & {})  ,
        options: SetRuleOptions<NM,TKeys>
    ) => {
        SetRules(outDegreePaths, inDegreePath, key as KeysOfUnion<NM>, options);
        isRulesChanged = true;
        
        requestGraphUpdate();
        
    };

    const notifyAllWrapper = async () => {
     
        CheckCycleInGraph();
        await notifyAll();
        isReady = true;
    };

    const useEntangleWrapper = (config: EntangleArgType<P>)=>{
       
        useEntangle(config);
        isEntangleDirty = true;

        requestEntangleLevelUpdate();

    }

    const SetValue = (path: P,key: KeysOfUnion<NM> | (string & {}), value: any) => {
        forceSyncEngineState()
        let node = GetNodeByPath(path);
      
        node.dependOn(() => {
            return value;
        },key as KeysOfUnion<NM>);
    };

    const GetValue = (path: P, key = "value") => {
        const node = GetNodeByPath(path).proxy;
        
        return node[key as keyof typeof node];
    };

    const SetValues = (updates: { path: P, key: KeysOfUnion<NM> | (string & {}), value: any }[]) => {
        forceSyncEngineState();
        // 直接调用 scheduler 暴露出来的 batchUpdate
        scheduler.batchNotify(updates);
    };

  
   

    const instance = {
      
        
        SetRule: setRuleWrapper,
        SetRules: setRulesWrapper,
        SetStrategy,
 
        useEntangle:useEntangleWrapper,

        SetTrace,
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

        destroyPlugin
    };
 

    return instance  
}
