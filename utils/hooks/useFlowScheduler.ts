 
import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
import { FormFieldSchema, GroupField, RenderSchema, RenderSchemaFn, initFormData, useForm } from "../schema";
import { useSetRule, useSetStrategy } from "../schema-rule";
import { useSchemaValidators } from "../schema-validators";
import {useExecutionTrace} from './useExecutionTrace';
import { useDependency,useCheckCycleInGraph } from "./useDepenency";
import { useHistory } from "./useHistory";

//入口函数,传入符合格式的json
export function useFlowScheduler<T>(data:any,UITrigger:{
    signalCreateor:()=>T,
    signalTrigger:(signal:T)=>void
  }){
    let isRulesChanged:boolean = false;
    let isCircleChecking:boolean = false;

    const dependencyGraph = new Map<AllPath, Set<AllPath>>();

    const predecessorGraph = new Map<AllPath, Set<AllPath>>();

    let directChildDependencyGraph = new Map<AllPath,Set<AllPath>>();

    let directParentDependencyGraph = new Map<AllPath,Set<AllPath>>();
 
    let dependencyOrder:AllPath[][] = []

    let pathToLevelMap:Map<AllPath,number> = new Map()

    const {
        GetNextDependency,
        GetPrevDependency,
        GetAllPrevDependency,
        GetAllNextDependency,
        rebuildDirectDependencyMaps
    } = useDependency(
        ()=>dependencyGraph,
        ()=>predecessorGraph,
        ()=>directParentDependencyGraph, //传入直接父路径map集合
        ()=>directChildDependencyGraph,//传入直接子路径map集合
    );

    const {SetTrace,pushExecution, popExecution} = useExecutionTrace( GetNextDependency );
    
    const {
        Undo,
        Redo,
        PushIntoHistory,
        CreateHistoryAction,
        initCanUndo,
        initCanRedo
    } = useHistory()
    

    const {schema,GetFormData,GetRenderSchemaByPath,GetGroupByPath,notifyAll,convertToRenderSchema} = useForm(
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
            popExecution
        },
        {
            pushIntoHistory:PushIntoHistory,
            createHistoryAction:CreateHistoryAction
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

    const { SetRule,SetRules } = useSetRule(
        GetRenderSchemaByPath,
        dependencyGraph,
        predecessorGraph
    );

    const { SetStrategy } = useSetStrategy(GetRenderSchemaByPath)

    const { SetValidators } = useSchemaValidators(GetRenderSchemaByPath)
     
    const check = useCheckCycleInGraph(dependencyGraph);

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

   

    return {
        schema,
        SetRule:setRuleWrapper,
        SetRules:setRulesWrapper,
        SetStrategy,
        SetValidators,
        SetTrace,
        // CheckCycleInGraph,

        GetFormData,
        notifyAll:notifyAllWrapper,  
        AddNewSchema,

        GetAllDependency:()=>dependencyGraph,
        GetDependencyOrder:()=>dependencyOrder,

        Undo,
        Redo,
        initCanUndo,
        initCanRedo
    }  
}


