
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
import { useExecutionTrace } from "./plugins/useExecutionTrace";
import { meshFormSchemaToFormFieldSchema } from "./jsonforms/schemaConverter";
import type { MeshFormSchema } from "./jsonforms/types";

// from() - DAG 联动语法糖
export type FromDescriptor = {
  _isMeshFrom: true
  source: string | string[]
  logic: (...values: any[]) => any
  triggerKeys?: string[]
  effect?: (args: any) => any
  effectArgs?: string[]
}

export function from(
  source: string | string[],
  logic: (...values: any[]) => any,
  options?: Pick<FromDescriptor, 'triggerKeys' | 'effect' | 'effectArgs'>
): FromDescriptor {
  return { _isMeshFrom: true, source, logic, ...options }
}

// Graph inspection type
export type MeshGraph = {
  upstream: (path: string) => string[]
  downstream: (path: string) => string[]
  directUpstream: (path: string) => string[]
  directDownstream: (path: string) => string[]
  order: () => string[][]
}

// Internal: attach define() and graph to an engine instance
function attachExtensions(engine: any): void {
  const scheduler = engine.scheduler as any

  engine.define = (rules: Record<string, FromDescriptor>) => {
    for (const [target, rule] of Object.entries(rules)) {
      const lastDot = target.lastIndexOf('.')
      if (lastDot === -1) {
        throw new Error('[meshform] define() target must be "path.key", got: ' + target)
      }
      const inDegreePath = target.substring(0, lastDot)
      const key = target.substring(lastDot + 1)

      const meshOptions = {
        logic: (api: any) => {
          const values = api.slot.triggerTargets.map((t: any) => t.value)
          return rule.logic(...values)
        },
        triggerKeys: rule.triggerKeys ?? ['value'],
        ...(rule.effect ? { effect: rule.effect } : {}),
        ...(rule.effectArgs ? { effectArgs: rule.effectArgs } : {}),
      }

      if (Array.isArray(rule.source)) {
        engine.config.SetRules(rule.source, inDegreePath, key, meshOptions)
      } else {
        engine.config.SetRule(rule.source, inDegreePath, key, meshOptions)
      }
    }
  }

  const safeUidToPath = (uid: number): string | undefined => {
    try { return scheduler.GetPathByUid(uid) } catch { return undefined }
  }
  const safePathToUid = (path: string): number | undefined => {
    try { return scheduler.GetNodeByPath(path)?.uid } catch { return undefined }
  }
  const toPathList = (uids: number[]): string[] =>
    uids.map(safeUidToPath).filter((p): p is string => !!p)

  // Direct meshflow API shortcuts
  engine.setRule = (...args: any[]) => (engine.config.SetRule as any)(...args)
  engine.setRules = (...args: any[]) => (engine.config.SetRules as any)(...args)
  engine.entangle = (...args: any[]) => (engine.config.useEntangle as any)(...args)

  engine.graph = {
    upstream: (path: string): string[] => {
      const uid = safePathToUid(path); if (uid === undefined) return []
      return toPathList(scheduler.dependency._GetAllPrevDependency(uid) ?? [])
    },
    downstream: (path: string): string[] => {
      const uid = safePathToUid(path); if (uid === undefined) return []
      return toPathList(scheduler.dependency._GetAllNextDependency(uid) ?? [])
    },
    directUpstream: (path: string): string[] => {
      const uid = safePathToUid(path); if (uid === undefined) return []
      return toPathList(scheduler.dependency._GetPrevDependency(uid) ?? [])
    },
    directDownstream: (path: string): string[] => {
      const uid = safePathToUid(path); if (uid === undefined) return []
      return toPathList(scheduler.dependency._GetNextDependency(uid) ?? [])
    },
    order: (): string[][] =>
      (engine.dependency.GetDependencyOrder() as number[][])
        .map((level: number[]) => toPathList(level)),
  } satisfies MeshGraph
}

export type NormalizeFormSchema<T> = T extends Function
  ? T
  : T extends readonly any[]
  ? { -readonly [K in keyof T]: NormalizeFormSchema<T[K]> }
  : T extends object
  ? {
      -readonly [K in keyof T as K extends 'name' ? 'name' | 'path' : K]: NormalizeFormSchema<T[K]>
    }
  : T;

type tracePlugin<P> = ReturnType< typeof useExecutionTrace<P> >;

export function useMeshForm<
const S extends Record<string, any>,
  NM extends Record<string, any> = InferLeafType<NormalizeFormSchema<S>>,
  M extends Record<string, any> = {},
  T = any,
  P extends MeshPath = [InferLeafPath<NormalizeFormSchema<S>>] extends [never] ? MeshPath : InferLeafPath<NormalizeFormSchema<S>> | (string & {})
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
  const engine = useMeshFlow<S, T, M, NM>(id, schema, {
    config: {
      useGreedy: options.config?.useGreedy ?? false,
    },
    UITrigger: options.UITrigger,
    metaType: options.metaType || {} as NM,
    modules: {
      internalModules:{
        useInternalForm,
        useSchemaValidators,
      },
      ...options.modules,
    } as any,
  });

  const { SetTrace, useTrace } = useExecutionTrace<P>();
  const Trace = useTrace();
  engine.config.usePlugin(Trace);
  (engine as any).plugins = {SetTrace};

  attachExtensions(engine as any);

  type EngineFull = Engine<
    SchedulerType<T,P,S,M,NM>,
    M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
    },
    P
  > & {
    plugins: { SetTrace: tracePlugin<P>['SetTrace'] }
    define: (rules: Record<string, FromDescriptor>) => void
    graph: MeshGraph
    /** raw meshflow: engine.setRule(source, target, key, options) */
    setRule: (...args: any[]) => void
    /** raw meshflow: engine.setRules(sources, target, key, options) */
    setRules: (...args: any[]) => void
    /** raw meshflow: engine.entangle(paths, options) - cyclic/bidirectional graph */
    entangle: (...args: any[]) => any
  }

  return engine as EngineFull;
}

export const useEngine = <
    M extends Record<string, any>,
    P extends MeshPath = MeshPath,
    NM extends Record<string, any> = Record<string, any>
>(id:MeshPath) => {
    const engine = useCoreEngine<
      M & {
        internalModules:{
          internalForm:typeof useInternalForm,
          schemaValidators:typeof useSchemaValidators
        }
      },
      P, NM, any
    >(id);

    return engine as unknown as Engine<SchedulerType<any, P, any, M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
    }, NM>,
    M & {
      internalModules:{
        internalForm:typeof useInternalForm,
        schemaValidators:typeof useSchemaValidators
      }
    }, P> & {
      plugins:{
        SetTrace:tracePlugin<P>['SetTrace']
      }
    };
}

export const deleteEngine = (id:MeshPath) => {
    deleteCoreEngine(id);
}

export function useMeshFormJson<T = any, M extends Record<string, any> = {}>(
  id: string,
  jsonSchema: MeshFormSchema,
  options: {
    UITrigger: {
      signalCreator: () => T
      signalTrigger: (signal: T) => void
    }
    modules?: M
    config?: { useGreedy?: boolean }
  }
) {
  const formFieldSchema = meshFormSchemaToFormFieldSchema(jsonSchema)
  return useMeshForm(id, formFieldSchema, options)
}

export * from "./schema/schema";
export type { MeshFormSchema, MeshFieldSchema, MeshObjectSchema } from "./jsonforms/types";

// ─────────────────────────────────────────────────────────────────────────────
// Re-export meshflow primitive types so meshform users have a single import
// ─────────────────────────────────────────────────────────────────────────────
export type { SetRuleOptions, GhostProposalApi, MeshNodeProxy } from "@meshflow/core";
