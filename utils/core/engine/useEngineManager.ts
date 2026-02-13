 
 
import { MeshFlowHistory,MeshFlowEngineMap, MeshPath } from "../types/types";
import { InferLeafPath } from "../utils/util";
import { useFlowScheduler } from "./useEngineInstance";
 
 
type SchedulerType<T, P extends MeshPath> = ReturnType<typeof useFlowScheduler<T, P>>;

type GetType<T, P> = P extends keyof T ? T[P] : never;

type BaseEngine<T> = {
  data: {
    [K in "schema" | "GetFormData" | "AddNewSchema" | 'SetValue' | 'GetValue' | 'GetGroupByPath']: GetType<T, K>;
  };
  config: {
    [K in "SetRule" | "SetRules" | "SetStrategy" | "SetValidators" | "notifyAll" | "SetTrace" | "usePlugin"]: GetType<T, K>;
  };
  dependency: {
    [K in 'GetAllDependency' | 'GetDependencyOrder']: GetType<T, K>;
  };
  hooks: {
    [K in "onError" | "onSuccess" | "onStart"]: GetType<T, K>;
  };
};

type TransformKey<T> = T extends `use${infer Rest}` ? Uncapitalize<Rest> : T;

// 2. 映射类型
type EngineModules<M> = {
  // 遍历 M 的所有 key
  // 使用 as 语法重命名 key
  [K in keyof M as TransformKey<string & K>]: 
    // 提取函数返回值
    M[K] extends (...args: any) => infer R ? R : never;
};

type Engine<T,M> =  BaseEngine<T> & EngineModules<M>;



const engineMap = new Map<MeshPath,Engine<any,any>>()

/** @deprecated 请使用新的 useMeshFlow 别名 */
const useEngineManager = <
  const S extends Record<string, any>,
  T, //UITrigger的类型
  M extends Record<string, any> ,
  P extends MeshPath = [InferLeafPath<S>] extends [never] ?  MeshPath:InferLeafPath<S> | (string & {}),//path类型，作为任务的唯一性标志, 让leafpath宽松一些，支持动态路径
>(
  id:MeshPath,
  Schema:S, 
  options:{
    config?:{
      useGreedy:boolean
    },
    modules?:M,
    UITrigger:{
      signalCreateor:()=>T,
      signalTrigger:(signal:T)=>void
    }
  }
) => {
  try{
    if(typeof options.UITrigger.signalCreateor !== 'function' || typeof options.UITrigger.signalTrigger !== 'function'){
      throw Error('ui trigger undefined')
    }
    
    if(engineMap.has(id)){
      throw Error('engineID repeated');
    }
    const scheduler = useFlowScheduler<T, P>(
      Schema, 
      {
        config:options.config||{useGreedy:false},
        UITrigger:options.UITrigger,
        modules:(options.modules || {}),
        plugins:{}
      }
    );

    // type ConcreteScheduler = typeof scheduler;
    // type SchedulerType<T, P extends string> = ReturnType<typeof useFlowScheduler<T, P>>;
    
    const {
      schema,
      GetFormData,
      SetRule,
      SetRules,
      SetStrategy,
      SetValidators,
      SetValue,
      GetValue,
      usePlugin,

      GetGroupByPath,
      notifyAll,
      SetTrace,
      GetAllDependency,
      GetDependencyOrder,
      AddNewSchema,

      // Undo,
      // Redo,
      // initCanUndo,
      // initCanRedo,
      historyExports,

      onError,
      onSuccess,
      onStart
    } = scheduler;
  
    const baseEngine: BaseEngine<SchedulerType<T,P>> = {
      config: { SetRule, SetRules, SetStrategy, SetValidators, notifyAll, SetTrace, usePlugin },
      data: { schema, GetFormData, AddNewSchema, SetValue, GetValue, GetGroupByPath },
      dependency: { GetAllDependency, GetDependencyOrder },
      hooks: { onError, onSuccess, onStart }
    };
 
    const finalEngine: any = { ...baseEngine };
    const modules = options.modules;
    if (modules) {
      Object.keys(modules).forEach(key => {
          // 4.1 计算新的 key (e.g., useHistory -> history)
          let newKey = key;
          if (newKey.startsWith('use')) {
              const raw = newKey.slice(3);
              newKey = raw.charAt(0).toLowerCase() + raw.slice(1);
          }

          // 4.2 特殊处理 history
          // 因为你的 history 是 scheduler 内部生成的，而不是直接用 module 工厂函数的返回值
          // 所以这里做一个特判：如果是 history，用 scheduler 给出的 exports
          if (key === 'useHistory' && historyExports) {
               // 注意：只有当 historyExports 有内容时才挂载
               if (Object.keys(historyExports).length > 0) {
                   finalEngine[newKey] = historyExports;
               }
          } 
          // else {
          //      // 4.3 其他模块：直接执行工厂函数挂载
          //      // finalEngine.selection = options.modules.useSelection()
          //      finalEngine[newKey] = modules[key]();
          // }
      })
  }


    engineMap.set(id,finalEngine);

    return finalEngine as Engine<SchedulerType<T,P>, M>;
  }catch(error:any){
    throw Error(error)
  }
  
};

//传入客户定义的path类型，这样引擎就不会计算
const useMeshFlowDefiner = <P extends string>() => {
  // 返回一个被“柯里化”的 useMeshFlow，锁定了 P
  return <T, M extends Record<string, any>>(
    id: MeshPath, 
    schema: any, 
    options: {
        UITrigger: { signalCreateor: () => T, signalTrigger: (s: T) => void },
        modules?: M,
        config?: any
    }
  ) => {
    // 内部直接调用真正的 useMeshFlow，并利用类型断言
    return useMeshFlow(id, schema, options as any) as Engine<ReturnType<typeof useFlowScheduler<T, P>>, M>;
  }
}


// const useEngine = <T = any, P extends string = string,M extends Record<string, any> >(id:string|symbol) => {
//   if(engineMap.has(id)){
//     return engineMap.get(id)! as Engine<SchedulerType<T, P>,M>;
//   }
//   throw Error('id undefined')
// };

/**
 * 获取 Engine 实例
 * @template M 手动注入的模块映射 (例如 { useHistory: typeof useHistory })
 * @template K ID 类型 (支持 string | number | symbol)
 */
const useEngine = <
  M = never,
  K extends keyof MeshFlowEngineMap | (MeshPath & {}) = MeshPath
>(
  id: K
): [M] extends [never]
  ? (K extends keyof MeshFlowEngineMap ? MeshFlowEngineMap[K] : Engine<SchedulerType<any, any>, {}>)
  : Engine<SchedulerType<any, any>, M> => { // 🌟 核心：手动注入时，强制合并 BaseEngine
  
  const instance = engineMap.get(id);

  if (instance) {
    return instance as any;
  }

  throw Error(`[MeshFlow] Engine ID not found.`);
};


const deleteEngine = (id:MeshPath)=>{
  engineMap.delete(id);
}
const useMeshFlow = useEngineManager;

export { 
  useEngineManager,
  useMeshFlow, 
  useEngine ,
  deleteEngine,
  useMeshFlowDefiner,
  
};

export * from "../types/types";