//这里需要定义一些预设的rule，然后暴露一下createRule方法

import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
import { DefaultStarategy, SchemaBucket } from "./bucket";
import { FormFieldSchema, GroupField, RenderSchema, RenderSchemaFn } from "./schema";
import { KeysOfUnion } from './util';

export interface logicApi {
    // affectKey: string,
    // GetRenderSchemaByPath: (path: AllPath) => any,
    // GetValueByPath: (path: AllPath) => any
    slot: {
        triggerTargets: any,
        affectedTatget: any
    }
}

export const CreateRule = (targetPath: AllPath, targetKey: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, options: {
    value?: any
    priority?: number,
    logic: (api: any) => any,
    triggerPaths: AllPath[]
}) => {

    const basePriority = 10;

    let lastDeps: any[] | undefined = undefined;
    let cache: any = undefined;

    //这里的参数就是调用evaluate的时候传入的参数
    const logic = (api: any) => {

        const currentDeps = options.triggerPaths.map(path => api.GetValueByPath(path));

        if (lastDeps && currentDeps.every((val, i) => val === lastDeps![i])) {
            return cache; 
        }

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

        lastDeps = currentDeps;
        cache = result;

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

export const useSetRule = (
    Finder: (path: AllPath) => RenderSchemaFn<Exclude<FormFieldSchema,GroupField>>, 
    dependencyGraph: Map<AllPath, Set<AllPath>>,
    predecessorGraph: Map<AllPath, Set<AllPath>>
) => {
    if (!Finder) {
        throw Error('')
    }
    let GetByPath = Finder;

    const updateGraphRelation = (source: AllPath, target: AllPath) => {
        // 1. 维护出度表 (dependencyGraph): source -> targets
        if (!dependencyGraph.has(source)) {
            dependencyGraph.set(source, new Set<AllPath>());
        }
        dependencyGraph.get(source)!.add(target);

        // 2. 维护入度表 (predecessorGraph): target -> sources
        if (!predecessorGraph.has(target)) {
            predecessorGraph.set(target, new Set<AllPath>());
        }
        predecessorGraph.get(target)!.add(source);
    };

    const SetRule = (outDegreePath: AllPath, inDegreePath: AllPath, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, options: {
        value?: any
        priority?: number,
        // subscribeKey?: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>[],
        forceNotify?:boolean,
        logic: (api: logicApi) => any
    } = { logic: (api) => { } }) => {
        
       
        // let outDegree = GetByPath(outDegreePath);
        let inDegree = GetByPath(inDegreePath);
   
        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule(inDegreePath, key, { ...options, triggerPaths: [outDegreePath] });

        const DepsArray:Array<[AllPath,any]> = [outDegreePath].map(path=>[path,GetByPath(path).defaultValue])

        // 维护图关系
        updateGraphRelation(outDegreePath, inDegreePath);
       
        if (inDegree.nodeBucket[key]) {
           
            inDegree.nodeBucket[key].setRule(newRule,DepsArray)

        } else {
       
            let newBucket = new SchemaBucket(
                inDegree[key as keyof typeof inDegree] ,
                key      
            );

            newBucket.setRule(newRule,DepsArray)

            inDegree.nodeBucket[key] = newBucket;
        }

        if(options.forceNotify){
            //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
            inDegree.nodeBucket[key].forceNotify(); 
        }

    }

    const SetRules = (
        outDegreePaths: AllPath[],
        inDegreePath: AllPath,
        key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>,
        options: {
            value?: any
            priority?: number,
            // subscribeKey?: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>[],
            forceNotify?:boolean,
            logic: (api: logicApi) => any
        } = { logic: (api) => { } }) => {
        
        let inDegree = GetByPath(inDegreePath);
     
        // 维护多对一的图关系
        for (let outDegreePath of outDegreePaths) {
            updateGraphRelation(outDegreePath, inDegreePath);
        }
 

        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule(inDegreePath, key, { ...options, triggerPaths: outDegreePaths });

        const DepsArray:Array<[AllPath,any]> = outDegreePaths.map(path=>[path,GetByPath(path).defaultValue])

        if (inDegree.nodeBucket[key]) {

            inDegree.nodeBucket[key].setRules(newRule,DepsArray)

        }else{

            let newBucket = new SchemaBucket(
                inDegree[key as keyof typeof inDegree],
                key
            );

            newBucket.setRules(newRule,DepsArray)

            inDegree.nodeBucket[key] = newBucket;
        }
        
        if(options.forceNotify){
            //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
            inDegree.nodeBucket[key].forceNotify(); 
        }

    }
    return {SetRule,SetRules}
}

export const useSetStrategy = (Finder: any) => {
    let GetByPath = Finder ? Finder : undefined;

    if (!GetByPath) {
        throw Error('')
    }

    const SetStrategy = (path: AllPath, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, strategy: DefaultStarategy) => {
        let degree = GetByPath(path);

        (degree.nodeBucket[key] as SchemaBucket).setStrategy(strategy);
    }

    return { SetStrategy }
}