

type ContractType = 'boolean' | 'scalar' | 'array' | 'object';

export enum DefaultStrategy {
    OR = 'OR',
    PRIORITY = 'PRIORITY',
    MERGE = 'MERGE'
}

type validatorItem = {
    logic: (value: any) => any; //验证逻辑
    condition: (data: any) => boolean; //验证存在条件
    options?: any
}


export class StrategyStore {

    private computedRules: any[] = [];

    private store: Record<DefaultStrategy, any> = {
        'OR': (api: any, version: number) => {
            let res = undefined;


            let baseValue: any = undefined;

            const allRules = this.computedRules

            for (let i = 0; i < allRules.length; i++) {
                const rule = allRules[i];
                const p = rule.logic(api);

                if (p instanceof Promise) {
                    // 发现异步规则！立即切断同步流，进入异步闭包
                    return (async () => {
                        let val = await p;
                        
                        
                        // 处理当前这个异步规则的结果
                        if (rule.entityId === '__base__') { baseValue = val; }
                        else if (val) { res = val; }
        
                        // 如果还没出结果，继续跑剩下的规则
                        if (typeof res === 'undefined') {
                            for (let j = i + 1; j < allRules.length; j++) {
                                const nextRule = allRules[j];
                                const nextP = nextRule.logic(api);
                                const nextVal = (nextP instanceof Promise) ? await nextP : nextP;
        
                                if (nextRule.entityId === '__base__') { baseValue = nextVal; continue; }
                                if (nextVal) { res = nextRule.value; break; }
                            }
                        }
        
                        if (typeof res === 'undefined') res = baseValue;
                        return { res, version };
                    })();
                }

                const val = p;

                // const val = await rule.logic(api);

                if (rule.entityId === '__base__') {
                    baseValue = val;
                    continue;
                };

                if (val) {
                    //是or的时候只要有个rule返回了true，就返回它options里面定义的value
                    res = rule.value;

                    break;
                }
            }
      
            if (typeof res === 'undefined') {
                res = baseValue
            }

            return { res, version }
        },
        'PRIORITY': (api: any, version: number) => {
            let res = undefined;
            const allRules = this.computedRules
            
            for (let i = 0; i < allRules.length; i++) {
                const rule = allRules[i];
                const p = rule.logic(api);
                
                if (p instanceof Promise) {
                    // 异步切断点
                    return (async () => {
                        const val = await p;
                        if (val !== undefined) return { res: val, version };
        
                        // 继续跑剩下的
                        for (let j = i + 1; j < allRules.length; j++) {
                            const nextP = allRules[j].logic(api);
                            const nextVal = (nextP instanceof Promise) ? await nextP : nextP;
                            if (nextVal !== undefined) return { res: nextVal, version };
                        }
                        return { res: undefined, version };
                    })();
                }
        
                // --- 同步路径 ---
                if (p !== undefined) {
                    return { res: p, version }; // 直接同步截断返回
                }
            }
        
            return { res, version };
        },
        'MERGE': (api: any, version: number) => {
            let res: any = undefined;
            let baseValue: any = undefined;
            const allRules = this.computedRules;

            // 🌟 核心：通用合并器。
            // 因为遍历是从高优先级 -> 低优先级，所以 target(高优先级) 应该覆盖 source(低优先级)
            const mergeData = (target: any, source: any) => {
                if (target === undefined) return source;
                if (source === undefined) return target;
                
                if (Array.isArray(target) && Array.isArray(source)) {
                    return [...source, ...target]; // 数组合并
                }
                if (typeof target === 'object' && typeof source === 'object') {
                    return { ...source, ...target }; // 对象浅合并：高优先级的 target 在后，覆盖 source
                }
                return target; // 基本类型冲突时，保留高优先级
            };

            for (let i = 0; i < allRules.length; i++) {
                const rule = allRules[i];
                const p = rule.logic(api);

                if (p instanceof Promise) {
                    return (async () => {
                        let val = await p;

                        // 定义闭包内复用的合并逻辑
                        const applyMerge = (r: any, v: any) => {
                            if (r.entityId === '__base__') {
                                baseValue = mergeData(baseValue, v);
                            } else if (v) {
                                // 如果触发，优先取 rule.value，否则直接用逻辑函数返回的对象
                                const toMerge = r.value !== undefined ? r.value : v;
                                res = mergeData(res, toMerge);
                            }
                        };

                        applyMerge(rule, val);

                        // 异步等待后续所有规则，不 break
                        for (let j = i + 1; j < allRules.length; j++) {
                            const nextRule = allRules[j];
                            const nextP = nextRule.logic(api);
                            const nextVal = (nextP instanceof Promise) ? await nextP : nextP;
                            applyMerge(nextRule, nextVal);
                        }

                        // 最后将基础值 baseValue 作为最低优先级垫底合并
                        const finalRes = mergeData(res, baseValue);
                        return { res: finalRes, version };
                    })();
                }

                // --- 同步路径 ---
                const val = p;
                
                if (rule.entityId === '__base__') {
                    baseValue = mergeData(baseValue, val);
                    continue;
                }

                if (val) {
                    const toMerge = rule.value !== undefined ? rule.value : val;
                    res = mergeData(res, toMerge);
                }
            }

            // 同步结算
            const finalRes = mergeData(res, baseValue);
            return { res: finalRes, version };
        }
    }

    private CurrentStrategy: Function = () => { }

    private CurrentStrategyType:DefaultStrategy = DefaultStrategy.PRIORITY;

    private getRules: Function = () => { }

    // private getBaseRules: Function = () => { }

    constructor(getRule: Function) {
        this.getRules = getRule;
        this.CurrentStrategy = this.store.PRIORITY;
        this.updateComputedRules()
    }

    updateComputedRules() {
        const list: any[] = this.getRules();

        if (this.CurrentStrategyType === DefaultStrategy.PRIORITY || this.CurrentStrategyType === DefaultStrategy.MERGE) {
            this.computedRules = Array.from(list.values()).map(item => Array.from(item)).flat<any>().sort((a, b) => b.priority - a.priority);
        } else {
            this.computedRules = Array.from(list.values()).map(item => Array.from(item)).flat();
        }
    }

    setStrategy(type: DefaultStrategy) {
        this.CurrentStrategyType = type;

        this.CurrentStrategy = this.store[type];
        this.updateComputedRules()
    }

    evaluate(api: any, currentVersion: number) {
        
        return this.CurrentStrategy(api, currentVersion)
    }
}

export class SchemaBucket<P>{

    private path: any;

    private strategy: StrategyStore;

    public contract: ContractType;

    private rules = new Map<number, Set<{ logic: () => any }>>();

    //分辨绑定的key是否是value
    private isValue = false;

    private id: number = 0;

    private cache: any = undefined;

    private pendingPromise: Promise<any> | null = null;

    private version: number = 0;

    private deps: Map<number, any> = new Map();
    //强制通知下游，优化的策略
    private _forceNotify: boolean = false;

    promiseToken: any = null;

    useCache:boolean = true;

    private effectArray:{fn:(args:any)=>any,args:any[]}[] = []

    constructor(baseValue: any, key: string|number|symbol, path: P) {
        const getRule = () => this.rules
        this.strategy = new StrategyStore(getRule)
        this.path = path;
        this.isValue = key === 'value';

        this.contract = this.inferType(baseValue);

        this.cache = baseValue;
        //生成默认规则，在所有规则失效的时候兜底

        //如果生成的是value的bucket，后面还需要加上user_input的rule，来实现回退
        this.setRule({
            priority: 0,
            entityId: '__base__',
            logic: () => baseValue
        } as any);
 
    }

    setUseCache(val:boolean){
        this.useCache = val;
    }

    forceNotify() {

        this._forceNotify = true;
    }
    isForceNotify() {

        return this._forceNotify;
    }
    setStrategy(type: DefaultStrategy) {
        this.strategy.setStrategy(type)
    }

    // updateInputValueRule(newVal: any) {
    //     if (!this.isValue) return;
    //     this.setRule({
    //         priority: 1,
    //         entityId: '__input_value__',
    //         logic: () => newVal
    //     });
    // }

    setDefaultRule(value: any) {
        const rules = new Set<{ logic: () => any }>();
        rules.add(value);

        // -1代表默认rule
        this.rules.set(-1, rules);
    }

    setRules(value: {
        value: any,
        targetUid:number,
        triggerUids: number[],
        priority: any
        logic:any,
        entityId?:any
    }, DepsArray?: Array<[number, any]>) {
        if (DepsArray) {
            this.updateDeps(DepsArray)
        }
        const entityId = ++this.id;
        // 2. 创建规则实体

        const ruleEntity = {
            ...value,
            entityId,
        };

        for (let uid of value.triggerUids) {
            if (!this.rules.has(uid)) {
                this.rules.set(uid, new Set<any>());
            };
            this.rules.get(uid)!.add(ruleEntity);
        };

        this.strategy.updateComputedRules();

        //返回删除对应rule的方法
        return () => {

            for (let uid of value.triggerUids) {
                const set = this.rules.get(uid);
                if (set) {
                    // O(1) 复杂度，直接移除引用
                    set.delete(ruleEntity);

                    // 极致优化：如果 Set 空了，释放内存
                    if (set.size === 0) {
                        this.rules.delete(uid);
                        this.deps.delete(uid);
                    };
                };
            };
            this.strategy.updateComputedRules()
        };
    };

    updateDeps(DepsArray: Array<[number, any]>) {

        for (let [triggerUid, value] of DepsArray) {
            this.deps.set(triggerUid, value)
        }
    }

    setRule(value: {
        value: any,
        targetUid:number,
        triggerUids: number[],
        priority: any
        logic:any,
        entityId?:any
    }, DepsArray?: Array<[number, any]>) {

        //如果是内部调用，DepsArray是没有值的，那就按照默认的逻辑执行。如果传入DepsArray，就是外界注册setRule的时候传入的，需要记录一下
        //当前的桶关联了哪些path，这些path的value会被记录下来当作依赖，变化了之后会执行计算，没有变化就返回cache
        if (DepsArray) {
            this.updateDeps(DepsArray)
        }


        //需要避开默认的rule，因为默认的rule也会调用次方法添加rule,默认的rule的id是字符串，用户添加的rule的id是数值类型
        if (typeof value.entityId === 'string') {
            this.setDefaultRule(value)
            return;
        }

        const entityId = ++this.id;

        // 2. 创建规则实体

        const ruleEntity = {
            ...value,
            entityId,
        };

        if (value)

            for (let uid of value.triggerUids) {
                if (!this.rules.has(uid)) {
                    this.rules.set(uid, new Set<any>());
                }
                this.rules.get(uid)!.add(ruleEntity)
            };
        this.strategy.updateComputedRules();
        //返回删除对应rule的方法
        return () => {

            for (let uid of value.triggerUids) {
                const set = this.rules.get(uid);
                if (set) {
                    // O(1) 复杂度，直接移除引用
                    set.delete(ruleEntity);

                    // 极致优化：如果 Set 空了，释放内存
                    if (set.size === 0) {
                        this.rules.delete(uid);
                        this.deps.delete(uid);
                    };
                };
            };
            this.strategy.updateComputedRules()
        };

    };
    setSideEffect(data:{fn:(args:any[])=>any,args:any[]}){
        this.effectArray.push(data);
    };
    getSideEffect(){
       
        return [...this.effectArray]
    }

    evaluate(api: any) {
         
        let curToken = null;
         
        if (api.GetToken) {
            curToken = api.GetToken();
        }
        
        if (this.pendingPromise && this.promiseToken !== curToken) {
            // console.log(`[桶身份失效] 票号变了，抛弃旧 Promise`);

            this.pendingPromise = null;
            this.promiseToken = null;
        }

        if (this.pendingPromise) {
            // console.log("✅ 命中性能优化：复用相同 Token 的 Promise");
            return this.pendingPromise;
        }

        //把这个移出来看看能否把异步变成同步
        let shouldSkipCalculate = false;
        //当不是从notifyAll触发的时候
        if (typeof api.triggerUid === 'number') {
            shouldSkipCalculate = true;
 

            let oldVal = this.deps.get(api.triggerUid);
 
            let curVal = api.getStateByUid(api.triggerUid)

            // 2. 打印直接触发者的对比
            // console.log(`   └─ 触发路径对比: ${api.triggerPath} | 旧值:`, oldVal, " | 新值:", curVal);

            if (typeof oldVal === 'object' || typeof curVal === 'object') {
                shouldSkipCalculate = false;
            } else {

                let paths = Array.from(this.deps.keys());
                for (let path of paths) {
                    let oldVal = this.deps.get(path);
                    // let curVal = api.GetValueByPath(path);
                    let curVal = api.getStateByUid(path);
                    if (oldVal !== curVal) {
                        // console.log(`   %c └─ 判定: 发现差异路径 ${path} | ${oldVal} -> ${curVal} | 执行重算`, "color: #f56c6c");
                        shouldSkipCalculate = false;

                        break;
                    }
                }
            }
        }

        if (shouldSkipCalculate && this.useCache) {

            // console.log(`%c [⚡️高速缓存] ${this.path} 命中! 缓存值:`, "color: #409EFF", this.cache);
            return this.cache
        }

        this.promiseToken = curToken;
        const currentVersion = ++this.version;

        const p = this.strategy.evaluate(api, currentVersion)
        
        // 🔥🔥🔥 核心优化点：探测同步结果 🔥🔥🔥
        if (!(p instanceof Promise)) {
            
            // 如果规则全是同步的，直接在这里结算并返回结果
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

    // 提取出的同步结算方法
    private finalizeSync(res: any, version: number, api: any, curToken: any) {
        if (curToken !== this.promiseToken || version < this.version) {
            return this.cache;
        }
        // ... (类型检查逻辑) ...
        this.cache = res;
        // 更新依赖快照 (同步)
        this.deps.forEach((_, path) => {
          
            this.deps.set(path, api.getProxyByUid(path));
        });
        return res;
    }

    private inferType(val: any): ContractType {
        if (Array.isArray(val)) return 'array';
        return typeof val as ContractType;
    }

}

export class ValidatorsBucket {
    validators: Array<validatorItem> = [];
    defaultValidators: Array<validatorItem> = [];

    private path: string = ''
    constructor(path: string) {
        this.path = path;
        this.SetDefaultValidators()
    }

    setValidators(validator: any) {
        this.validators.push(validator)
    }

    SetDefaultValidators() {
        const requireValidator: validatorItem = {
            logic: (value) => {
                if (value) return true;

                //如果是数值型，设置为0也不能返回required报错
                if (typeof value === 'number') return true

                return `${this.path} undefined`
            },
            condition: (data) => {
                return !!data.required
            }
        };

        const maxLengthValidator: validatorItem = {
            logic: function (value) {

                if (value.length > this.options.maxLength) return `Too long:${this.options.maxLength}`

                return true
            },
            condition: function (data) {
                if (typeof data.maxLength !== 'number') return false
                maxLengthValidator.options = {
                    maxLength: data.maxLength
                }
                return data.type === 'input'
                    && data.hidden === false
            },
            options: {}
        }


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


            if (typeof val !== 'boolean') {
                res = val;
                break
            }
        }

        return res;
    }
}