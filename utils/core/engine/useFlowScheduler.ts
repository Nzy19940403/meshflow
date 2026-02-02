 

import { FormFieldSchema, GroupField, RenderSchema, RenderSchemaFn, initFormData, useForm } from "../schema/schema";
import { useSetRule, useSetStrategy } from "../schema/schema-rule";
import { useSchemaValidators } from "../schema/schema-validators";
import {useExecutionTrace} from '../plugins/useExecutionTrace';
import { useDependency,useCheckCycleInGraph } from "../schema/useDepenency";
import { useHistory } from "../plugins/useHistory";
import { useOnError } from "../hooks/useOnError";
import { useOnSuccess } from "../hooks/useOnSuccess";

//入口函数,传入符合格式的json
export function useFlowScheduler<T,P>(data:any,UITrigger:{
    signalCreateor:()=>T,
    signalTrigger:(signal:T)=>void
  }){
    let isRulesChanged:boolean = false;
    let isCircleChecking:boolean = false;

    const dependencyGraph = new Map<P, Set<P>>();

    const predecessorGraph = new Map<P, Set<P>>();

    let directChildDependencyGraph = new Map<P,Set<P>>();

    let directParentDependencyGraph = new Map<P,Set<P>>();
 
    let dependencyOrder:P[][] = []

    let pathToLevelMap:Map<P,number> = new Map()

    const {
        GetNextDependency,
        GetPrevDependency,
        GetAllPrevDependency,
        GetAllNextDependency,
        rebuildDirectDependencyMaps
    } = useDependency<P>(
        ()=>dependencyGraph,
        ()=>predecessorGraph,
        ()=>directParentDependencyGraph, //传入直接父路径map集合
        ()=>directChildDependencyGraph,//传入直接子路径map集合
    );

    const {
        SetTrace,
        pushExecution, 
        popExecution,
        markError
    } = useExecutionTrace<P>( GetNextDependency );
    
    const {
        Undo,
        Redo,
        PushIntoHistory,
        CreateHistoryAction,
        initCanUndo,
        initCanRedo
    } = useHistory();

    //钩子代码
    const {
        onError,
        callOnError
    } = useOnError();
    const {
        onSuccess,
        callOnSuccess
    } = useOnSuccess();

    const {schema,GetFormData,GetRenderSchemaByPath,GetGroupByPath,notifyAll,convertToRenderSchema} = useForm<T,P>(
        data,
        {
            GetDependencyOrder: ()=>dependencyOrder,
            GetAllNextDependency,
            GetNextDependency,
            GetPrevDependency,
            GetAllPrevDependency,
            GetPathToLevelMap:()=>pathToLevelMap
        },
        {
            pushExecution,
            popExecution,
            markError
        },
        {
            pushIntoHistory:PushIntoHistory,
            createHistoryAction:CreateHistoryAction
        },
        {
            callOnError,
            callOnSuccess
        },
        UITrigger
    );

    const AddNewSchema = (path:string,data:any)=>{
        let groupData = GetGroupByPath(path) as  RenderSchemaFn<GroupField>;
       
        let newNode = convertToRenderSchema(data, path);

        groupData.children.push(newNode);
        groupData.dirtySignal.value++;
        return newNode;
    }

    const { SetRule,SetRules } = useSetRule<P>(
        GetRenderSchemaByPath,
        dependencyGraph,
        predecessorGraph
    );

    const { SetStrategy } = useSetStrategy(GetRenderSchemaByPath)

    const { SetValidators } = useSchemaValidators<P>(GetRenderSchemaByPath)
     
    const check = useCheckCycleInGraph<P>(dependencyGraph);
    
     //必须被调用，否则denpenencyorder没法更新
     const CheckCycleInGraph = ()=>{
        //计算是否有环的时候顺便让当前顺序被存储
        //这里对dependencyOrder重新赋值
        const res = check();
        dependencyOrder = res.steps;
        pathToLevelMap = res.levelMap;
      
        

    }

    const setRuleWrapper = (...args:Parameters<typeof SetRule>)=>{
        
        SetRule.apply(null,args);
        isRulesChanged = true;

        if(isCircleChecking) return;
        new Promise<void>((resolve,reject)=>{
             
            isCircleChecking = true;
            resolve()
        })
        .then(
            ()=>{
                CheckCycleInGraph();
                if(isRulesChanged){
                    let { directNextMap, directPrevMap } = rebuildDirectDependencyMaps(dependencyOrder.flat());
                    directChildDependencyGraph = directNextMap;
                    directParentDependencyGraph = directPrevMap;
                }
            }
        ).finally(()=>{
            isCircleChecking = false;
            isRulesChanged = false;
        })
    };
    const setRulesWrapper = (...args:Parameters<typeof SetRules>)=>{
        SetRules.apply(null,args);
        isRulesChanged = true;
        if(isCircleChecking) return;
        new Promise<void>((resolve,reject)=>{
            isCircleChecking = true;
            resolve()
        })
        .then(
            ()=>{
                 
                CheckCycleInGraph();
                if(isRulesChanged){
                    let { directNextMap, directPrevMap } = rebuildDirectDependencyMaps(dependencyOrder.flat());
                    directChildDependencyGraph = directNextMap;
                    directParentDependencyGraph = directPrevMap;
                }
            }
        ).finally(()=>{
            isCircleChecking = false;
            isRulesChanged = false;
        })
    };

    const notifyAllWrapper = ()=>{
        CheckCycleInGraph();
        notifyAll()
    }

   const SetValue = (path:P,value:any)=>{
    let node = GetRenderSchemaByPath(path);
    node.dependOn(()=>{
        return value
    })
   }

    return {
        schema,
        SetRule:setRuleWrapper,
        SetRules:setRulesWrapper,
        SetStrategy,
        SetValidators,
        SetTrace,
        // CheckCycleInGraph,
        SetValue,
        GetFormData,
        notifyAll:notifyAllWrapper,  
        AddNewSchema,

        GetAllDependency:()=>dependencyGraph,
        GetDependencyOrder:()=>dependencyOrder,

        Undo,
        Redo,
        initCanUndo,
        initCanRedo,

        onError,
        onSuccess
    }  
}


