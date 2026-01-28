 
import { 
    useMeshFlow, 
    useEngine as useCoreEngine, 
    deleteEngine as deleteCoreEngine,
    type MeshPath,
    type Engine,
    type SchedulerType,
    type InferLeafPath,
    type InferLeafType,
  } from "@meshflow/core";
import { useInternalForm } from "./useForm";
import { useSchemaValidators } from "./schema/schema-validators";
 

/**
 * NM: NodeMeta 的类型定义
 * S: Schema 的结构类型
 * M: 外部扩展模块的类型
 */
export function useMeshForm<
const S extends Record<string, any>, 
  NM extends Record<string, any> = InferLeafType<S> , 
  M extends Record<string, any> = {}, 
  T = any,
  // 🌟 终极魔法：在这里像 Core 一样推导出表单的 Path
  P extends MeshPath  = [InferLeafPath<S>] extends [never] ? MeshPath : InferLeafPath<S> | (string & {})
>(
  id: string,
  schema: S,
  options: {
    UITrigger: {
      signalCreator: () => T;
      signalTrigger: (signal: T) => void;
    };
    modules?: M;
    config?: { useGreedy?: boolean };
    metaType?: NM 
  }
) {
 
  // 🌟 核心点：显式地将泛型传给 useMeshFlow
  // 这样能确保返回的 engine 里的 Path、Meta 和 Modules 类型全部正确
  const engine = useMeshFlow<
    S,  // 1. Schema 
    T,  // 2. Signal 类型 (ref/useState)
    M ,  // 3. Modules 类型合并
    NM  // 4. Meta 类型
  >(id, schema, {
    config: {
      useGreedy: options.config?.useGreedy ?? false,
    },
    UITrigger: options.UITrigger,

    // 类型探针
    metaType: options.metaType || {} as NM,

    modules: {
      internalModules:{
        useInternalForm,
        useSchemaValidators,
      },
      
      ...options.modules,
    } as any, // 这里的 as any 是为了绕过复杂的对象合并校验，泛型已经保证了外部拿到的类型是正确的
  });
 
  return engine as Engine<
    SchedulerType<T,P,S,M,NM>, 
    M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
      
    },
    P
  >;

}

export const useEngine = <
    M extends Record<string, any>  ,
    P extends MeshPath = MeshPath  , // 如果 Core 里叫 MeshPath，这里可以写成 extends MeshPath
    NM extends Record<string, any> = Record<string, any>
>(id:MeshPath)=>{
    const engine = useCoreEngine<
    M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
    },
    P,
    NM,
    any
    >(id) ;

    return engine as unknown as Engine<SchedulerType<any, P, any, M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
    }, NM>, M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
    }, P>; 
}

export const deleteEngine = (id:MeshPath)=>{
    deleteCoreEngine(id);
}

export * from "./schema/schema";