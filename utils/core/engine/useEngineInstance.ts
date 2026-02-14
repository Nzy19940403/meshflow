import {
    FormFieldSchema,
    GroupField,
    RenderSchema,
    RenderSchemaFn,
    initFormData,
    useForm,
} from "../schema/schema";
import { useSetRule } from "../dependency/useSetRule";
import { useSetStrategy } from '../dependency/useStrategy';
import { useSchemaValidators } from "../schema/schema-validators";
import { useExecutionTrace } from "../plugins/useExecutionTrace";
import { useDependency, useCheckCycleInGraph } from "../dependency/useDepenency";
 
import { useOnError } from "../hooks/useOnError";
import { useOnSuccess } from "../hooks/useOnSuccess";
import { usePluginManager } from "../plugins/usePlugin";
import { useOnStart } from "../hooks/useOnStart";
import { MeshFlowHistory, MeshPath } from "./useEngineManager";

//入口函数,传入符合格式的json
export function useEngineInstance<T, P extends MeshPath>(
    data: any,
    options:{
        config: {
            useGreedy: boolean;
        },
        UITrigger: {
            signalCreateor: () => T;
            signalTrigger: (signal: T) => void;
        },
        modules:{
            useHistory?:()=>MeshFlowHistory
        },
        plugins:{}
    }
) {
    let isRulesChanged: boolean = false;
    let isCircleChecking: boolean = false;

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

    if(options.modules.useHistory){
        const {
            Undo,
            Redo,
            PushIntoHistory,
            CreateHistoryAction,
            initCanUndo,
            initCanRedo,
        } = options.modules.useHistory();

        historyInternalModule.pushIntoHistory = PushIntoHistory;
        historyInternalModule.createHistoryAction = CreateHistoryAction;

        historyExports = {
            Undo,
            Redo,
            initCanUndo,
            initCanRedo
        };

    }

    //钩子代码
    const { onError, callOnError } = useOnError();
    const { onSuccess, callOnSuccess } = useOnSuccess();

    const { onStart, callOnStart } = useOnStart<{ path: P }>();

    //插入插件管理
    const { emit, usePlugin } = usePluginManager();

    const { SetTrace, useTrace } = useExecutionTrace<P>();

    const cancelTrace = useTrace();
    usePlugin(cancelTrace);

    const {
        schema,
        GetFormData,
        GetRenderSchemaByPath,
        GetGroupByPath,
        notifyAll,
        convertToRenderSchema,
    } = useForm<T, P>(
        data,
        {
            useGreedy: options.config.useGreedy,
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
        options.UITrigger
    );

    const AddNewSchema = (path: string, data: any) => {
        let groupData = GetGroupByPath(path) as RenderSchemaFn<GroupField>;

        let newNode = convertToRenderSchema(data, path);

        groupData.children.push(newNode);
        groupData.dirtySignal.value++;
        return newNode;
    };

    const { SetRule, SetRules } = useSetRule<P>(
        GetRenderSchemaByPath,
        dependencyGraph,
        predecessorGraph
    );

    const { SetStrategy } = useSetStrategy(GetRenderSchemaByPath);

    const { SetValidators } = useSchemaValidators<P>(GetRenderSchemaByPath);

    const check = useCheckCycleInGraph<P>(dependencyGraph);

    //必须被调用，否则denpenencyorder没法更新
    const CheckCycleInGraph = () => {
        //计算是否有环的时候顺便让当前顺序被存储
        //这里对dependencyOrder重新赋值
        const res = check();
        dependencyOrder = res.steps;
        pathToLevelMap = res.levelMap;
    };

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

    const setRuleWrapper = (...args: Parameters<typeof SetRule>) => {
        SetRule.apply(null, args);
        isRulesChanged = true;

        requestGraphUpdate();
       
    };
    const setRulesWrapper = (...args: Parameters<typeof SetRules>) => {
        SetRules.apply(null, args);
        isRulesChanged = true;
        
        requestGraphUpdate();
    };

    const notifyAllWrapper = async () => {
        CheckCycleInGraph();
        await notifyAll();
        isReady = true;
    };

    const SetValue = (path: P, value: any) => {
        let node = GetRenderSchemaByPath(path);
        node.dependOn(() => {
            return value;
        });
    };

    const GetValue = (path: P, key = "value") => {
        const node = GetRenderSchemaByPath(path);
        return node[key as keyof typeof node];
    };

    return {
        schema,
        SetRule: setRuleWrapper,
        SetRules: setRulesWrapper,
        SetStrategy,
        SetValidators,
        SetTrace,
        usePlugin,
        // CheckCycleInGraph,

        SetValue, //设置节点的value
        GetValue,
        GetFormData,
        GetGroupByPath,
        notifyAll: notifyAllWrapper,
        AddNewSchema,

        GetAllDependency: () => dependencyGraph,
        GetDependencyOrder: () => dependencyOrder,

        // Undo,
        // Redo,
        // initCanUndo,
        // initCanRedo,
        historyExports,

        onError,
        onSuccess,
        onStart,
    };
}
