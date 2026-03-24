//这里需要定义一些预设的rule，然后暴露一下createRule方法

 
import { DefaultStrategy, SchemaBucket } from "../engine/bucket"; 
import { MeshFlowTaskNode, MeshPath, SetRuleOptions, logicApi } from "../types/types";
import { KeysOfUnion } from '../utils/util';
 
const CreateRule = <
P,
K,
NM,
TKeys extends KeysOfUnion<NM>  ,
 
>(targetPath: P, targetKey: K , options: {
    value?: any
    priority?: number,
    logic: (api: logicApi<TKeys>) => any,
    triggerPaths: P[],
    triggerKeys:Array<TKeys>;
 
}) => {

    const basePriority = 10;
    // type newKey = TKeys;
    // let lastDeps: any[] | undefined = undefined;
    // let cache: any = undefined;

    //这里的参数就是调用evaluate的时候传入的参数
    const logic = (api:any) => {
     
        const currentDeps = options.triggerPaths.map(path => {
            const node = api.GetRenderSchemaByPath(path);
            
            
            if(options.triggerKeys.length===0) return node;
 
            const triggerSnapshot = {} as Record<TKeys,any>;
    
            // 依然只摘取用户关心的 Keys，保持数据量最轻
            options.triggerKeys.forEach((key) => {
              
               
                triggerSnapshot[key] = node[key];
            });

    
            return triggerSnapshot;
        });
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

export const useSetRule = <P extends MeshPath,NM>(
 
    Finder: (path: P) => MeshFlowTaskNode<P,any,NM>,
    SetBucket:(newBucket: SchemaBucket<P>) => number,
    GetBucket: (bucketId: number) => SchemaBucket<P>,
    dependencyGraph: Map<P, Set<P>>,
    predecessorGraph: Map<P, Set<P>>,
 
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

    const SetRule = <
    K extends KeysOfUnion<NM>,
    TKeys extends KeysOfUnion<NM>  ,
    >(outDegreePath: P, inDegreePath: P, key: K , options: SetRuleOptions<NM,TKeys>) => {
        
       
        // let outDegree = GetByPath(outDegreePath);
        let inDegree = GetByPath(inDegreePath);
        
        const triggerKeys = options.triggerKeys || [] ;
    
 

        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule<P,K,NM,TKeys>(inDegreePath, key, { ...options, triggerPaths: [outDegreePath],triggerKeys  });

        // const DepsArray:Array<[P,any]> = [outDegreePath].map(path=>[path,GetByPath(path).value])
        const DepsArray:Array<[P,any]> = [outDegreePath].map(path=>[path,GetByPath(path).state.value])
        // 维护图关系
        updateGraphRelation(outDegreePath, inDegreePath);
        
     

        if (typeof inDegree.nodeBucket[key] === 'number') {

           const node = GetBucket(inDegree.nodeBucket[key])

           node.setRule(newRule,DepsArray);
            //如果有副作用就加入副作用列表
            if(options.effect){
                node.setSideEffect({
                    fn:options.effect,
                    args:options.effectArgs?options.effectArgs:[key]
                })
            }
        } else {
            //访问元数据
            const baseValue = inDegree.meta[key] 
             
            let newBucket = new SchemaBucket<P>(
                baseValue,
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
            };

            inDegree.nodeBucket[key] = SetBucket(newBucket);
            
        }
        
        (inDegree.state as any)[key] = inDegree.meta[key]
        
        const bucket = GetBucket(inDegree.nodeBucket[key])

        if(options.forceNotify){
            //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
            bucket.forceNotify(); 
        }

        if(options.cacheStrategy =='none'){
            bucket.setUseCache(false)
        }

    }

    const SetRules = <
    K extends KeysOfUnion<NM>,
    TKeys extends KeysOfUnion<NM>  
    >(
        outDegreePaths: P[],
        inDegreePath: P,
        key: K,
        options: SetRuleOptions<NM,TKeys> ) => {
        
        let inDegree = GetByPath(inDegreePath);
     
        // 维护多对一的图关系
        for (let outDegreePath of outDegreePaths) {
            updateGraphRelation(outDegreePath, inDegreePath);
        }

        const triggerKeys = options.triggerKeys || [];
 

        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule<P,K,NM,TKeys>(inDegreePath, key, { ...options, triggerPaths: outDegreePaths,triggerKeys });

        // const DepsArray:Array<[P,any]> = outDegreePaths.map(path=>[path,GetByPath(path).value])
        const DepsArray:Array<[P,any]> = outDegreePaths.map(path=>[path,GetByPath(path).state.value])

        
        if (typeof inDegree.nodeBucket[key] ==='number' ) {
            const node = GetBucket(inDegree.nodeBucket[key]);

            node.setRules(newRule,DepsArray);
            //如果有副作用就加入副作用列表
            if(options.effect){
                node.setSideEffect({
                    fn:options.effect,
                    args:options.effectArgs?options.effectArgs:[key]
                });
            }
        }else{
            //访问元数据
            const baseValue = inDegree.meta[key];
            let newBucket = new SchemaBucket(
                baseValue,
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

            inDegree.nodeBucket[key] = SetBucket(newBucket);

        }

        (inDegree.state as any)[key] = inDegree.meta[key]

        const bucket = GetBucket(inDegree.nodeBucket[key])

        if(options.forceNotify){
            //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
            bucket.forceNotify(); 
        }

        if(options.cacheStrategy =='none'){
            bucket.setUseCache(false)
        }

    }
    return {
        SetRule ,
        SetRules
    }
}

