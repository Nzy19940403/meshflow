 
 
import { useFlowScheduler } from "./useFlowScheduler";
 
 
type SchedulerType<T, P extends string> = ReturnType<typeof useFlowScheduler<T, P>>;

type GetType<T, P> = P extends keyof T ? T[P] : never;

type Engine<T> = {
  data: {
    [K in "schema" | "GetFormData" | "AddNewSchema"|'SetValue']: GetType<T, K>;
  };
  config: {
    [K in
      | "SetRule"
      | "SetRules"
      | "SetStrategy"
      | "SetValidators"
      | "notifyAll"
      | "SetTrace"]: GetType<T, K>;
  };
  dependency:{
    [K in 'GetAllDependency'|'GetDependencyOrder']:GetType<T,K>
  };
  history: {
    [K in "Undo" | "Redo" | "initCanUndo" | "initCanRedo"]: GetType<T, K>;
  };
  hooks:{
    [K in "onError"]: GetType<T, K>;
  }
};

const engineMap = new Map<string|symbol,Engine<any>>()

const useEngineManager = <T,P extends string>(id:string|symbol,Schema:any, UITrigger:{
  signalCreateor:()=>T,
  signalTrigger:(signal:T)=>void
}) => {
  try{
    if(typeof UITrigger.signalCreateor !== 'function' || typeof UITrigger.signalTrigger !== 'function'){
      throw Error('需要定义signal来通知ui')
    }
  
    if(engineMap.has(id)){
      throw Error('engineID重复，修改id或者使用symbol');
    }
    const scheduler = useFlowScheduler<T, P>(Schema, UITrigger);

    type ConcreteScheduler = typeof scheduler;
    const {
      schema,
      GetFormData,
      SetRule,
      SetRules,
      SetStrategy,
      SetValidators,
      SetValue,

      notifyAll,
      SetTrace,
      GetAllDependency,
      GetDependencyOrder,
      AddNewSchema,
      Undo,
      Redo,
      initCanUndo,
      initCanRedo,

      onError
    } = scheduler;
  
    let engine:Engine<ConcreteScheduler> = {
      config: {
        SetRule,
        SetRules,
        SetStrategy,
        SetValidators,
      
        notifyAll,
        SetTrace,
      },
      data: {
        schema,
        GetFormData,
        AddNewSchema,
        SetValue,
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
        onError
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
  throw Error('不存在的id')
};


const deleteEngine = (id:string|symbol)=>{
  engineMap.delete(id);
}

export { 
  useEngineManager,
  useEngineManager as useMeshFlow, 
  useEngine ,
  deleteEngine
};
