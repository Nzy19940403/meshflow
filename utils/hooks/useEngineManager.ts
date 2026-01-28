import { setupBusinessRules } from "@/src/formRules/FormRules";
import { useFlowScheduler } from "./useFlowScheduler";
 


type SchedulerInstance = ReturnType<typeof useFlowScheduler>;

type GetType<T, P> = P extends keyof T ? T[P] : never;

type Engine<T> = {
  data: {
    [K in "schema" | "GetFormData" | "AddNewSchema"]: GetType<T, K>;
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
};

const engineMap = new Map<string|symbol,Engine<SchedulerInstance>>()

const useEngineManager = <T>(id:string|symbol,Schema:any, UITrigger:{
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
  
    const {
      schema,
      GetFormData,
      SetRule,
      SetRules,
      SetStrategy,
      SetValidators,
    
      notifyAll,
      SetTrace,
      GetAllDependency,
      GetDependencyOrder,
      AddNewSchema,
      Undo,
      Redo,
      initCanUndo,
      initCanRedo,
    } = useFlowScheduler<T>(Schema,UITrigger);
  
    let engine:Engine<SchedulerInstance> = {
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
      }
    };
  
    engineMap.set(id,engine);
    return engine;
  }catch(error:any){
    throw Error(error)
  }
  
};

const useEngine = (id:string|symbol) => {
  if(engineMap.has(id)){
    return engineMap.get(id)!;
  }
  throw Error('不存在的id')
};


const deleteEngine = (id:string|symbol)=>{
  engineMap.delete(id);
}

export { useEngineManager, useEngine ,deleteEngine};
