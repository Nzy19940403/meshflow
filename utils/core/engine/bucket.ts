// import { ExecuteMeshRule } from "../dependency/useSetRule";
// import { InternalKeys ,DefaultStrategy} from "../types/types";

// type ContractType = "boolean" | "scalar" | "array" | "object";



// type validatorItem = {
//   logic: (value: any) => any; //验证逻辑
//   condition: (data: any) => boolean; //验证存在条件
//   options?: any;
// };

// export class StrategyStore {
//   private computedRules: any[] = [];

//   // 🌟 1. 新增：极简版智能执行器，彻底接管 logic 的执行
//   private getRuleResult(rule: any, api: any, checkRuleDirty: Function): any {
//     // 默认兜底规则直接执行，成本极低
//     if (rule.entityId === "__base__") {
//       return rule.logic(api);
//     }

//     // 核心判断：如果从未执行过，或者是脏的（向 Bucket 查询），则需要执行
//     let isDirty = !rule._hasRun || checkRuleDirty(rule.triggerUids);

//     // 🎯 命中规则缓存！直接阻断！
//     if (!isDirty) {
//       return rule._lastResult;
//     }
   
//     // 真正执行业务逻辑
//     // const p = rule.logic(api);
//     const p = ExecuteMeshRule(rule,api)
    
//     // 只保存结果，不再维护 deps 快照（Bucket 统管了）
//     if (!(p instanceof Promise)) {
//       rule._lastResult = p;
//       rule._hasRun = true;
//       return p;
//     }

//     return p.then((val) => {
//       rule._lastResult = val;
//       rule._hasRun = true;
//       return val;
//     });
//   }

//   private store: Record<DefaultStrategy, any> = {
//     OR: (api: any, version: number, checkRuleDirty: Function) => {
//       let res = undefined;
//       let baseValue: any = undefined;
//       const allRules = this.computedRules;

//       for (let i = 0; i < allRules.length; i++) {
//         const rule = allRules[i];

//         // 🌟 替换：使用智能执行器
//         const p = this.getRuleResult(rule, api, checkRuleDirty);
       
//         if (p instanceof Promise) {
//           return (async () => {
//             let val = await p;

//             if (rule.entityId === "__base__") {
//               baseValue = val;
//             } else if (val) {
//               res = val;
//             }

//             if (typeof res === "undefined") {
//               for (let j = i + 1; j < allRules.length; j++) {
//                 const nextRule = allRules[j];
//                 // 🌟 替换：异步链条中也使用智能执行器
//                 const nextP = this.getRuleResult(nextRule, api, checkRuleDirty);
//                 const nextVal = nextP instanceof Promise ? await nextP : nextP;

//                 if (nextRule.entityId === "__base__") {
//                   baseValue = nextVal;
//                   continue;
//                 }
//                 if (nextVal) {
//                   res = nextRule.value;
//                   break;
//                 }
//               }
//             }

//             if (typeof res === "undefined") res = baseValue;
//             return { res, version };
//           })();
//         }

//         const val = p;

//         if (rule.entityId === "__base__") {
//           baseValue = val;
//           continue;
//         }

//         if (val) {
//           res = rule.value;
//           break;
//         }
//       }

//       if (typeof res === "undefined") {
//         res = baseValue;
//       }

//       return { res, version };
//     },
//     PRIORITY: (api: any, version: number, checkRuleDirty: Function) => {
//       let res = undefined;
//       const allRules = this.computedRules;
   
//       for (let i = 0; i < allRules.length; i++) {
//         const rule = allRules[i];

//         // 🌟 替换：使用智能执行器
//         const p = this.getRuleResult(rule, api, checkRuleDirty);

//         if (p instanceof Promise) {
//           return (async () => {
//             const val = await p;
//             if (val !== undefined) {
//               const finalRes = rule.value !== undefined ? rule.value : val;
//               return { res: finalRes, version };
//             }

//             for (let j = i + 1; j < allRules.length; j++) {
//               const nextRule = allRules[j];
//               // 🌟 替换：异步链条中也使用智能执行器
//               const nextP = this.getRuleResult(nextRule, api, checkRuleDirty);
//               const nextVal = nextP instanceof Promise ? await nextP : nextP;
//               if (nextVal !== undefined) return { res: nextVal, version };
//             }
//             return { res: undefined, version };
//           })();
//         }

//         if (p !== undefined) {
//           const finalRes = rule.value !== undefined ? rule.value : p;
//           return { res:finalRes , version };
//         }
//       }

//       return { res, version };
//     },
//     MERGE: (api: any, version: number, checkRuleDirty: Function) => {
//       let res: any = undefined;
//       let baseValue: any = undefined;
//       const allRules = this.computedRules;

//       const mergeData = (target: any, source: any) => {
//         if (target === undefined) return source;
//         if (source === undefined) return target;

//         if (Array.isArray(target) && Array.isArray(source)) {
//           return [...source, ...target];
//         }
//         if (typeof target === "object" && typeof source === "object") {
//           return { ...source, ...target };
//         }
//         return target;
//       };

//       for (let i = 0; i < allRules.length; i++) {
//         const rule = allRules[i];

//         // 🌟 替换：使用智能执行器
//         const p = this.getRuleResult(rule, api, checkRuleDirty);

//         if (p instanceof Promise) {
//           return (async () => {
//             let val = await p;

//             const applyMerge = (r: any, v: any) => {
//               if (r.entityId === "__base__") {
//                 baseValue = mergeData(baseValue, v);
//               } else if (v) {
//                 const toMerge = r.value !== undefined ? r.value : v;
//                 res = mergeData(res, toMerge);
//               }
//             };

//             applyMerge(rule, val);

//             for (let j = i + 1; j < allRules.length; j++) {
//               const nextRule = allRules[j];
//               // 🌟 替换：异步链条中也使用智能执行器
//               const nextP = this.getRuleResult(nextRule, api, checkRuleDirty);
//               const nextVal = nextP instanceof Promise ? await nextP : nextP;
//               applyMerge(nextRule, nextVal);
//             }

//             const finalRes = mergeData(res, baseValue);
//             return { res: finalRes, version };
//           })();
//         }

//         const val = p;

//         if (rule.entityId === "__base__") {
//           baseValue = mergeData(baseValue, val);
//           continue;
//         }

//         if (val) {
//           const toMerge = rule.value !== undefined ? rule.value : val;
//           res = mergeData(res, toMerge);
//         }
//       }

//       const finalRes = mergeData(res, baseValue);
//       return { res: finalRes, version };
//     },
//   };

//   private CurrentStrategy: Function = () => {};

//   private CurrentStrategyType: DefaultStrategy = DefaultStrategy.PRIORITY;

//   private getRules: Function = () => {};

//   constructor(getRule: Function) {
//     this.getRules = getRule;
//     this.CurrentStrategy = this.store.PRIORITY;
//     this.updateComputedRules();
//   }

//   updateComputedRules() {
//     const list: any[] = this.getRules();

//     if (
//       this.CurrentStrategyType === DefaultStrategy.PRIORITY ||
//       this.CurrentStrategyType === DefaultStrategy.MERGE
//     ) {
//       this.computedRules = Array.from(list.values())
//         .map((item) => Array.from(item))
//         .flat<any>()
//         .sort((a, b) => b.priority - a.priority);
//     } else {
//       this.computedRules = Array.from(list.values())
//         .map((item) => Array.from(item))
//         .flat();
//     }
//   }

//   setStrategy(type: DefaultStrategy) {
//     this.CurrentStrategyType = type;
//     this.CurrentStrategy = this.store[type];
//     this.updateComputedRules();
//   }

//   // 🌟 2. 接收外部传来的 checkRuleDirty 函数
//   evaluate(api: any, currentVersion: number, checkRuleDirty: Function) {
//     return this.CurrentStrategy(api, currentVersion, checkRuleDirty);
//   }
// }

// /**
//  * @group Core Api
//  * @category 内部实现
//  * 
// */
// export class SchemaBucket<P> {
//   private path: any;

//   private strategy: StrategyStore;

//   /**
//    * @internal
//    * */ 
//   public contract: ContractType;

//   private rules = new Map<number, Set<{ logic: () => any }>>();

//   private isValue = false;

//   private id: number = 0;

//   private cache: any = undefined;

//   private pendingPromise: Promise<any> | null = null;

//   private version: number = 0;

//   private deps: Map<number, any> = new Map();

//   private _forceNotify: boolean = false;

//   promiseToken: any = null;

//   useCache: boolean = true;

//   private effectArray: { fn: (args: any) => any; args: any[] }[] = [];

//   constructor(baseValue: any, key: string | number | symbol, path: P) {
//     const getRule = () => this.rules;
//     this.strategy = new StrategyStore(getRule);
//     this.path = path;
//     this.isValue = key === "value";

//     this.contract = this.inferType(baseValue);

//     this.cache = baseValue;

//     this.setRule({
//       priority: 0,
//       entityId: "__base__",
//       logic: () => baseValue,
//     } as any);
//   }
//   /**
//    * @internal
//    * */ 
//   setUseCache(val: boolean) {
//     this.useCache = val;
//   }

//   forceNotify() {
//     this._forceNotify = true;
//   }
//   /**
//    * @internal
//    * */ 
//   isForceNotify() {
//     return this._forceNotify;
//   }

//   setStrategy(type: DefaultStrategy) {
//     this.strategy.setStrategy(type);
//   }

//   /**
//    * @internal
//    * */ 
//   setDefaultRule(value: any) {
//     const rules = new Set<{ logic: () => any }>();
//     rules.add(value);
//     this.rules.set(-1, rules);
//   }
//   /**
//    * @internal
//    * */ 
//   setRules<TKeys = any>(
//     value: {
//       value: any;
//       targetUid: number;
//       triggerUids: number[];
//       priority: any;
//       logic: any;
//       entityId?: any;
//     },
//     DepsArray?: Array<
//       [number, Array<TKeys | Exclude<InternalKeys, "state">>, any]
//     >
//   ) {
//     if (DepsArray) {
//       this.updateDeps(DepsArray);
//     }
//     const entityId = ++this.id;

//     const ruleEntity = {
//       ...value,
//       entityId,
//     };

//     for (let uid of value.triggerUids) {
//       if (!this.rules.has(uid)) {
//         this.rules.set(uid, new Set<any>());
//       }
//       this.rules.get(uid)!.add(ruleEntity);
//     }

//     this.strategy.updateComputedRules();

//     return () => {
//       for (let uid of value.triggerUids) {
//         const set = this.rules.get(uid);
//         if (set) {
//           set.delete(ruleEntity);
//           if (set.size === 0) {
//             this.rules.delete(uid);
//             this.deps.delete(uid);
//           }
//         }
//       }
//       this.strategy.updateComputedRules();
//     };
//   }
//   /**
//    * @internal
//    * */ 
//   updateDeps<TKeys>(
//     DepsArray: Array<
//       [number, Array<TKeys | Exclude<InternalKeys, "state">>, any]
//     >
//   ) {
//     for (let [triggerUid, keys, proxy] of DepsArray) {
//       if (keys.length == 0) continue;
//       let obj = this.deps.get(triggerUid) || Object.create(null);

//       for (let key of keys) {
//         obj[key] = proxy[key];
//       }

//       this.deps.set(triggerUid, obj);
//     }
//   }
//   /**
//    * @internal
//    * */ 
//   setRule<TKeys = any>(
//     value: {
//       value: any;
//       targetUid: number;
//       triggerUids: number[];
//       priority: any;
//       logic: any;
//       entityId?: any;
//     },
//     DepsArray?: Array<
//       [number, Array<TKeys | Exclude<InternalKeys, "state">>, any]
//     >
//   ) {
//     if (DepsArray) {
//       this.updateDeps(DepsArray);
//     }

//     if (typeof value.entityId === "string") {
//       this.setDefaultRule(value);
//       return;
//     }

//     const entityId = ++this.id;

//     const ruleEntity = {
//       ...value,
//       entityId,
//     };

//     if (value) {
//       for (let uid of value.triggerUids) {
//         if (!this.rules.has(uid)) {
//           this.rules.set(uid, new Set<any>());
//         }
//         this.rules.get(uid)!.add(ruleEntity);
//       }
//     }
//     this.strategy.updateComputedRules();

//     return () => {
//       for (let uid of value.triggerUids) {
//         const set = this.rules.get(uid);
//         if (set) {
//           set.delete(ruleEntity);
//           if (set.size === 0) {
//             this.rules.delete(uid);
//             this.deps.delete(uid);
//           }
//         }
//       }
//       this.strategy.updateComputedRules();
//     };
//   }
//   /**
//    * @internal
//    * */ 
//   setSideEffect(data: { fn: (args: any[]) => any; args: any[] }) {
//     this.effectArray.push(data);
//   }
//   /**
//    * @internal
//    * */ 
//   getSideEffect() {
//     return [...this.effectArray];
//   }

//   evaluate(api: any) {
//     let curToken = null;

//     if (api.GetToken) {
//       curToken = api.GetToken();
//     }

//     if (this.pendingPromise && this.promiseToken !== curToken) {
//       this.pendingPromise = null;
//       this.promiseToken = null;
//     }

//     if (this.pendingPromise) {
//       return this.pendingPromise;
//     }

//     let shouldSkipCalculate = false;

//     if (typeof api.triggerUid === "number") {
//       shouldSkipCalculate = true;

//       //如果没有设置triggerkeys的话，就用不了依赖缓存
//       if (this.deps.size == 0) {
//         shouldSkipCalculate = false;
//       }
//       for (let [uid, trackedKeysObj] of this.deps.entries()) {
//         let curState = api.getStateByUid(uid);

//         if (!curState) {
//           shouldSkipCalculate = false;
//           break;
//         }

//         for (let key in trackedKeysObj) {
//           let oldVal = trackedKeysObj[key];
//           let newVal = curState[key];

//           // 🚀 神级优化：如果是对象（且不是 null），直接放弃治疗，默认它脏了！
//           if (typeof oldVal === "object" && oldVal !== null) {
//             shouldSkipCalculate = false;
//             break;
//           }

//           if (oldVal !== newVal) {
//             shouldSkipCalculate = false;
//             break;
//           }
//         }
//         if (!shouldSkipCalculate) break;
//       }
//     }

//     if (shouldSkipCalculate && this.useCache) {
//       return this.cache;
//     }

//     this.promiseToken = curToken;
//     const currentVersion = ++this.version;

//     // 🌟 3. 新增：提供一个微观脏检查函数，直接复用桶的 this.deps
//     // 🌟 2. 微观脏检查
//     const checkRuleDirty = (triggerUids?: number[]) => {
//       if (!triggerUids || triggerUids.length === 0) return true;

//       //   if (
//       //     typeof api.triggerUid === "number" &&
//       //     !triggerUids.includes(api.triggerUid)
//       //   ) {
//       //     return false;
//       //   }

//       for (let uid of triggerUids) {
//         let trackedKeysObj = this.deps.get(uid);
//         if (!trackedKeysObj) return true;

//         let curState = api.getProxyByUid(uid);
//         if (!curState) return true;

//         for (let key in trackedKeysObj) {
//           let oldVal = trackedKeysObj[key];
//           let newVal = curState[key];

//           // 🚀 神级优化：如果是对象（且不是 null），直接认为该 Rule 的依赖脏了！
//           if (typeof oldVal === "object" && oldVal !== null) {
//             return true;
//           }

//           if (oldVal !== newVal) {
//             return true;
//           }
//         }
//       }
//       return false;
//     };
     
//     // 🌟 4. 将 checkRuleDirty 传递给 StrategyStore
//     const p = this.strategy.evaluate(api, currentVersion, checkRuleDirty);

//     if (!(p instanceof Promise)) {
//       const { res, version } = p;
//       return this.finalizeSync(res, version, api, curToken);
//     }

//     this.pendingPromise = (async () => {
//       try {
//         const { res, version } = await p;
//         return this.finalizeSync(res, version, api, curToken);
//       } catch (err: any) {
//         throw { path: this.path, error: err };
//       } finally {
//         if (this.promiseToken === curToken) {
//           this.pendingPromise = null;
//           this.promiseToken = null;
//         }
//       }
//     })();

//     return this.pendingPromise;
//   }
//   /**
//    * @internal
//    * */ 
//   private finalizeSync(res: any, version: number, api: any, curToken: any) {
//     if (curToken !== this.promiseToken || version < this.version) {
//       return this.cache;
//     }
//     this.cache = res;
//     this.deps.forEach((valObj, uid) => {
//       // 1. 获取这个节点最新的状态对象
//       const curState = api.getProxyByUid(uid);
//       if (!curState) return;

//       // 2. 拿到我们关注的那些 key (比如 ['maxAmount', 'isDead'])
//       const keys = Object.keys(valObj);

//       // 3. 更新快照：只更新我们关心的那几个字段
//       for (let key of keys) {
//         valObj[key] = curState[key];
//       }
//     });

//     return res;
//   }
//   /**
//    * @internal
//    * */ 
//   private inferType(val: any): ContractType {
//     if (Array.isArray(val)) return "array";
//     return typeof val as ContractType;
//   }
// }




import { ExecuteMeshRule } from "../dependency/useSetRule";
import { InternalKeys, DefaultStrategy } from "../types/types";

type ContractType = "boolean" | "scalar" | "array" | "object";

type validatorItem = {
  logic: (value: any) => any; //验证逻辑
  condition: (data: any) => boolean; //验证存在条件
  options?: any;
};

// 🌟 1. 全局静态合并函数（纯函数，零闭包开销）
const mergeData = (target: any, source: any) => {
  if (target === undefined) return source;
  if (source === undefined) return target;

  if (Array.isArray(target) && Array.isArray(source)) {
    return [...source, ...target];
  }
  if (typeof target === "object" && typeof source === "object") {
    return { ...source, ...target };
  }
  return target;
};

// 🌟 2. 策略被提取为【全局单例】，全宇宙共用这 3 个函数！彻底消灭 72 万个函数实例！
const GLOBAL_STRATEGIES: Record<string, (store: StrategyStore, api: any, version: number, checkRuleDirty: Function) => any> = {
  OR: (store, api, version, checkRuleDirty) => {
    let res = undefined;
    let baseValue: any = undefined;
    const allRules = store.computedRules; // 通过参数访问，不持有 this 闭包

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store.getRuleResult(rule, api, checkRuleDirty);

      if (p instanceof Promise) {
        return (async () => {
          let val = await p;
          if (rule.entityId === "__base__") {
            baseValue = val;
          } else if (val) {
            res = val;
          }

          if (typeof res === "undefined") {
            for (let j = i + 1; j < allRules.length; j++) {
              const nextRule = allRules[j];
              const nextP = store.getRuleResult(nextRule, api, checkRuleDirty);
              const nextVal = nextP instanceof Promise ? await nextP : nextP;

              if (nextRule.entityId === "__base__") {
                baseValue = nextVal;
                continue;
              }
              if (nextVal) {
                res = nextRule.value;
                break;
              }
            }
          }

          if (typeof res === "undefined") res = baseValue;
          return { res, version };
        })();
      }

      const val = p;
      if (rule.entityId === "__base__") {
        baseValue = val;
        continue;
      }
      if (val) {
        res = rule.value;
        break;
      }
    }

    if (typeof res === "undefined") {
      res = baseValue;
    }
    return { res, version };
  },

  PRIORITY: (store, api, version, checkRuleDirty) => {
    let res = undefined;
    const allRules = store.computedRules;

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store.getRuleResult(rule, api, checkRuleDirty);

      if (p instanceof Promise) {
        return (async () => {
          const val = await p;
          if (val !== undefined) {
            const finalRes = rule.value !== undefined ? rule.value : val;
            return { res: finalRes, version };
          }

          for (let j = i + 1; j < allRules.length; j++) {
            const nextRule = allRules[j];
            const nextP = store.getRuleResult(nextRule, api, checkRuleDirty);
            const nextVal = nextP instanceof Promise ? await nextP : nextP;
            if (nextVal !== undefined) return { res: nextVal, version };
          }
          return { res: undefined, version };
        })();
      }

      if (p !== undefined) {
        const finalRes = rule.value !== undefined ? rule.value : p;
        return { res: finalRes, version };
      }
    }

    return { res, version };
  },

  MERGE: (store, api, version, checkRuleDirty) => {
    let res: any = undefined;
    let baseValue: any = undefined;
    const allRules = store.computedRules;

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store.getRuleResult(rule, api, checkRuleDirty);

      if (p instanceof Promise) {
        return (async () => {
          let val = await p;

          const applyMerge = (r: any, v: any) => {
            if (r.entityId === "__base__") {
              baseValue = mergeData(baseValue, v);
            } else if (v) {
              const toMerge = r.value !== undefined ? r.value : v;
              res = mergeData(res, toMerge);
            }
          };

          applyMerge(rule, val);

          for (let j = i + 1; j < allRules.length; j++) {
            const nextRule = allRules[j];
            const nextP = store.getRuleResult(nextRule, api, checkRuleDirty);
            const nextVal = nextP instanceof Promise ? await nextP : nextP;
            applyMerge(nextRule, nextVal);
          }

          const finalRes = mergeData(res, baseValue);
          return { res: finalRes, version };
        })();
      }

      const val = p;
      if (rule.entityId === "__base__") {
        baseValue = mergeData(baseValue, val);
        continue;
      }
      if (val) {
        const toMerge = rule.value !== undefined ? rule.value : val;
        res = mergeData(res, toMerge);
      }
    }

    const finalRes = mergeData(res, baseValue);
    return { res: finalRes, version };
  }
};


export class StrategyStore {
  // 🌟 将 computedRules 和 getRuleResult 改为 public，供外部静态策略调用
  public computedRules: any[] = [];
  
  private CurrentStrategyType: DefaultStrategy = DefaultStrategy.PRIORITY;
  private getRules: Function;

  constructor(getRule: Function) {
    this.getRules = getRule;
    this.CurrentStrategyType = DefaultStrategy.PRIORITY;
    this.updateComputedRules();
  }

  public getRuleResult(rule: any, api: any, checkRuleDirty: Function): any {
    if (rule.entityId === "__base__") {
      return rule.logic(api);
    }

    let isDirty = !rule._hasRun || checkRuleDirty(rule.triggerUids);

    if (!isDirty) {
      return rule._lastResult;
    }
    
    const p = ExecuteMeshRule(rule, api);
    
    if (!(p instanceof Promise)) {
      rule._lastResult = p;
      rule._hasRun = true;
      return p;
    }

    return p.then((val) => {
      rule._lastResult = val;
      rule._hasRun = true;
      return val;
    });
  }

  updateComputedRules() {
    const list: any[] = this.getRules();

    if (
      this.CurrentStrategyType === DefaultStrategy.PRIORITY ||
      this.CurrentStrategyType === DefaultStrategy.MERGE
    ) {
      this.computedRules = Array.from(list.values())
        .map((item) => Array.from(item as any))
        .flat<any>()
        .sort((a, b) => b.priority - a.priority);
    } else {
      this.computedRules = Array.from(list.values())
        .map((item) => Array.from(item as any))
        .flat();
    }
  }

  setStrategy(type: DefaultStrategy) {
    this.CurrentStrategyType = type;
    this.updateComputedRules();
  }

  // 🌟 核心：根据 Type 去全局查表执行，阻断实例级闭包！
  evaluate(api: any, currentVersion: number, checkRuleDirty: Function) {
    const strategyFn = GLOBAL_STRATEGIES[this.CurrentStrategyType as string];
    return strategyFn(this, api, currentVersion, checkRuleDirty);
  }
}

/**
 * @group Core Api
 * @category 内部实现
 */
export class SchemaBucket<P> {
  private path: any;
  private strategy: StrategyStore;
  
  /** @internal */ 
  public contract: ContractType;

  private rules = new Map<number, Set<{ logic: () => any }>>();
  private isValue = false;
  private id: number = 0;
  private cache: any = undefined;
  private pendingPromise: Promise<any> | null = null;
  private version: number = 0;
  private deps: Map<number, any> = new Map();
  private _forceNotify: boolean = false;

  promiseToken: any = null;
  useCache: boolean = true;
  private effectArray: { fn: (args: any) => any; args: any[] }[] = [];

  // 🌟 将原来在构造函数里创建的 `() => this.rules` 提炼为绑定方法
  private _getRulesInternal = () => this.rules;

  constructor(baseValue: any, key: string | number | symbol, path: P) {
    // 🌟 直接传入原型绑定方法，避免闭包
    this.strategy = new StrategyStore(this._getRulesInternal);
    this.path = path;
    this.isValue = key === "value";
    this.contract = this.inferType(baseValue);
    this.cache = baseValue;

    this.setRule({
      priority: 0,
      entityId: "__base__",
      logic: () => baseValue,
    } as any);
  }

  /** @internal */ 
  setUseCache(val: boolean) {
    this.useCache = val;
  }

  forceNotify() {
    this._forceNotify = true;
  }

  /** @internal */ 
  isForceNotify() {
    return this._forceNotify;
  }

  setStrategy(type: DefaultStrategy) {
    this.strategy.setStrategy(type);
  }

  /** @internal */ 
  setDefaultRule(value: any) {
    const rules = new Set<{ logic: () => any }>();
    rules.add(value);
    this.rules.set(-1, rules);
  }

  /** @internal */ 
  setRules<TKeys = any>(
    value: {
      value: any;
      targetUid: number;
      triggerUids: number[];
      priority: any;
      logic: any;
      entityId?: any;
    },
    DepsArray?: Array<[number, Array<TKeys | Exclude<InternalKeys, "state">>, any]>
  ) {
    if (DepsArray) {
      this.updateDeps(DepsArray);
    }
    const entityId = ++this.id;

    const ruleEntity = {
      ...value,
      entityId,
    };

    for (let uid of value.triggerUids) {
      if (!this.rules.has(uid)) {
        this.rules.set(uid, new Set<any>());
      }
      this.rules.get(uid)!.add(ruleEntity);
    }

    this.strategy.updateComputedRules();

    return () => {
      for (let uid of value.triggerUids) {
        const set = this.rules.get(uid);
        if (set) {
          set.delete(ruleEntity);
          if (set.size === 0) {
            this.rules.delete(uid);
            this.deps.delete(uid);
          }
        }
      }
      this.strategy.updateComputedRules();
    };
  }

  /** @internal */ 
  updateDeps<TKeys>(
    DepsArray: Array<[number, Array<TKeys | Exclude<InternalKeys, "state">>, any]>
  ) {
    for (let [triggerUid, keys, proxy] of DepsArray) {
      if (keys.length == 0) continue;
      let obj = this.deps.get(triggerUid) || Object.create(null);

      for (let key of keys) {
        obj[key as string] = proxy[key];
      }

      this.deps.set(triggerUid, obj);
    }
  }

  /** @internal */ 
  setRule<TKeys = any>(
    value: {
      value: any;
      targetUid: number;
      triggerUids: number[];
      priority: any;
      logic: any;
      entityId?: any;
    },
    DepsArray?: Array<[number, Array<TKeys | Exclude<InternalKeys, "state">>, any]>
  ) {
    if (DepsArray) {
      this.updateDeps(DepsArray);
    }

    if (typeof value.entityId === "string") {
      this.setDefaultRule(value);
      return;
    }

    const entityId = ++this.id;

    const ruleEntity = {
      ...value,
      entityId,
    };

    if (value) {
      for (let uid of value.triggerUids) {
        if (!this.rules.has(uid)) {
          this.rules.set(uid, new Set<any>());
        }
        this.rules.get(uid)!.add(ruleEntity);
      }
    }
    this.strategy.updateComputedRules();

    return () => {
      for (let uid of value.triggerUids) {
        const set = this.rules.get(uid);
        if (set) {
          set.delete(ruleEntity);
          if (set.size === 0) {
            this.rules.delete(uid);
            this.deps.delete(uid);
          }
        }
      }
      this.strategy.updateComputedRules();
    };
  }

  /** @internal */ 
  setSideEffect(data: { fn: (args: any[]) => any; args: any[] }) {
    this.effectArray.push(data);
  }

  /** @internal */ 
  getSideEffect() {
    return [...this.effectArray];
  }

  // 🌟 将 evaluate 内部深藏的匿名脏检查函数拔除到了原型上
  private _checkRuleDirty(api: any, triggerUids?: number[]) {
    if (!triggerUids || triggerUids.length === 0) return true;

    for (let uid of triggerUids) {
      let trackedKeysObj = this.deps.get(uid);
      if (!trackedKeysObj) return true;

      let curState = api.getProxyByUid(uid);
      if (!curState) return true;

      for (let key in trackedKeysObj) {
        let oldVal = trackedKeysObj[key];
        let newVal = curState[key];

        if (typeof oldVal === "object" && oldVal !== null) {
          return true;
        }

        if (oldVal !== newVal) {
          return true;
        }
      }
    }
    return false;
  }

  evaluate(api: any) {
    let curToken = null;

    if (api.GetToken) {
      curToken = api.GetToken();
    }

    if (this.pendingPromise && this.promiseToken !== curToken) {
      this.pendingPromise = null;
      this.promiseToken = null;
    }

    if (this.pendingPromise) {
      return this.pendingPromise;
    }

    let shouldSkipCalculate = false;

    if (typeof api.triggerUid === "number") {
      shouldSkipCalculate = true;

      if (this.deps.size == 0) {
        shouldSkipCalculate = false;
      }
      for (let [uid, trackedKeysObj] of this.deps.entries()) {
        let curState = api.getStateByUid(uid);

        if (!curState) {
          shouldSkipCalculate = false;
          break;
        }

        for (let key in trackedKeysObj) {
          let oldVal = trackedKeysObj[key];
          let newVal = curState[key];

          if (typeof oldVal === "object" && oldVal !== null) {
            shouldSkipCalculate = false;
            break;
          }

          if (oldVal !== newVal) {
            shouldSkipCalculate = false;
            break;
          }
        }
        if (!shouldSkipCalculate) break;
      }
    }

    if (shouldSkipCalculate && this.useCache) {
      return this.cache;
    }

    this.promiseToken = curToken;
    const currentVersion = ++this.version;

    // 🌟 在这里组装一个极轻量的箭头函数传下去。因为这是短时（Short-lived）分配，
    // GC 在年轻代（Nursery Gen）就能秒杀它，不会堆积在老生代内存里。
    const checkDirty = (uids?: number[]) => this._checkRuleDirty(api, uids);
      
    const p = this.strategy.evaluate(api, currentVersion, checkDirty);

    if (!(p instanceof Promise)) {
      const { res, version } = p;
      return this.finalizeSync(res, version, api, curToken);
    }

    this.pendingPromise = (async () => {
      try {
        const { res, version } = await p;
        return this.finalizeSync(res, version, api, curToken);
      } catch (err: any) {
        throw { path: this.path, error: err };
      } finally {
        if (this.promiseToken === curToken) {
          this.pendingPromise = null;
          this.promiseToken = null;
        }
      }
    })();

    return this.pendingPromise;
  }

  /** @internal */ 
  private finalizeSync(res: any, version: number, api: any, curToken: any) {
    if (curToken !== this.promiseToken || version < this.version) {
      return this.cache;
    }
    this.cache = res;
    this.deps.forEach((valObj, uid) => {
      const curState = api.getProxyByUid(uid);
      if (!curState) return;
      const keys = Object.keys(valObj);
      for (let key of keys) {
        valObj[key] = curState[key];
      }
    });

    return res;
  }

  /** @internal */ 
  private inferType(val: any): ContractType {
    if (Array.isArray(val)) return "array";
    return typeof val as ContractType;
  }
}


export class ValidatorsBucket {
  validators: Array<validatorItem> = [];
  defaultValidators: Array<validatorItem> = [];

  private path: string = "";
  constructor(path: string) {
    this.path = path;
    this.SetDefaultValidators();
  }

  setValidators(validator: any) {
    this.validators.push(validator);
  }

  SetDefaultValidators() {
    const requireValidator: validatorItem = {
      logic: (value) => {
        if (value) return true;
        if (typeof value === "number") return true;
        return `${this.path} undefined`;
      },
      condition: (data) => {
        return !!data.required;
      },
    };

    const maxLengthValidator: validatorItem = {
      logic: function (value) {
        if (value.length > this.options.maxLength)
          return `Too long:${this.options.maxLength}`;
        return true;
      },
      condition: function (data) {
        if (typeof data.maxLength !== "number") return false;
        maxLengthValidator.options = {
          maxLength: data.maxLength,
        };
        return data.type === "input" && data.hidden === false;
      },
      options: {},
    };

    this.defaultValidators.push(requireValidator);
    this.defaultValidators.push(maxLengthValidator);
  }

  evaluate(newVal: any, schema: any) {
    let res: boolean | string = true;
    let list = [...this.defaultValidators, ...this.validators];

    for (let validator of list) {
      let allowed = validator.condition(schema);
      if (!allowed) continue;

      let val = validator.logic(newVal);

      if (typeof val !== "boolean") {
        res = val;
        break;
      }
    }

    return res;
  }
}



