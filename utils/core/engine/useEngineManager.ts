 
 
import { useFlowScheduler } from "./useFlowScheduler";
 
 
type SchedulerType<T, P extends string> = ReturnType<typeof useFlowScheduler<T, P>>;

type GetType<T, P> = P extends keyof T ? T[P] : never;

type Engine<T> = {
  data: {
    [K in "schema" | "GetFormData" | "AddNewSchema"|'SetValue'|'GetValue'|'GetGroupByPath']: GetType<T, K>;
  };
  config: {
    [K in
      | "SetRule"
      | "SetRules"
      | "SetStrategy"
      | "SetValidators"
      | "notifyAll"
      | "SetTrace"
      | "usePlugin" ]: GetType<T, K>;
  };
  dependency:{
    [K in 'GetAllDependency'|'GetDependencyOrder']:GetType<T,K>
  };
  history: {
    [K in "Undo" | "Redo" | "initCanUndo" | "initCanRedo"]: GetType<T, K>;
  };
  hooks:{
    [K in "onError"|"onSuccess"|"onStart"]: GetType<T, K>;
  }
};

const engineMap = new Map<string|symbol,Engine<any>>()

/** @deprecated 请使用新的 useMeshFlow 别名 */
const useEngineManager = <T,P extends string>(id:string|symbol,Schema:any, options:{
  config?:{
    useGreedy:boolean
  },
  UITrigger:{
    signalCreateor:()=>T,
    signalTrigger:(signal:T)=>void
  }
}) => {
  try{
    if(typeof options.UITrigger.signalCreateor !== 'function' || typeof options.UITrigger.signalTrigger !== 'function'){
      throw Error('ui trigger undefined')
    }
    
    if(engineMap.has(id)){
      throw Error('engineID repeated');
    }
    const scheduler = useFlowScheduler<T, P>(
      Schema, 
      options.config||{useGreedy:false},
      options.UITrigger
    );

    type ConcreteScheduler = typeof scheduler;
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
      Undo,
      Redo,
      initCanUndo,
      initCanRedo,

      onError,
      onSuccess,
      onStart
    } = scheduler;
  
    let engine:Engine<ConcreteScheduler> = {
      config: {
        SetRule,
        SetRules,
        SetStrategy,
        SetValidators,
      
        notifyAll,
        SetTrace,

        usePlugin,
      },
      data: {
        schema,
        GetFormData,
        AddNewSchema,
        SetValue,
        GetValue,
        GetGroupByPath,
      },
      history: {
        Undo,
        Redo,
        initCanUndo,
        initCanRedo,
      },
      dependency:{
        GetAllDependency,
        GetDependencyOrder
      },
      hooks:{
        onError,
        onSuccess,
        onStart
      }
    };
  
    engineMap.set(id,engine);
    return engine;
  }catch(error:any){
    throw Error(error)
  }
  
};

const useEngine = <T = any, P extends string = string>(id:string|symbol) => {
  if(engineMap.has(id)){
    return engineMap.get(id)! as Engine<SchedulerType<T, P>>;
  }
  throw Error('id undefined')
};


const deleteEngine = (id:string|symbol)=>{
  engineMap.delete(id);
}
const useMeshFlow = useEngineManager;

export { 
  useEngineManager,
  useMeshFlow, 
  useEngine ,
  deleteEngine
};
