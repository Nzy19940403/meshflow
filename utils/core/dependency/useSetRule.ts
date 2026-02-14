//这里需要定义一些预设的rule，然后暴露一下createRule方法

 
import { DefaultStarategy, SchemaBucket } from "../engine/bucket";
import { FormFieldSchema, GroupField, RenderSchema, RenderSchemaFn } from "../schema/schema";
import { KeysOfUnion } from '../utils/util';

export interface logicApi {
    // affectKey: string,
    // GetRenderSchemaByPath: (path: AllPath) => any,
    // GetValueByPath: (path: AllPath) => any
    slot: {
        triggerTargets: any,
        affectedTatget: any
    }
}

const CreateRule = <P>(targetPath: P, targetKey: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, options: {
    value?: any
    priority?: number,
    logic: (api: any) => any,
    triggerPaths: P[]
}) => {

    const basePriority = 10;

    // let lastDeps: any[] | undefined = undefined;
    // let cache: any = undefined;

    //这里的参数就是调用evaluate的时候传入的参数
    const logic = (api: any) => {

        const currentDeps = options.triggerPaths.map(path => api.GetValueByPath(path));

        // if (lastDeps && currentDeps.every((val, i) => val === lastDeps![i])) {
        //     return cache; 
        // }

        const slot = Object.create(null);
        Object.defineProperty(slot, 'triggerTargets', {
            get: () => currentDeps
        });
        Object.defineProperty(slot, 'affectedTatget', {
            get: () => {

                return api.GetRenderSchemaByPath(targetPath)[targetKey]
            }
        });

        const result = options.logic({ slot });

        // lastDeps = currentDeps;
        // cache = result;

        return result;
    }

    return {
    
        value: options.value,
        targetPath:targetPath,
        triggerPaths: options.triggerPaths,
        priority: options.priority ?? basePriority,
        logic,
    }
}

export const useSetRule = <P>(
    Finder: (path: P) => RenderSchemaFn<Exclude<FormFieldSchema,GroupField>>, 
    dependencyGraph: Map<P, Set<P>>,
    predecessorGraph: Map<P, Set<P>>
) => {
    if (!Finder) {
        throw Error('')
    }
    let GetByPath = Finder;

    const updateGraphRelation = (source: P, target: P) => {
        // 1. 维护出度表 (dependencyGraph): source -> targets
        if (!dependencyGraph.has(source)) {
            dependencyGraph.set(source, new Set<P>());
        }
        dependencyGraph.get(source)!.add(target);

        // 2. 维护入度表 (predecessorGraph): target -> sources
        if (!predecessorGraph.has(target)) {
            predecessorGraph.set(target, new Set<P>());
        }
        predecessorGraph.get(target)!.add(source);
    };

    const SetRule = (outDegreePath: P, inDegreePath: P, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, options: {
        value?: any
        priority?: number,
        // subscribeKey?: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>[],
        forceNotify?:boolean,
        logic: (api: logicApi) => any,

        /**
         * @beta 节点副作用钩子
         * 用于执行原子化的 Patch 修正。注意：此功能尚在测试，仅建议执行同步逻辑。
         */
        effect?:(args:any)=>any,
        /**
         * @beta 节点副作用钩子指定入参
         * 用于执行原子化的 Patch 修正。注意：此功能尚在测试，仅建议执行同步逻辑。
         */
        effectArgs?:Array<KeysOfUnion<Exclude<FormFieldSchema, GroupField>>>
    } = { logic: (api) => { } }) => {
        
         
        // let outDegree = GetByPath(outDegreePath);
        let inDegree = GetByPath(inDegreePath);
   
        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule(inDegreePath, key, { ...options, triggerPaths: [outDegreePath] });

        const DepsArray:Array<[P,any]> = [outDegreePath].map(path=>[path,GetByPath(path).value])

        // 维护图关系
        updateGraphRelation(outDegreePath, inDegreePath);
       
        if (inDegree.nodeBucket[key]) {
           
            inDegree.nodeBucket[key].setRule(newRule,DepsArray);
            //如果有副作用就加入副作用列表
            if(options.effect){
                inDegree.nodeBucket[key].setSideEffect({
                    fn:options.effect,
                    args:options.effectArgs?options.effectArgs:[key]
                })
            }
        } else {
       
            let newBucket = new SchemaBucket<P>(
                inDegree[key as keyof typeof inDegree] ,
                key,
                inDegreePath
            );

            newBucket.setRule(newRule,DepsArray);
            //如果有副作用就加入副作用列表
            if(options.effect){
                newBucket.setSideEffect({
                    fn:options.effect,
                    args:options.effectArgs?options.effectArgs:[key]
                })
            }
            inDegree.nodeBucket[key] = newBucket;
        }

        if(options.forceNotify){
            //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
            inDegree.nodeBucket[key].forceNotify(); 
        }

    }

    const SetRules = (
        outDegreePaths: P[],
        inDegreePath: P,
        key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>,
        options: {
            value?: any
            priority?: number,
            // subscribeKey?: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>[],
            forceNotify?:boolean,
            logic: (api: logicApi) => any,
            /**
             * @beta 节点副作用钩子
             * 用于执行原子化的 Patch 修正。注意：此功能尚在测试，仅建议执行同步逻辑。
             */
            effect?:(args:any)=>any,
            /**
             * @beta 节点副作用钩子指定入参
             * 用于执行原子化的 Patch 修正。注意：此功能尚在测试，仅建议执行同步逻辑。
             */
            effectArgs?:Array<KeysOfUnion<Exclude<FormFieldSchema, GroupField>>>
        } = { logic: (api) => { } }) => {
        
        let inDegree = GetByPath(inDegreePath);
     
        // 维护多对一的图关系
        for (let outDegreePath of outDegreePaths) {
            updateGraphRelation(outDegreePath, inDegreePath);
        }
 

        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule(inDegreePath, key, { ...options, triggerPaths: outDegreePaths });

        const DepsArray:Array<[P,any]> = outDegreePaths.map(path=>[path,GetByPath(path).value])

        if (inDegree.nodeBucket[key]) {

            inDegree.nodeBucket[key].setRules(newRule,DepsArray);
            //如果有副作用就加入副作用列表
            if(options.effect){
                inDegree.nodeBucket[key].setSideEffect({
                    fn:options.effect,
                    args:options.effectArgs?options.effectArgs:[key]
                });
            }
        }else{

            let newBucket = new SchemaBucket(
                inDegree[key as keyof typeof inDegree],
                key,
                inDegreePath
            );

            newBucket.setRules(newRule,DepsArray);
            //如果有副作用就加入副作用列表
            if(options.effect){
                newBucket.setSideEffect({
                    fn:options.effect,
                    args:options.effectArgs?options.effectArgs:[key]
                })
            }

            inDegree.nodeBucket[key] = newBucket;
        }

        if(options.forceNotify){
            //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
            inDegree.nodeBucket[key].forceNotify(); 
        }

    }
    return {SetRule,SetRules}
}

