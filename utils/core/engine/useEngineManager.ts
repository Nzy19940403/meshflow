import {  MeshPath } from "../types/types";
import { InferLeafPath, InferLeafType } from "../utils/util";
import { useEngineInstance } from "./useEngineInstance";

export type SchedulerType<
  T,
  P extends MeshPath,
  S,
  M extends Record<string, any>,
  NM
> = ReturnType<typeof useEngineInstance<T, P, S, M, NM>>;

export type BaseEngine<T> = {
  data: {
    SetValue: T extends { SetValue: infer F } ? F : never;
    GetValue: T extends { GetValue: infer F } ? F : never;
    SetValues: T extends { SetValues: infer F } ? F : never;
    GetGroupByPath: T extends { GetGroupByPath: infer F } ? F : never;
  };
  config: {
    SetRule: T extends { SetRule: infer F } ? F : never;
    SetRules: T extends { SetRules: infer F } ? F : never;
    SetStrategy: T extends { SetStrategy: infer F } ? F : never;

    notifyAll: T extends { notifyAll: infer F } ? F : never;
    SetTrace: T extends { SetTrace: infer F } ? F : never;
    usePlugin: T extends { usePlugin: infer F } ? F : never;

    hasRenderGate: T extends { hasRenderGate: infer F } ? F : never;
    useEntangle: T extends { useEntangle: infer F } ? F : never;
  };
  dependency: {
    GetAllDependency: T extends { GetAllDependency: infer F } ? F : never;
    GetDependencyOrder: T extends { GetDependencyOrder: infer F } ? F : never;
  };
  hooks: {
    onError: T extends { onError: infer F } ? F : never;
    onSuccess: T extends { onSuccess: infer F } ? F : never;
    onStart: T extends { onStart: infer F } ? F : never;
  };
};
//如果是useMeshRenderGate模块，那就用render为key值包装，其余照旧
export type TransformModuleKey<T> = T extends "useMeshRenderGate"
  ? "render"
  : T extends `use${infer Rest}`
  ? Uncapitalize<Rest>
  : T;

export type MapModuleToReturn<K, F, P extends MeshPath> =
  // 如果是验证器，强行注入 P，并返回 SetValidators
  K extends "useSchemaValidators" | "schemaValidators"
    ? {
        SetValidators: (
          path: P,
          options: {
            logic: (val: any, GetByPath: (path: P) => any) => any;
            condition: (data: any) => boolean;
          }
        ) => void;
      }
    : K extends "useHistory" | "history" | "useMeshRenderGate" | "meshRenderGate"
    ? F extends (...args: any) => infer R
      ? R extends (...args: any) => infer R2
        ? R2
        : R // 👈 如果返回的是函数，再解一层；否则取 R
      : any
    : // 其他模块：走通用的 infer (比如自定义模块)
    F extends (...args: any) => infer R
    ? R
    : any;

// 🌟 2. 映射类型：带上 P 和 NM
export type EngineModules<M extends Record<string, any>, P extends MeshPath> = {
  [K in keyof M as TransformModuleKey<string & K>]: M[K] extends (
    ...args: any
  ) => any
    ? MapModuleToReturn<K, M[K], P> // 是模块函数？直接解包
    : M[K] extends Record<string, any>
    ? EngineModules<M[K], P> // 是对象？递归进去！
    : M[K];
};
export type Engine<
  T,
  M extends Record<string, any>,
  P extends MeshPath
> = BaseEngine<T> & {
  modules: EngineModules<M, P>;
};

const engineMap = new Map<MeshPath, any>();

/** @deprecated 请使用新的 useMeshFlow 别名 */
const useEngineManager = <
  const S extends Record<string, any> | any[],
  T, //UITrigger的类型
  M extends Record<string, any>,
  NM extends Record<string, any> = InferLeafType<S>,
  P extends MeshPath = [InferLeafPath<S>] extends [never]
    ? MeshPath
    : InferLeafPath<S> | (string & {}) //path类型，作为任务的唯一性标志, 让leafpath宽松一些，支持动态路径
>(
  id: MeshPath,
  Schema: S,
  options: {
    metaType?: NM;
    config?: {
      useGreedy: boolean;
      useEntangleStep?:number
    };
    modules?: M;
    UITrigger?: {
      signalCreator: () => T;
      signalTrigger: (signal: T) => void;
    };
  }
) => {
  try {
    // if (
    //   typeof options.UITrigger.signalCreator !== "function" ||
    //   typeof options.UITrigger.signalTrigger !== "function"
    // ) {
    //   throw Error("ui trigger undefined");
    // }

    if (engineMap.has(id)) {
      throw Error("engineID repeated");
    }

    const EngineInstance = useEngineInstance<T, P, S, M, NM>(Schema, {
      config: options.config || { useGreedy: false },
      UITrigger: options.UITrigger,
      modules: options.modules ?? ({} as M),
      plugins: {},
    });
  

    const {
      // schema,
      // GetFormData,

      SetRule,
      SetRules,
      SetValues,
      SetStrategy,

      SetValue,
      GetValue,
      usePlugin,

      useEntangle,

      GetGroupByPath,
      notifyAll,
      SetTrace,
      GetAllDependency,
      GetDependencyOrder,
      // AddNewSchema,

      // Undo,
      // Redo,
      // updateUndoSize,
      // updateRedoSize,
      historyExports,
      formExports,
      validatorExports,
      batchRenderExport,
      hasRenderGate,

      onError,
      onSuccess,
      onStart,

      scheduler,
      destroyPlugin
    } = EngineInstance;

    const baseEngine: BaseEngine<SchedulerType<T, P, S, M, NM>> = {
      config: {
        SetRule,
        SetRules,
        SetStrategy,
        notifyAll,
        SetTrace,
        usePlugin,
        hasRenderGate,
        useEntangle 
      },
      data: { SetValue, GetValue, SetValues, GetGroupByPath },
      dependency: { GetAllDependency, GetDependencyOrder },
      hooks: { onError, onSuccess, onStart },
    };

    // 递归挂载模块的工具函数
    const mountModules = (
      target: Record<string, any>, // 当前挂载的层级对象
      source: Record<string, any>, // 用户传入的 modules 结构
      context: {
        scheduler: any;
        Schema: any;
        exports: {
          history?: any;
          form?: any;
          validator?: any;
          render?: any;
        };
      }
    ) => {
      if (!source || typeof source !== "object") return;

      Object.keys(source).forEach((key) => {
        const item = source[key];

        // --- 情况 A：如果是对象，说明这是一个命名空间（比如 modules: { core: { ... } } ）---
        if (typeof item === "object" && item !== null) {
          // 保持原键名（如 'core'），创建一个空对象容器
          target[key] = target[key] || {};
          // 递归钻进去处理里面的模块
          mountModules(target[key], item, context);
        }
        // --- 情况 B：如果是函数，说明到了真正的模块层（比如 useHistory）---
        else if (typeof item === "function") {
          // 1. 转换 Key 名
          let newKey = key;
          if (newKey === "useMeshRenderGate") {
            newKey = "render";
          } else if (newKey.startsWith("use")) {
            const raw = newKey.slice(3);
            newKey = raw.charAt(0).toLowerCase() + raw.slice(1);
          }

          // 2. 根据模块名称，注入对应的实例
          if (
            key === "useHistory" &&
            context.exports.history &&
            Object.keys(context.exports.history).length > 0
          ) {
            target[newKey] = context.exports.history;
          } else if (
            key === "useInternalForm" &&
            context.exports.form &&
            Object.keys(context.exports.form).length > 0
          ) {
            target[newKey] = context.exports.form;
          } else if (
            key === "useSchemaValidators" &&
            context.exports.validator &&
            Object.keys(context.exports.validator).length > 0
          ) {
            target[newKey] = context.exports.validator;
          } else if (key === "useMeshRenderGate" && context.exports.render) {
            // 渲染网关特判注入
            target[newKey] = context.exports.render;
          } else {
            // 3. 自定义模块：直接执行工厂函数并传入上下文
            target[newKey] = item(context.scheduler, context.Schema);
          }
        }
      });
    };

    const finalEngine: any = {
      ...baseEngine,
      destroyPlugin,
      modules: {},
    };
    const modules = options.modules;

    // 🌟 替换点：使用递归函数一键挂载整个树形结构
    if (modules) {
      mountModules(finalEngine.modules, modules, {
        scheduler,
        Schema,
        exports: {
          history: historyExports,
          form: formExports,
          validator: validatorExports,
          render: batchRenderExport, // 将你的网关导出传递进去
        },
      });
    }
 
    engineMap.set(id, finalEngine);

    return finalEngine as Engine<SchedulerType<T, P, S, M, NM>, M, P>;
  } catch (error: any) {
    throw Error(error);
  }
};

//传入客户定义的path类型，这样引擎就不会计算
const useMeshFlowDefiner = <
  P extends MeshPath,
  S extends Record<string, any> | any[] = any,
  NM extends Record<string, any> = any
>() => {
  return <T, M extends Record<string, any>>(
    id: MeshPath,
    schema: S,
    options: {
      metaType?: NM; // 这里的 metaType 也会被自动关联
      UITrigger?: { signalCreator: () => T; signalTrigger: (s: T) => void };
      modules?: M;
      config?: any;
    }
  ) => {
    // 这里的 scheduler 能够拿到正确的 P 和 NM
    return useMeshFlow(id, schema, options as any) as Engine<
      SchedulerType<T, P, S, M, NM>,
      M,
      P
    >;
  };
};

/**
 * 获取 Engine 实例
 * @template M 手动注入的模块映射 (例如 { useHistory: typeof useHistory })
 * @template P ID 类型 (支持 string | number | symbol)
 */
const useEngine = <
  M extends Record<string, any> = {},
  P extends MeshPath = any,
  NM extends Record<string, any> = Record<string, any>,
  S = any,
  T = any
>(
  id: MeshPath
): Engine<SchedulerType<T, P, S, M, NM>, M, P> => {
  
  const instance = engineMap.get(id);

  if (!instance) {
    throw Error(`[MeshFlow] Engine ID "${String(id)}" not found. Ensure it is initialized with useMeshFlow.`);
  }

  // 这里的 as any 是必要的，因为 engineMap 存的是 Engine<any, any, any>
  // 所有的类型安全由调用处传入的泛型 P, M 保证
  return instance as Engine<SchedulerType<T, P, S, M, NM>, M, P>; 
};

const deleteEngine = (id: MeshPath) => {
  const engine = engineMap.get(id) ;
  engine.destroyPlugin()    

  engineMap.delete(id);
};
const useMeshFlow = useEngineManager;

export {
  useEngineManager,
  useMeshFlow,
  useEngine,
  deleteEngine,
  useMeshFlowDefiner,
};

export type {
  MeshPath,
  SetRuleOptions,
  MeshEvents,
  MeshFlowGroupNode,
  MeshErrorContext,
  MeshFlowTaskNode,
  MeshNodeProxy
} from "../types/types";

export {
  TriggerCause
} from "../types/types";

export type { SchemaBucket } from "../engine/bucket";

export {DefaultStrategy} from '../engine/bucket'

export type { InferLeafPath, InferLeafType } from "../utils/util";
 
export * from "../engine/useScheduler";
