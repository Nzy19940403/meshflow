import { ExecuteMeshRule } from "../dependency/useSetRule";
import { InternalKeys, DefaultStrategy } from "../types/types";

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
const GLOBAL_STRATEGIES: Record<string, (store: StrategyStore, api: any, version: number, checkRuleDirty: Function, resultContainer: any) => any> = {
  OR: (store, api, version, checkRuleDirty, resultContainer) => {
    let res = undefined;
    let baseValue: any = undefined;
    const allRules = store.computedRules;

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
          resultContainer.res = res;
          resultContainer.version = version;
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

    if (typeof res === "undefined") res = baseValue;
    resultContainer.res = res;
    resultContainer.version = version;
  },

  PRIORITY: (store, api, version, checkRuleDirty, resultContainer) => {
    let res = undefined;
    const allRules = store.computedRules;

    for (let i = 0; i < allRules.length; i++) {
      const rule = allRules[i];
      const p = store.getRuleResult(rule, api, checkRuleDirty);

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
            const nextP = store.getRuleResult(nextRule, api, checkRuleDirty);
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

  MERGE: (store, api, version, checkRuleDirty, resultContainer) => {
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

          resultContainer.res = mergeData(res, baseValue);
          resultContainer.version = version;
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

    resultContainer.res = mergeData(res, baseValue);
    resultContainer.version = version;
  }
};

// ==========================================
// 🌟 3. StrategyStore 类重构
// ==========================================
export class StrategyStore {
  public computedRules: any[] = [];
  
  private CurrentStrategyType: any; // 如果有 DefaultStrategy 枚举，请换回 DefaultStrategy.PRIORITY
  private getRules: Function;

  constructor(getRule: Function) {
    this.getRules = getRule;
    this.CurrentStrategyType = "PRIORITY"; // 或 DefaultStrategy.PRIORITY
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
    
    // 注意：这里的 ExecuteMeshRule 是你外部定义好的 O(1) 函数
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
      this.CurrentStrategyType === "PRIORITY" ||
      this.CurrentStrategyType === "MERGE"
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

  setStrategy(type: any) {
    this.CurrentStrategyType = type;
    this.updateComputedRules();
  }

  // 🌟 透传 resultContainer 容器
  evaluate(api: any, currentVersion: number, checkRuleDirty: Function, resultContainer: any) {
    const strategyFn = GLOBAL_STRATEGIES[this.CurrentStrategyType as string];
    return strategyFn(this, api, currentVersion, checkRuleDirty, resultContainer);
  }
}

// ==========================================
// 🌟 4. SchemaBucket 类终极防抖重构
// ==========================================
export class SchemaBucket<P> {
  private path: any;
  private strategy: StrategyStore;
  
  public contract: ContractType;

  private rules = new Map<number, Set<{ logic: () => any }>>();
  private id: number = 0;
  private cache: any = undefined;
  private pendingPromise: Promise<any> | null = null;
  private version: number = 0;
  private _forceNotify: boolean = false;

  promiseToken: any = null;
  useCache: boolean = true;
  private effectArray: { fn: (args: any) => any; args: any[] }[] = [];

  // 🌟 [新增] 高性能依赖存储：预分配 keys 数组
  private deps: Map<number, { valObj: any; keys: string[] }> = new Map();
  // 🌟 [新增] 扁平化 UID 列表，消灭 Map.entries() 迭代器
  private _depUids: number[] = [];
  // 🌟 [新增] 复用的结果容器，消灭策略返回的临时对象
  private _evalResult = { res: undefined as any, version: 0 };

  // 原型绑定的 rules 获取方法
  private _getRulesInternal = () => this.rules;

  // 🌟 [新增] 将闭包固定为实例属性，整个生命周期只分配一次！
  private _boundCheckDirty = (triggerUids?: number[]) => {
    // 这里的 API 由外部上下文隐式提供（因为在这个上下文中 api 是不变的），
    // 但为了解耦，我们将 api 状态作为 evaluate 的上下文。
    // 为了完全避免闭包，我们在类上挂载一个瞬时的 _currentApi 引用供 checkDirty 使用。
    return this._checkRuleDirty(this._currentApi, triggerUids);
  };

  private _currentApi: any = null;

  constructor(baseValue: any, key: string | number | symbol, path: P) {
    this.strategy = new StrategyStore(this._getRulesInternal);
    this.path = path;
    this.contract = this.inferType(baseValue);
    this.cache = baseValue;

    this.setRule({
      priority: 0,
      entityId: "__base__",
      logic: () => baseValue,
    } as any);
  }

  setUseCache(val: boolean) {
    this.useCache = val;
  }

  forceNotify() {
    this._forceNotify = true;
  }

  isForceNotify() {
    return this._forceNotify;
  }

  setStrategy(type: any) {
    this.strategy.setStrategy(type);
  }

  setDefaultRule(value: any) {
    const rules = new Set<{ logic: () => any }>();
    rules.add(value);
    this.rules.set(-1, rules);
  }

  // 🌟 [新增] O(1) 移除依赖方法
  private _removeDep(uid: number) {
    this.deps.delete(uid);
    const idx = this._depUids.indexOf(uid);
    if (idx !== -1) {
      const last = this._depUids.pop()!;
      if (idx < this._depUids.length) {
        this._depUids[idx] = last;
      }
    }
  }

  setRules<TKeys = any>(
    value: { value: any; targetUid: number; triggerUids: number[]; priority: any; logic: any; entityId?: any; },
    DepsArray?: Array<[number, Array<TKeys | any>, any]>
  ) {
    if (DepsArray) this.updateDeps(DepsArray);
    
    const entityId = ++this.id;
    const ruleEntity = { ...value, entityId };

    for (let uid of value.triggerUids) {
      if (!this.rules.has(uid)) this.rules.set(uid, new Set<any>());
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
            this._removeDep(uid); // 🌟 使用高性能移除
          }
        }
      }
      this.strategy.updateComputedRules();
    };
  }

  updateDeps<TKeys>(DepsArray: Array<[number, Array<TKeys | any>, any]>) {
    for (let i = 0; i < DepsArray.length; i++) {
      let [triggerUid, keys, proxy] = DepsArray[i];
      if (keys.length == 0) continue;

      let depTarget = this.deps.get(triggerUid);
      if (!depTarget) {
        depTarget = { valObj: Object.create(null), keys: [] }; // 🌟 预分配 keys 数组
        this.deps.set(triggerUid, depTarget);
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

  setRule<TKeys = any>(
    value: { value: any; targetUid: number; triggerUids: number[]; priority: any; logic: any; entityId?: any; },
    DepsArray?: Array<[number, Array<TKeys | any>, any]>
  ) {
    if (DepsArray) this.updateDeps(DepsArray);

    if (typeof value.entityId === "string") {
      this.setDefaultRule(value);
      return;
    }

    const entityId = ++this.id;
    const ruleEntity = { ...value, entityId };

    if (value) {
      for (let uid of value.triggerUids) {
        if (!this.rules.has(uid)) this.rules.set(uid, new Set<any>());
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
            this._removeDep(uid); // 🌟 使用高性能移除
          }
        }
      }
      this.strategy.updateComputedRules();
    };
  }

  setSideEffect(data: { fn: (args: any[]) => any; args: any[] }) {
    this.effectArray.push(data);
  }

  getSideEffect() {
    return [...this.effectArray];
  }

  // 🌟 使用扁平化 keys 缓存，消灭 Object.keys
  private _checkRuleDirty(api: any, triggerUids?: number[]) {
    if (!triggerUids || triggerUids.length === 0) return true;

    for (let i = 0; i < triggerUids.length; i++) {
      let uid = triggerUids[i];
      let depTarget = this.deps.get(uid);
      if (!depTarget) return true;

      let curState = api.getProxyByUid(uid);
      if (!curState) return true;

      const { valObj, keys } = depTarget;
      for (let j = 0; j < keys.length; j++) {
        let key = keys[j];
        let oldVal = valObj[key];
        let newVal = curState[key];

        if (typeof oldVal === "object" && oldVal !== null) return true;
        if (oldVal !== newVal) return true;
      }
    }
    return false;
  }

  evaluate(api: any) {
    let curToken = null;
    if (api.GetToken) curToken = api.GetToken();

    if (this.pendingPromise && this.promiseToken !== curToken) {
      this.pendingPromise = null;
      this.promiseToken = null;
    }

    if (this.pendingPromise) return this.pendingPromise;

    let shouldSkipCalculate = false;

    if (typeof api.triggerUid === "number") {
      shouldSkipCalculate = true;
      if (this._depUids.length == 0) shouldSkipCalculate = false;

      // 🌟 O(N) 扁平数组遍历，消灭迭代器
      for (let i = 0; i < this._depUids.length; i++) {
        let uid = this._depUids[i];
        let depTarget = this.deps.get(uid);
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

    if (shouldSkipCalculate && this.useCache) return this.cache;

    this.promiseToken = curToken;
    const currentVersion = ++this.version;

    // 🌟 将 API 暂存到实例上供内部 CheckDirty 使用，彻底切断参数闭包！
    this._currentApi = api;
    
    // 🌟 传入复用容器 this._evalResult
    const p = this.strategy.evaluate(api, currentVersion, this._boundCheckDirty, this._evalResult);

    if (!(p instanceof Promise)) {
      this._currentApi = null; // 用完即丢，防止内存泄露
      return this.finalizeSync(this._evalResult.res, this._evalResult.version, api, curToken);
    }

    this.pendingPromise = (async () => {
      try {
        await p; // 等待策略修改 this._evalResult
        return this.finalizeSync(this._evalResult.res, this._evalResult.version, api, curToken);
      } catch (err: any) {
        throw { path: this.path, error: err };
      } finally {
        if (this.promiseToken === curToken) {
          this.pendingPromise = null;
          this.promiseToken = null;
        }
        this._currentApi = null; // 异步结束后清理引用
      }
    })();

    return this.pendingPromise;
  }

  private finalizeSync(res: any, version: number, api: any, curToken: any) {
    if (curToken !== this.promiseToken || version < this.version) {
      return this.cache;
    }
    this.cache = res;

    // 🌟 完全消灭 forEach 闭包 和 Object.keys 数组分配
    for (let i = 0; i < this._depUids.length; i++) {
      let uid = this._depUids[i];
      let depTarget = this.deps.get(uid);
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



