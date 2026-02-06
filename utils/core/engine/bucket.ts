

type ContractType = 'boolean' | 'scalar' | 'array' | 'object';

export enum DefaultStarategy {
    OR = 'OR',
    PRIORITY = 'PRIORITY',
}

type validatorItem = {
    logic: (value: any) => any; //验证逻辑
    condition: (data: any) => boolean; //验证存在条件
    options?: any
}


export class StrategyStore {

    private computedRules: any[] = [];

    private store: Record<DefaultStarategy, any> = {
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
                        else if (val) { res = rule.value; }
        
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

            // console.log(res)

            if (typeof res === 'undefined') {
                res = baseValue
            }

            return { res, version }
        },
        'PRIORITY': (api: any, version: number) => {
            let res = null;
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
        }
    }

    private CurrentStrategy: Function = () => { }

    private CurrentStrategyType: 'PRIORITY' | 'OR' = 'PRIORITY';

    private getRules: Function = () => { }

    // private getBaseRules: Function = () => { }

    constructor(getRule: Function) {
        this.getRules = getRule;
        this.CurrentStrategy = this.store.PRIORITY;
        this.updateComputedRules()
    }

    updateComputedRules() {
        const list: any[] = this.getRules();

        if (this.CurrentStrategyType === 'PRIORITY') {
            this.computedRules = Array.from(list.values()).map(item => Array.from(item)).flat<any>().sort((a, b) => b.priority - a.priority);
        } else {
            this.computedRules = Array.from(list.values()).map(item => Array.from(item)).flat();
        }
    }

    setStrategy(type: DefaultStarategy) {
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

    private rules = new Map<string, Set<{ logic: () => any }>>();

    //分辨绑定的key是否是defaultValue
    private isDefaultValue = false;

    private id: number = 0;

    private cache: any = undefined;

    private pendingPromise: Promise<any> | null = null;

    private version: number = 0;

    private deps: Map<P, any> = new Map();
    //强制通知下游，优化的策略
    private _forceNotify: boolean = false;

    promiseToken: any = null;

    globalCalcCount = 0

    constructor(baseValue: any, key: string, path: P) {
        const getRule = () => this.rules
        this.strategy = new StrategyStore(getRule)
        this.path = path;
        this.isDefaultValue = key === 'defaultValue';

        this.contract = this.inferType(baseValue);

        this.cache = baseValue;
        //生成默认规则，在所有规则失效的时候兜底

        //如果生成的是defaultValue的bucket，后面还需要加上user_input的rule，来实现回退
        this.setRule({
            priority: 0,
            entityId: '__base__',
            logic: () => baseValue
        });


    }

    forceNotify() {

        this._forceNotify = true;
    }
    isForceNotify() {

        return this._forceNotify;
    }
    setStrategy(type: DefaultStarategy) {
        this.strategy.setStrategy(type)
    }

    updateInputValueRule(newVal: any) {
        if (!this.isDefaultValue) return;
        this.setRule({
            priority: 1,
            entityId: '__input_value__',
            logic: () => newVal
        });
    }

    setDefaultRule(value: any) {
        const rules = new Set<{ logic: () => any }>();
        rules.add(value);
        this.rules.set(value.id, rules);
    }

    setRules(value: any, DepsArray?: Array<[P, any]>) {
        if (DepsArray) {
            this.updateDeps(DepsArray)
        }
        const entityId = ++this.id;
        // 2. 创建规则实体

        const ruleEntity = {
            ...value,
            entityId,
        };

        for (let path of value.triggerPaths) {
            if (!this.rules.has(path)) {
                this.rules.set(path, new Set<any>());
            };
            this.rules.get(path)!.add(ruleEntity);
        };

        this.strategy.updateComputedRules();

        //返回删除对应rule的方法
        return () => {

            for (let path of value.triggerPaths) {
                const set = this.rules.get(path);
                if (set) {
                    // O(1) 复杂度，直接移除引用
                    set.delete(ruleEntity);

                    // 极致优化：如果 Set 空了，释放内存
                    if (set.size === 0) {
                        this.rules.delete(path);
                        this.deps.delete(path);
                    };
                };
            };
            this.strategy.updateComputedRules()
        };
    };

    updateDeps(DepsArray: Array<[P, any]>) {

        for (let [triggerPath, value] of DepsArray) {
            this.deps.set(triggerPath, value)
        }
    }

    setRule(value: any, DepsArray?: Array<[P, any]>) {

        //如果是内部调用，DepsArray是没有值的，那就按照默认的逻辑执行。如果传入DepsArray，就是外界注册setRule的时候传入的，需要记录一下
        //当前的桶关联了哪些path，这些path的defaultValue会被记录下来当作依赖，变化了之后会执行计算，没有变化就返回cache
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

            for (let path of value.triggerPaths) {
                if (!this.rules.has(path)) {
                    this.rules.set(path, new Set<any>());
                }
                this.rules.get(path)!.add(ruleEntity)
            };
        this.strategy.updateComputedRules();
        //返回删除对应rule的方法
        return () => {

            for (let path of value.triggerPaths) {
                const set = this.rules.get(path);
                if (set) {
                    // O(1) 复杂度，直接移除引用
                    set.delete(ruleEntity);

                    // 极致优化：如果 Set 空了，释放内存
                    if (set.size === 0) {
                        this.rules.delete(path);
                        this.deps.delete(path);
                    };
                };
            };
            this.strategy.updateComputedRules()
        };

    };


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
        if (typeof api.triggerPath === 'string') {
            shouldSkipCalculate = true;

            // // 1. 打印触发源
            // console.log(`%c [桶预检] ${this.path}`, "color: #e6a23c; font-weight: bold;", {
            //     triggerPath: api.triggerPath,
            //     curToken: curToken
            // });

            let oldVal = this.deps.get(api.triggerPath);
            let curVal = api.GetValueByPath(api.triggerPath)

            // 2. 打印直接触发者的对比
            // console.log(`   └─ 触发路径对比: ${api.triggerPath} | 旧值:`, oldVal, " | 新值:", curVal);

            if (typeof oldVal === 'object' || typeof curVal === 'object') {
                shouldSkipCalculate = false;
            } else {

                let paths = Array.from(this.deps.keys());
                for (let path of paths) {
                    let oldVal = this.deps.get(path);
                    let curVal = api.GetValueByPath(path);
                    if (oldVal !== curVal) {
                        // console.log(`   %c └─ 判定: 发现差异路径 ${path} | ${oldVal} -> ${curVal} | 执行重算`, "color: #f56c6c");
                        shouldSkipCalculate = false;

                        break;
                    }
                }
            }
        }

        if (shouldSkipCalculate) {

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
            this.deps.set(path, api.GetValueByPath(path));
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

                return `${this.path}不能为空`
            },
            condition: (data) => {
                return !!data.required
            }
        };

        const maxLengthValidator: validatorItem = {
            logic: function (value) {

                if (value.length > this.options.maxLength) return `超出最大长度，最大长度为${this.options.maxLength}`

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