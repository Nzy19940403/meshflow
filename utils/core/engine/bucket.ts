

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

    private computedRules:any[] = [];

    private store: Record<DefaultStarategy, any> = {
        'OR': async (api: any, version: number) => {
            let res = undefined;
 

            let baseValue: any = undefined;

            const allRules = this.computedRules

            for (let rule of allRules) {

                const val = await rule.logic(api);
                
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
        'PRIORITY': async (api: any, version: number) => {
            let res = null;
            const allRules = this.computedRules

            

            try{
                for (const rule of allRules) {

                    const val = await rule.logic(api);
                    // 💡 核心：如果当前规则返回 undefined，表示它“弃权”，看下一个
                    if (val !== undefined) {
                        res = val;
                        break; // 找到了最高优先级的有效意见，跳出循环
                    }
                };
            }catch(err){
                throw err;
            }
            
            return { res, version };
        }
    }

    private CurrentStrategy: Function = () => { }

    private CurrentStrategyType:'PRIORITY'|'OR' = 'PRIORITY';

    private getRules: Function = () => { }

    // private getBaseRules: Function = () => { }

    constructor(getRule: Function) {
        this.getRules = getRule;
        this.CurrentStrategy = this.store.PRIORITY;
        this.updateComputedRules()
    }

    updateComputedRules(){
        const list: any[] = this.getRules();
         
        if(this.CurrentStrategyType==='PRIORITY'){
            this.computedRules = Array.from(list.values()).map(item => Array.from(item)).flat<any>().sort((a, b) => b.priority - a.priority);
        }else{
            this.computedRules = Array.from(list.values()).map(item => Array.from(item)).flat();
        }
    }

    setStrategy(type: DefaultStarategy) {
        this.CurrentStrategy = this.store[type];
        this.updateComputedRules()
    }

    evaluate(api:any, currentVersion:number) {
        return this.CurrentStrategy(api,currentVersion)
    }
}

export class SchemaBucket<P>{
   
    private path:any;

    private strategy: StrategyStore;

    public contract: ContractType;

    private rules = new Map<string, Set<{ logic: () => any }>>();

    //分辨绑定的key是否是defaultValue
    private isDefaultValue = false;

    private id: number = 0;

    private cache: any = undefined;

    private pendingPromise: Promise<any> | null = null;

    private version: number = 0;

    private deps:Map<P,any> = new Map();
    //强制通知下游，优化的策略
    private _forceNotify:boolean = false;

    promiseToken:any = null;

    globalCalcCount = 0

    constructor(baseValue: any,key:string,path:P) {
        const getRule = () => this.rules
        this.strategy = new StrategyStore(getRule)
        this.path = path;
        this.isDefaultValue = key==='defaultValue';

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

    forceNotify(){
       
        this._forceNotify = true;
    }
    isForceNotify(){
         
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

    setRules(value: any,DepsArray?:Array<[P,any]>) {
        if(DepsArray){
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

    updateDeps( DepsArray:Array<[P,any]> ){
       
        for(let [triggerPath,value] of DepsArray){
            this.deps.set(triggerPath,value)
        }
    }

    setRule(value: any,DepsArray?:Array<[P,any]>) {
        
        //如果是内部调用，DepsArray是没有值的，那就按照默认的逻辑执行。如果传入DepsArray，就是外界注册setRule的时候传入的，需要记录一下
        //当前的桶关联了哪些path，这些path的defaultValue会被记录下来当作依赖，变化了之后会执行计算，没有变化就返回cache
        if(DepsArray){
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

        if(value)

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
 

    async evaluate(api: any) {
    
        let curToken  = null;

        if(api.GetToken){
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
        
        this.promiseToken = curToken;
        const currentVersion = ++this.version;

        this.pendingPromise = (async () => {
            
            // const taskVersion = currentVersion;
            try {
                
                await Promise.resolve();
                // const currentVersion = ++this.version;

              

                let shouldSkipCalculate = false;
               
                //当不是从notifyAll触发的时候
                if(typeof api.triggerPath === 'string'){
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

                    if( typeof oldVal === 'object'|| typeof curVal === 'object' ){
                        shouldSkipCalculate = false;     
                    }else{
             
                        let paths = Array.from(this.deps.keys());
                        for(let path of paths){
                            let oldVal = this.deps.get(path);
                            let curVal = api.GetValueByPath(path);
                            if(oldVal !== curVal){
                                // console.log(`   %c └─ 判定: 发现差异路径 ${path} | ${oldVal} -> ${curVal} | 执行重算`, "color: #f56c6c");
                                shouldSkipCalculate = false;
                           
                                break;
                            }
                        }
                    }
                  
                } 
            
               
                if(shouldSkipCalculate){
                
                    // console.log(`%c [⚡️高速缓存] ${this.path} 命中! 缓存值:`, "color: #409EFF", this.cache);
                    return this.cache
                }
            
           
                //命中自己订阅的key值，它变更的时候需要重新计算
 
                let { res, version } = await this.strategy.evaluate(api, currentVersion);
 
         
                if( curToken !== this.promiseToken){
                    // console.warn(`[拦截幽灵] 桶版本已进化为 ${this.version}, 任务版本 ${version} 作废`);
                    // console.log(res,this.cache)
                    return this.cache
                }
                

                if (version < this.version) {
                    // console.log('过期任务');
                    return this.cache;
                }

                if (this.inferType(res) !== this.contract) {

                    console.error(`[类型泄露] 桶产出了非 ${this.contract} 类型的值:`, res);
                }

                this.cache = res;

                if(curToken === this.promiseToken){
                     
                    // console.log(`${this.path}修改了cache:`,res)
                    let paths = Array.from(this.deps.keys());
                    for(let path of paths){
                    
                        let curVal = api.GetValueByPath(path);
                        this.deps.set(path,curVal)
                    }
                  
                }

                return res;

            }catch(err:any){
                const info = {
                    path:this.path,
                    error:err
                }
                throw info
            } finally {
                if (this.promiseToken === curToken) {
                    this.pendingPromise = null;
                    this.promiseToken = null;
                }
            }
        })();

        return this.pendingPromise;
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