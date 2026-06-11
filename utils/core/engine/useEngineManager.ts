import {  IsNever, MeshError, MeshPath } from "../types/types";
import { InferLeafPath, InferLeafType, KeysOfUnion } from "../utils/util";
import { useEngineInstance } from "./useEngineInstance";

/**
 * @internal
*/
export type SchedulerType<
  T,
  P extends MeshPath,
  S,
  M extends Record<string, any>,
  NM
> = ReturnType<typeof useEngineInstance<T, P, S, M, NM>>;
/**
 * @internal
*/
export type BaseEngine<T> = {
  data: {
    SetValue: T extends { SetValue: infer F } ? F : never;
    GetValue: T extends { GetValue: infer F } ? F : never;
    SetValues: T extends { SetValues: infer F } ? F : never;
    GetGroupByPath: T extends { GetGroupByPath: infer F } ? F : never;
    StageValue: T extends { StageValue: infer F } ? F : never;
    SilentSet: T extends { SilentSet: infer F } ? F : never;
    SettleTasks:T extends { SettleTasks: infer F } ? F : never;
  };
  config: {
    SetRule: T extends { SetRule: infer F } ? F : never;
    SetRules: T extends { SetRules: infer F } ? F : never;
    SetStrategy: T extends { SetStrategy: infer F } ? F : never;

    notifyAll: T extends { notifyAll: infer F } ? F : never;
    // SetTrace: T extends { SetTrace: infer F } ? F : never;
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
/**
 * @internal
*/
export type TransformModuleKey<T> = T extends "useMeshRenderGate"
  ? "render"
  : T extends `use${infer Rest}`
  ? Uncapitalize<Rest>
  : T;
/**
 * @internal
*/
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
    : K extends "useHistory" | "useMeshRenderGate" | "meshRenderGate"
    ? F extends (...args: any) => infer R
      ? R extends (...args: any) => infer R2
        ? R2
        : R // 👈 如果返回的是函数，再解一层；否则取 R
      : any
    : // 其他模块：走通用的 infer (比如自定义模块)
    F extends (...args: any) => infer R
    ? R
    : any;

 
/**
 * @internal
*/
export type EngineModules<M extends Record<string, any>, P extends MeshPath> = {
  [K in keyof M as TransformModuleKey<string & K>]: M[K] extends (
    ...args: any
  ) => any
    ? MapModuleToReturn<K, M[K], P> // 是模块函数？直接解包
    : M[K] extends Record<string, any>
    ? EngineModules<M[K], P> // 是对象？递归进去！
    : M[K];
};
/**
 *@internal 
 */ 
export type Engine<
  T,
  M extends Record<string, any>,
  P extends MeshPath
> = BaseEngine<T> & {
  modules: EngineModules<M, P>;
};

 
    
type StripReadonly<T> = T extends Function
  ? T
  : T extends readonly any[] // 🌟 直接用 any[] 占位即可
  ? { -readonly [K in keyof T]: StripReadonly<T[K]> } 
  : T extends object
  ? { -readonly [K in keyof T]: StripReadonly<T[K]> }
  : T;
 
type NormalizeSchema<T> = T extends readonly any[]
  ? (T["length"] extends 0 ? Record<string, any> : StripReadonly<T[0]>)
  : StripReadonly<T>;

const engineMap = new Map<MeshPath, any>();

 /**
 * [BOT] 初始化并获取 MeshFlow 引擎实例——**这是所有 API 的入口**
 *
 * ## 返回的 Engine 对象包含五大模块
 * | 模块 | 用途 | 核心 API |
 * |------|------|----------|
 * | `engine.config` | 规则与拓扑编排 | `SetRule` `SetRules` `useEntangle` `notifyAll` |
 * | `engine.data` | 数据大盘读写 | `SetValue` `GetValue` `StageValue` `SilentSet` |
 * | `engine.hooks` | 生命周期钩子 | `onError` `onSuccess` `onStart` |
 * | `engine.dependency` | 图分析工具 | `GetAllDependency` `GetDependencyOrder` |
 * | `engine.modules` | 扩展模块 | `history` `form` `validator` `render` |
 *
 * ## 写入 API 速查
 * | 方法 | 触发拓扑? | 使用场景 |
 * |------|----------|---------|
 * | `SetValue` | 立即点火 | 用户交互、表单输入 |
 * | `SetValues` | 批量点火 | 一次修改多个节点 |
 * | `StageValue` | 微任务聚合 | WebSocket 高频推送 |
 * | `SilentSet` | 不点火 | 系统重置、背景降噪 |
 *
 * * **查看完整 API 文档：** {@link EngineCoreAPI}
 * @group Core Api
 * @category 入口函数
 * @param id — 引擎实例唯一标识（字符串/数字/符号），跨组件通过此 ID 复用
 * @param Schema — 类型定义模板（仅 TS 类型推导，运行时通过 modules 注册节点）
 * @param options — 引擎配置项与扩展模块 {@link MeshFlowOptions}
 * @returns Engine 对象，完整类型签名见 {@link EngineCoreAPI}
 * @typeParam S — Schema 类型定义（`as const` 可推导精确路径字面量）
 * @typeParam T — UI 信号类型（Vue `Ref<number>` 或 React `()=>void`）
 * @typeParam M — 扩展模块映射类型（如 `{ useInternalForm, useHistory }`）
 * @typeParam NM — MetaType，推导各节点的属性键名供 `triggerKeys` 自动补全
 * @typeParam P — 路径字面量联合类型（由 Schema 自动推导）
 * @example
 * ```ts
 * const engine = useMeshFlow('my-engine', schema, {
 *   UITrigger: {
 *     signalCreator: () => ref(0),      // Vue
 *     signalTrigger: (s) => s.value++,
 *   },
 *   modules: { useInternalForm },
 * });
 * engine.config.SetRule('a.path', 'b.path', 'value', {
 *   logic: ({ slot }) => slot.triggerTargets[0].count + 1,
 * });
 * engine.config.notifyAll();
 * ```
 */
const useMeshFlow = <
  const S extends Record<string, any> | readonly Record<string, any>[],
  T, //UITrigger的类型
  M extends Record<string, any>,
  NM extends Record<string, any> = IsNever<NormalizeSchema<S>> extends true ?Record<KeysOfUnion<NormalizeSchema<S>>, any>:InferLeafType<S>,
  P extends MeshPath = [InferLeafPath<S>] extends [never]
    ? MeshPath
    : InferLeafPath<S> | (string & {}) //path类型，作为任务的唯一性标志, 让leafpath宽松一些，支持动态路径
>(
  id: MeshPath,
  Schema: S,
  options: {
    metaType?: NM;
    config?: {
      useGreedy?: boolean;
      useEntangleStep?:number,
      NODE_QUOTA_PER_FRAME?:number
    };
    modules?: M;
    UITrigger?: {
      signalCreator: () => T;
      signalTrigger: (signal: T) => void;
    };
  }
) => {
  try {
 

    if (engineMap.has(id)) {
      throw Error(MeshError.EngineIdRepeated);
    }

    const EngineInstance = useEngineInstance<T, P, S, M, NM>(Schema, {
      config: { useGreedy: false,...(options.config||{}) },
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
      // SetTrace,
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
      destroyPlugin,
      dispose,
      StageValue,
      SilentSet,

      SettleTasks
    } = EngineInstance;

    const baseEngine: BaseEngine<SchedulerType<T, P, S, M, NM>> = {
      config: {
        SetRule,
        SetRules,
        SetStrategy,
        notifyAll,
        // SetTrace,
        usePlugin,
        hasRenderGate,
        useEntangle 
      },
      data: { SetValue, GetValue, SetValues, GetGroupByPath,StageValue,SilentSet,SettleTasks },
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
      dispose,
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

/**
 * [BOT] 类型工厂（Currying）——预先锁定泛型，生成专属实例化函数
 *
 * ## 与 `useMeshFlow` 的差异
 * | | `useMeshFlow` | `useMeshFlowDefiner` |
 * |--|--------------|---------------------|
 * | 泛型位置 | 每次调用都写 | 工厂定义时写一次 |
 * | 路径推导 | 从 Schema 推导 | 手动锁定 |
 * | 适用场景 | 单页面/简单项目 | 大型项目、多次实例化 |
 *
 * 工作流:
 * 1. 配置文件中定义: `const mesh = useMeshFlowDefiner<MyPaths, MyMeta>();`
 * 2. 业务中实例化: `const engine = mesh('app-engine', schema, { ... });`
 *
 * @group Core Api
 * @category 入口函数
 * @template P — 预锁定的路径字面量类型
 * @template S — Schema 结构类型
 * @template NM — 预锁定的 MetaType
 * @returns 返回一个接收 (id, schema, options) 的实例化函数
 * @see useMeshFlow 直接创建引擎
 */
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
 * [BOT] 实例检索——跨文件/组件获取已激活的 Engine 实例
 *
 * 只要引擎通过 `useMeshFlow` 初始化过，任何地方通过 ID 即可获取，无需 Prop Drilling。
 *
 * @param id — 引擎实例的唯一 ID
 * @returns Engine 对象，与 `useMeshFlow` 返回类型一致
 * @throws MeshError.EngineNotFound — ID 对应的实例不存在
 * @group Core Api
 * @category 实例管理
 * @template M — 动态插件类型 (可选)
 * @template P — 路径类型标识 (可选)
 * @see useMeshFlow 创建引擎
 * @see deleteEngine 销毁引擎
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
    throw Error(MeshError.EngineNotFound);
  }

  // 这里的 as any 是必要的，因为 engineMap 存的是 Engine<any, any, any>
  // 所有的类型安全由调用处传入的泛型 P, M 保证
  return instance as Engine<SchedulerType<T, P, S, M, NM>, M, P>; 
};
/**
 * [BOT] 实例销毁——从全局池注销并释放引擎全部资源
 *
 * 彻底切断引擎与其所有插件、异步任务的联系，并从内存中移除引用。
 *
 * @param id — 待销毁引擎的唯一标识符
 * @group Core Api
 * @category 实例管理
 * @see useMeshFlow 创建引擎
 * @see useEngine 获取引擎
 */
const deleteEngine = (id: MeshPath) => {
  const engine = engineMap.get(id) ;
       
  engine.dispose();

  engineMap.delete(id);
};
 

export {
 
  useMeshFlow,
  useEngine,
  deleteEngine,
  useMeshFlowDefiner,
};

export type {
  MeshPath,
  MeshEmit,
  SetRuleOptions,
  MeshEvents,
  MeshFlowGroupNode,
  MeshErrorContext,
  MeshFlowTaskNode,
  MeshNodeProxy,
  GhostProposalApi,
} from "../types/types";

export {
  TriggerCause,
  MeshFlowEventsName,
  DefaultStrategy
} from "../types/types";

export type { SchemaBucket } from "../engine/bucket";

 

export type { InferLeafPath, InferLeafType } from "../utils/util";
 
export * from "../engine/useScheduler";
 

