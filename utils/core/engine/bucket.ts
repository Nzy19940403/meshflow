import { ExecuteMeshRule } from "../dependency/useSetRule";
import { DefaultStrategy } from "../types/types";
// import { InternalKeys, DefaultStrategy } from "../types/types";

type ContractType = "boolean" | "scalar" | "array" | "object";

type validatorItem = {
  logic: (value: any) => any; //验证逻辑
  condition: (data: any) => boolean; //验证存在条件
  options?: any;
};

// ==========================================
// 🌟 1. 全局静态合并函数（保持纯函数，零闭包开销）
// ==========================================
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

// ==========================================
// 🌟 2. 全局单例策略字典：引入 resultContainer 彻底消灭元组分配
// ==========================================
const GLOBAL_STRATEGIES: Record<DefaultStrategy, (store: StrategyStore, api: any, version: number, checkRuleDirty: Function, resultContainer: any) => any> = {
  [DefaultStrategy.OR]: (store, api, version, checkRuleDirty, resultContainer) => {
    let res = undefined;
    let baseValue: any = undefined;
    const allRules = store._computedRules;

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store._getRuleResult(rule, api, checkRuleDirty);

      if (p instanceof Promise) {
        return (async () => {
          let val = await p;
          if (rule._entityId === "__base__") {
            baseValue = val;
          } else if (val) {
            res = val;
          }

          if (typeof res === "undefined") {
            for (let j = i + 1; j < allRules.length; j++) {
              const nextRule = allRules[j];
              const nextP = store._getRuleResult(nextRule, api, checkRuleDirty);
              const nextVal = nextP instanceof Promise ? await nextP : nextP;

              if (nextRule._entityId === "__base__") {
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
          resultContainer.res = res;
          resultContainer.version = version;
        })();
      }

      const val = p;
      if (rule._entityId === "__base__") {
        baseValue = val;
        continue;
      }
      if (val) {
        res = rule.value;
        break;
      }
    }

    if (typeof res === "undefined") res = baseValue;
    resultContainer.res = res;
    resultContainer.version = version;
  },

  [DefaultStrategy.PRIORITY]: (store, api, version, checkRuleDirty, resultContainer) => {
    let res = undefined;
    const allRules = store._computedRules;

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store._getRuleResult(rule, api, checkRuleDirty);

      if (p instanceof Promise) {
        return (async () => {
          const val = await p;
          if (val !== undefined) {
            resultContainer.res = rule.value !== undefined ? rule.value : val;
            resultContainer.version = version;
            return;
          }

          for (let j = i + 1; j < allRules.length; j++) {
            const nextRule = allRules[j];
            const nextP = store._getRuleResult(nextRule, api, checkRuleDirty);
            const nextVal = nextP instanceof Promise ? await nextP : nextP;
            if (nextVal !== undefined) {
              resultContainer.res = nextVal;
              resultContainer.version = version;
              return;
            }
          }
          resultContainer.res = undefined;
          resultContainer.version = version;
        })();
      }

      if (p !== undefined) {
        resultContainer.res = rule.value !== undefined ? rule.value : p;
        resultContainer.version = version;
        return;
      }
    }

    resultContainer.res = res;
    resultContainer.version = version;
  },

  [DefaultStrategy.MERGE]: (store, api, version, checkRuleDirty, resultContainer) => {
    let res: any = undefined;
    let baseValue: any = undefined;
    const allRules = store._computedRules;

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store._getRuleResult(rule, api, checkRuleDirty);

      if (p instanceof Promise) {
        return (async () => {
          let val = await p;

          const applyMerge = (r: any, v: any) => {
            if (r._entityId === "__base__") {
              baseValue = mergeData(baseValue, v);
            } else if (v) {
              const toMerge = r.value !== undefined ? r.value : v;
              res = mergeData(res, toMerge);
            }
          };

          applyMerge(rule, val);

          for (let j = i + 1; j < allRules.length; j++) {
            const nextRule = allRules[j];
            const nextP = store._getRuleResult(nextRule, api, checkRuleDirty);
            const nextVal = nextP instanceof Promise ? await nextP : nextP;
            applyMerge(nextRule, nextVal);
          }

          resultContainer.res = mergeData(res, baseValue);
          resultContainer.version = version;
        })();
      }

      const val = p;
      if (rule._entityId === "__base__") {
        baseValue = mergeData(baseValue, val);
        continue;
      }
      if (val) {
        const toMerge = rule.value !== undefined ? rule.value : val;
        res = mergeData(res, toMerge);
      }
    }

    resultContainer.res = mergeData(res, baseValue);
    resultContainer.version = version;
  }
};

// ==========================================
// 🌟 3. StrategyStore 类重构
// ==========================================
export class StrategyStore {
  /**
   * @internal
  */
  public _computedRules: any[] = [];
  
  private _CurrentStrategyType: DefaultStrategy; // 如果有 DefaultStrategy 枚举，请换回 DefaultStrategy.PRIORITY
  private _getRules: Function;

  constructor(getRule: Function) {
    this._getRules = getRule;
    this._CurrentStrategyType = DefaultStrategy.PRIORITY; // 或 DefaultStrategy.PRIORITY
    this._updateComputedRules();
  }
  /**
   * @internal
  */
  public _getRuleResult(rule: any, api: any, checkRuleDirty: Function): any {
    if (rule._entityId === "__base__") {
      return rule.logic(api);
    }
 
    let isDirty = !rule._hasRun || checkRuleDirty(rule.triggerUids);

    if (!isDirty) {
      api.iscache = true;
      return rule._lastResult;
    }
    
    // 注意：这里的 ExecuteMeshRule 是你外部定义好的 O(1) 函数
    const p = ExecuteMeshRule<any>(rule, api); 
    
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
  /**
   * @internal
  */
  public _updateComputedRules() {
    const list: any[] = this._getRules();

    if (
      this._CurrentStrategyType === DefaultStrategy.PRIORITY ||
      this._CurrentStrategyType === DefaultStrategy.MERGE 
    ) {
      this._computedRules = Array.from(list.values())
        .map((item) => Array.from(item as any))
        .flat<any>()
        .sort((a, b) => b.priority - a.priority);
    } else {
      this._computedRules = Array.from(list.values())
        .map((item) => Array.from(item as any))
        .flat();
    }
  }
  /**
   * @internal
  */
  public _setStrategy(type: any) {
    this._CurrentStrategyType = type;
    this._updateComputedRules();
  }

  /**
   * @internal
   * 透传 resultContainer 容器
  */
  public _evaluate(api: any, currentVersion: number, checkRuleDirty: Function, resultContainer: any) {
    const strategyFn = GLOBAL_STRATEGIES[this._CurrentStrategyType];
    return strategyFn(this, api, currentVersion, checkRuleDirty, resultContainer);
  }
}

 
/**
 * @internal
*/
export class SchemaBucket<P> {
  private _path: any;
  private _strategy: StrategyStore;
  
  public _contract: ContractType;

  private _rules = new Map<number, Set<{ logic: () => any }>>();
  private _id: number = 0;
  private _cache: any = undefined;
  private _pendingPromise: Promise<any> | null = null;
  private _version: number = 0;
  private _forceNotify: boolean = false;

  private _promiseToken: any = null;
  private _useCache: boolean = true;
  private _effectArray: { fn: (args: any) => any; args: any[] }[] = [];

  // 🌟 [新增] 高性能依赖存储：预分配 keys 数组
  private _deps: Map<number, { valObj: any; keys: string[] }> = new Map();
  // 🌟 [新增] 扁平化 UID 列表，消灭 Map.entries() 迭代器
  private _depUids: number[] = [];
  // 🌟 [新增] 复用的结果容器，消灭策略返回的临时对象
  private _evalResult = { res: undefined as any, version: 0 };

  // 原型绑定的 rules 获取方法
  private _getRulesInternal = () => this._rules;

  // 🌟 [新增] 将闭包固定为实例属性，整个生命周期只分配一次！
  private _boundCheckDirty = (triggerUids?: number[]) => {
    // 这里的 API 由外部上下文隐式提供（因为在这个上下文中 api 是不变的），
    // 但为了解耦，我们将 api 状态作为 evaluate 的上下文。
    // 为了完全避免闭包，我们在类上挂载一个瞬时的 _currentApi 引用供 checkDirty 使用。
    return this._checkRuleDirty(this._currentApi, triggerUids);
  };

  private _currentApi: any = null;

  constructor(baseValue: any, key: string | number | symbol, path: P) {
    this._strategy = new StrategyStore(this._getRulesInternal);
    this._path = path;
    this._contract = this._inferType(baseValue);
    this._cache = baseValue;

    this._setRule({
      priority: 0,
      _entityId: "__base__",
      logic: () => baseValue,
    } as any);
  }

  /**
   * @internal
   * */ 
  public _setUseCache(val: boolean) {
    this._useCache = val;
  }

  /**
   * @internal
   * */ 
  public _setForceNotify() {
    this._forceNotify = true;
  }
  /**
   * @internal
   * */ 
  public _isForceNotify() {
    return this._forceNotify;
  }
  public _syncCache(val:any){
    this._cache = val;
  }

  public _setStrategy(type: any) {
    this._strategy._setStrategy(type);
  }

  private _setDefaultRule(value: any) {
    const rules = new Set<{ logic: () => any }>();
    rules.add(value);
    this._rules.set(-1, rules);
  }

  // 🌟 [新增] O(1) 移除依赖方法
  private _removeDep(uid: number) {
    this._deps.delete(uid);
    const idx = this._depUids.indexOf(uid);
    if (idx !== -1) {
      const last = this._depUids.pop()!;
      if (idx < this._depUids.length) {
        this._depUids[idx] = last;
      }
    }
  }
  /**
   * @internal
  */
  public _setRules<TKeys = any>(
    value: { value: any; targetUid: number; triggerUids: number[]; priority: any; logic: any; _entityId?: any; },
    DepsArray?: Array<[number, Array<TKeys | any>, any]>
  ) {
 
    if (DepsArray) this._updateDeps(DepsArray);
    
    const _entityId = ++this._id;
    const ruleEntity = { ...value, _entityId };

    for (let uid of value.triggerUids) {
      if (!this._rules.has(uid)) this._rules.set(uid, new Set<any>());
      this._rules.get(uid)!.add(ruleEntity);
    }

    this._strategy._updateComputedRules();

    return () => {
      for (let uid of value.triggerUids) {
        const set = this._rules.get(uid);
        if (set) {
          set.delete(ruleEntity);
          if (set.size === 0) {
            this._rules.delete(uid);
            this._removeDep(uid); // 🌟 使用高性能移除
          }
        }
      }
      this._strategy._updateComputedRules();
    };
  }

  private _updateDeps<TKeys>(DepsArray: Array<[number, Array<TKeys | any>, any]>) {
    for (let i = 0; i < DepsArray.length; i++) {
      let [triggerUid, keys, proxy] = DepsArray[i];
      if (keys.length == 0) continue;

      let depTarget = this._deps.get(triggerUid);
      if (!depTarget) {
        depTarget = { valObj: Object.create(null), keys: [] }; // 🌟 预分配 keys 数组
        this._deps.set(triggerUid, depTarget);
        this._depUids.push(triggerUid); // 🌟 压入扁平数组
      }
   
      for (let j = 0; j < keys.length; j++) {
        let key = keys[j] as string;
        depTarget.valObj[key] = proxy[key];
        if (depTarget.keys.indexOf(key) === -1) {
          depTarget.keys.push(key);
        }
      }
    }
  }
  /**
   * @internal
  */
  public _setRule<TKeys = any>(
    value: { value: any; targetUid: number; triggerUids: number[]; priority: any; logic: any; _entityId?: any; },
    DepsArray?: Array<[number, Array<TKeys | any>, any]>
  ) {
    if (DepsArray) this._updateDeps(DepsArray);

    if (typeof value._entityId === "string") {
      this._setDefaultRule(value);
      return;
    }

    const _entityId = ++this._id;
    const ruleEntity = { ...value, _entityId };

    if (value) {
      for (let uid of value.triggerUids) {
        if (!this._rules.has(uid)) this._rules.set(uid, new Set<any>());
        this._rules.get(uid)!.add(ruleEntity);
      }
    }
    this._strategy._updateComputedRules();

    return () => {
      for (let uid of value.triggerUids) {
        const set = this._rules.get(uid);
        if (set) {
          set.delete(ruleEntity);
          if (set.size === 0) {
            this._rules.delete(uid);
            this._removeDep(uid); // 🌟 使用高性能移除
          }
        }
      }
      this._strategy._updateComputedRules();
    };
  }
  /**
   * @internal
  */
  public _setSideEffect(data: { fn: (args: any) => any; args: any[] }) {
    this._effectArray.push(data);
  }

  public _getSideEffect() {
    return [...this._effectArray];
  }

  // 🌟 使用扁平化 keys 缓存，消灭 Object.keys
  private _checkRuleDirty(api: any, triggerUids?: number[]) {
    if (!triggerUids || triggerUids.length === 0) return true;
    
    for (let i = 0; i < triggerUids.length; i++) {
      const uid = triggerUids[i];
      const depTarget = this._deps.get(uid);
      if (!depTarget) return true;
  
      const curState = api.getProxyByUid(uid);
      if (!curState) return true;
  
      const { valObj, keys } = depTarget;
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        const oldVal = valObj[key];
        const newVal = curState[key];
  
        if (oldVal === newVal) continue; // 引用一致，检查下一个 key
  
        // 只有引用不等时，才进入深度/浅度检查
        if (typeof oldVal !== 'object' || oldVal === null || 
            typeof newVal !== 'object' || newVal === null) {
          return true; 
        }
  
        // --- 高性能浅比较优化区 ---
        // 检查是否为数组
        const isArr = Array.isArray(oldVal);
        if (isArr !== Array.isArray(newVal)) return true;
  
        if (isArr) {
          if (oldVal.length !== newVal.length) return true;
          for (let k = 0; k < oldVal.length; k++) {
            if (oldVal[k] !== newVal[k]) return true;
          }
        } else {
          // 普通对象：使用 for...in 代替 Object.keys 以消灭中间数组分配
          let countOld = 0;
          let countNew = 0;
          for (const k in oldVal) {
            countOld++;
            if (oldVal[k] !== newVal[k]) return true;
          }
          for (const k in newVal) countNew++;
          if (countOld !== countNew) return true;
        }
      }
    }
    return false;
  }

 

  public _evaluate(api: any) {
    let curToken = null;
    if (api.GetToken) curToken = api.GetToken();

    if (this._pendingPromise && this._promiseToken !== curToken) {
      this._pendingPromise = null;
      this._promiseToken = null;
    }

    if (this._pendingPromise) {
      api.iscache = false; 
      return this._pendingPromise;
    }

    let shouldSkipCalculate = true;
 
    if (this._depUids.length === 0) {
      shouldSkipCalculate = false; // 没有依赖的节点（比如根节点），通常需要重算或依赖外部直接 set
    } else  {
       
      // 🌟 O(N) 扁平数组遍历，消灭迭代器
      for (let i = 0; i < this._depUids.length; i++) {
        let uid = this._depUids[i];
      
        let depTarget = this._deps.get(uid);
        let curState = api.getStateByUid(uid);

        if (!curState || !depTarget) {
          shouldSkipCalculate = false;
          break;
        }

        const { valObj, keys } = depTarget;
        for (let j = 0; j < keys.length; j++) {
          let key = keys[j];
          let oldVal = valObj[key];
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

    if (shouldSkipCalculate && this._useCache) {
      api.iscache = true;
      return this._cache
    };

    this._promiseToken = curToken;
    const currentVersion = ++this._version;

    api.iscache = false
    // 🌟 将 API 暂存到实例上供内部 CheckDirty 使用，彻底切断参数闭包！
    this._currentApi = api;

    /**
     * [BOT] 桶计算入口 — 带三层缓存的惰性求值 (详见类头注释)
     *
     * L1 并发去重: _pendingPromise 存在 → 返回同一 Promise (避免重复请求)
     * L2 依赖脏检查: 遍历 _depUids 扁平数组，ref 比较当前值 vs 快照
     * L3 缓存命中: shouldSkipCalculate && _useCache → 返回 _cache
     *
     * _finalizeSync 执行后更新所有依赖快照，为下次脏检查做准备
     */

    // 🌟 传入复用容器 this._evalResult
    const p = this._strategy._evaluate(api, currentVersion, this._boundCheckDirty, this._evalResult);

    if (!(p instanceof Promise)) {
      this._currentApi = null; // 用完即丢，防止内存泄露
      return this._finalizeSync(this._evalResult.res, this._evalResult.version, api, curToken);
    }

    this._pendingPromise = (async () => {
      try {
        await p; // 等待策略修改 this._evalResult
        return this._finalizeSync(this._evalResult.res, this._evalResult.version, api, curToken);
      } catch (err: any) {
        throw { path: this._path, error: err };
      } finally {
        if (this._promiseToken === curToken) {
          this._pendingPromise = null;
          this._promiseToken = null;
        }
        this._currentApi = null; // 异步结束后清理引用
      }
    })();

    return this._pendingPromise;
  }

  private _finalizeSync(res: any, version: number, api: any, curToken: any) {
    if (curToken !== this._promiseToken || version < this._version) {
      return this._cache;
    }
    this._cache = res;

    // 🌟 完全消灭 forEach 闭包 和 Object.keys 数组分配
    for (let i = 0; i < this._depUids.length; i++) {
      let uid = this._depUids[i];
      let depTarget = this._deps.get(uid);
      if (!depTarget) continue;

      const curState = api.getProxyByUid(uid);
      if (!curState) continue;

      const { valObj, keys } = depTarget;
      for (let j = 0; j < keys.length; j++) {
        let key = keys[j];
        valObj[key] = curState[key];
      }
    }

    return res;
  }

  private _inferType(val: any): ContractType {
    if (Array.isArray(val)) return "array";
    return typeof val as ContractType;
  }
}


export class ValidatorsBucket {
  validators: Array<validatorItem> = [];
  private defaultValidators: Array<validatorItem> = [];

  private path: string = "";
  constructor(path: string) {
    this.path = path;
    this._SetDefaultValidators();
  }

  public setValidators(validator: any) {
    this.validators.push(validator);
  }

  private _SetDefaultValidators() {
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

  public evaluate(newVal: any, schema: any) {
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



