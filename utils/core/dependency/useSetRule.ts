 
 
import {  SchemaBucket } from "../engine/bucket"; 
import { InternalKeys, MeshError, MeshFlowTaskNode, MeshPath, SetRuleOptions, SuggestKey, logicApi } from "../types/types";
// import { KeysOfUnion } from '../utils/util';
 
// const CreateRule = <

// K,
// NM,
// TKeys extends SuggestKey<NM>  ,
 
// >(targetUid: number, targetKey: K , options: {
//     value?: any
//     priority?: number,
//     logic: (api: logicApi<TKeys>) => any,
//     triggerUids: number[],
//     triggerKeys:Array<TKeys | InternalKeys >;
 
// }) => {

//     const basePriority = 10;
 

//     //这里的参数就是调用evaluate的时候传入的参数
//     const logic = (api:any) => {
     
//         const currentDeps = options.triggerUids.map(uid => {
//             const node = api.getProxyByUid(uid);
            
            
//             if(options.triggerKeys.length===0) return node;
 
//             const triggerSnapshot = {} as Record<TKeys|InternalKeys ,any>;
    
//             // 依然只摘取用户关心的 Keys，保持数据量最轻
//             options.triggerKeys.forEach((key) => {
              
               
//                 triggerSnapshot[key] = node[key];
//             });

    
//             return triggerSnapshot;
//         });
 
//         const slot = Object.create(null);
//         Object.defineProperty(slot, 'triggerTargets', {
//             get: () => currentDeps
//         });
//         Object.defineProperty(slot, 'affectedTatget', {
//             get: () => {
            
//                 return api.getProxyByUid(targetUid)[targetKey]
//             }
//         });

//         const result = options.logic({ slot });

 

//         return result;
//     }

//     return {
    
//         value: options.value,
//         targetUid:targetUid,
//         triggerUids: options.triggerUids,
//         priority: options.priority ?? basePriority,
//         logic,
//     }
// }

 
// /**
//  * @internal
// */
// export const useSetRule = <P extends MeshPath,NM>(
 
//     Finder: (path: P) => MeshFlowTaskNode<P,any,NM>,
//     SetBucket:(newBucket: SchemaBucket<P>) => number,
//     GetBucket: (bucketId: number) => SchemaBucket<P>,
//     dependencyGraph: Array<Array<number>>,
//     predecessorGraph: Array<Array<number>>,

//     _dependencyGraph:Array<Set<number>>,
//     _predecessorGraph:Array<Set<number>>,

//     activeTopologyUids:Map<number,number>
// ) => {
//     if (!Finder) {
//         throw Error()
//     }
//     let GetByPath = Finder;

//     const updateGraphRelation = (sourceUid: number, targetUid: number) => {
//         // 1. 维护出度表 (dependencyGraph): source -> targets
    
//         if(typeof dependencyGraph[sourceUid] === 'undefined'){
//             dependencyGraph[sourceUid] = [];
//             _dependencyGraph[sourceUid] = new Set();
//         }
//         //避免多次加入,影子节点用来避免大数据量的情况下加入节点时候的去重问题，稳定之后可以删除影子节点
 
//         _dependencyGraph[sourceUid].add(targetUid);
//         if(_dependencyGraph[sourceUid].size>dependencyGraph[sourceUid].length){
//             dependencyGraph[sourceUid].push(targetUid);
//             // dependencyGraph[sourceUid] = Array.from(_dependencyGraph[sourceUid])
//         }
        

//         // 2. 维护入度表 (predecessorGraph): target -> sources
//         if(typeof predecessorGraph[targetUid] === 'undefined'){
//             predecessorGraph[targetUid] = [];
//             _predecessorGraph[targetUid]= new Set();
//         }
//         _predecessorGraph[targetUid].add(sourceUid);
//         if(_predecessorGraph[targetUid].size>predecessorGraph[targetUid].length){
//             predecessorGraph[targetUid].push(sourceUid)
//             // predecessorGraph[targetUid] = Array.from(_predecessorGraph[targetUid]);
//         }  
 
//     };

//     const SetRule = <
//     K extends SuggestKey<NM>,
//     TKeys extends SuggestKey<NM> = SuggestKey<NM> ,
//     >(outDegreePath: P, inDegreePath: P, key: K , options: SetRuleOptions<NM,TKeys>) => {
        
       
//         const outDegree = GetByPath(outDegreePath);
//         const inDegree = GetByPath(inDegreePath);
        
//         const triggerKeys = options.triggerKeys || [] ;
        
//         let activeIndegreeCount = activeTopologyUids.get(inDegree.uid)||0
//         let activeOutdegreeCount = activeTopologyUids.get(outDegree.uid)||0
       
//         activeIndegreeCount+=1;
//         activeOutdegreeCount+=1
         
//         activeTopologyUids.set(inDegree.uid,activeIndegreeCount);
//         activeTopologyUids.set(outDegree.uid,activeOutdegreeCount)

//         //创建rule,第一个是id，现在先由触发它的表单的path来定义
//         let newRule = CreateRule<K,NM,TKeys>(inDegree.uid, key, { ...options, triggerUids: [outDegree.uid],triggerKeys });

//         // const DepsArray:Array<[P,any]> = [outDegreePath].map(path=>[path,GetByPath(path).value])
//         const DepsArray:Array<[number,Array<TKeys| Exclude<InternalKeys,'state'>>,any]> = [outDegreePath].map(path=>{
//             const node = GetByPath(path);
           
//             return [node.uid,triggerKeys,node.proxy]
//         })
       
//         // 维护图关系
//         updateGraphRelation(outDegree.uid, inDegree.uid);
        
     

//         if (typeof inDegree.nodeBucket[key] === 'number') {

//            const node = GetBucket(inDegree.nodeBucket[key])

//            node.setRule(newRule,DepsArray);
//             //如果有副作用就加入副作用列表
//             if(options.effect){
//                 node.setSideEffect({
//                     fn:options.effect,
//                     args:options.effectArgs?options.effectArgs:[key]
//                 })
//             }
//         } else {
//             //访问元数据
//             const baseValue = (inDegree.meta as any)[key] 
             
//             let newBucket = new SchemaBucket<P>(
//                 baseValue,
//                 key,
//                 inDegreePath
//             );

//             newBucket.setRule(newRule,DepsArray);
//             //如果有副作用就加入副作用列表
//             if(options.effect){
               
//                 newBucket.setSideEffect({
//                     fn:options.effect,
//                     args:options.effectArgs?options.effectArgs:[key]
//                 })
//             };

//             inDegree.nodeBucket[key] = SetBucket(newBucket);
            
//         }
        
//         (inDegree.state as any)[key] = (inDegree.meta as any)[key]
        
//         const bucket = GetBucket(inDegree.nodeBucket[key])

//         if(options.forceNotify){
//             //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
//             bucket.forceNotify(); 
//         }

//         if(options.cacheStrategy =='none'){
//             bucket.setUseCache(false)
//         }

//     }
 
//     const SetRules = <
//     K extends KeysOfUnion<NM>,
//     TKeys extends KeysOfUnion<NM>
//     >(
//         outDegreePaths: P[],
//         inDegreePath: P,
//         key: K,
//         options: SetRuleOptions<NM,TKeys> ) => {
        
          
//         const inDegree = GetByPath(inDegreePath);

//         let activeIndegreeCount = activeTopologyUids.get(inDegree.uid)||0
      
//         activeIndegreeCount+=1;
     
//         activeTopologyUids.set(inDegree.uid,activeIndegreeCount)
     
//         const outDegreeUids:Array<number> = []
//         // 维护多对一的图关系
//         for (let outDegreePath of outDegreePaths) {
//             const outDegree = GetByPath(outDegreePath);
//             outDegreeUids.push(outDegree.uid);
//             let activeOutdegreeCount = activeTopologyUids.get(outDegree.uid)||0
//             activeOutdegreeCount+=1;
//             activeTopologyUids.set(outDegree.uid,activeOutdegreeCount);
            
//             updateGraphRelation(outDegree.uid, inDegree.uid);
//         }

//         const triggerKeys = options.triggerKeys || [];
 

//         //创建rule,第一个是id，现在先由触发它的表单的path来定义
//         let newRule = CreateRule<K,NM,TKeys>(inDegree.uid, key, { ...options, triggerUids: outDegreeUids,triggerKeys });

   
//         const DepsArray:Array<[number,Array<TKeys| Exclude<InternalKeys,'state'>>,any]> = outDegreePaths.map(path=>{
//             const node = GetByPath(path);
            
//             return [node.uid,triggerKeys,node.state]
//         })
       
        
//         if (typeof inDegree.nodeBucket[key] ==='number' ) {
//             const node = GetBucket(inDegree.nodeBucket[key]);

//             node.setRules(newRule,DepsArray);
//             //如果有副作用就加入副作用列表
//             if(options.effect){
//                 node.setSideEffect({
//                     fn:options.effect,
//                     args:options.effectArgs?options.effectArgs:[key]
//                 });
//             }
//         }else{
//             //访问元数据
//             const baseValue = inDegree.meta[key];
//             let newBucket = new SchemaBucket(
//                 baseValue,
//                 key,
//                 inDegreePath
//             );

//             newBucket.setRules(newRule,DepsArray);
//             //如果有副作用就加入副作用列表
//             if(options.effect){
//                 newBucket.setSideEffect({
//                     fn:options.effect,
//                     args:options.effectArgs?options.effectArgs:[key]
//                 })
//             }

//             inDegree.nodeBucket[key] = SetBucket(newBucket);

//         }

//         (inDegree.state as any)[key] = inDegree.meta[key]

//         const bucket = GetBucket(inDegree.nodeBucket[key])

//         if(options.forceNotify){
//             //如果设置了强制刷新就给桶设置成强制刷新，一个桶里面只要有
//             bucket.forceNotify(); 
//         }

//         if(options.cacheStrategy =='none'){
//             bucket.setUseCache(false)
//         }

//     }
//     return {
//         SetRule ,
//         SetRules
//     }
// }

//task执行参数
//背压参数
const BACKPRESSURE_LIMIT = 30;
//最大并发数
const MAX_CONCURRENT_TASKS = 40;

const POOL_SIZE = BACKPRESSURE_LIMIT + MAX_CONCURRENT_TASKS + 10; // 留 10 个作为弹性冗余，共 80
 
// ==========================================
// 🌟 享元对象池：杜绝 48 万次的 API Wrapper 分配
// ==========================================
class ApiWrapperPool {
    private pool: any[] = [];

    constructor(size: number) {
        for (let i = 0; i < size; i++) {
            this.pool.push({
                slot: {
                    triggerTargets: null,
                    affectedTatget: undefined, 
                    targetMeta: undefined
                }
            });
        }
    }

    acquire() {
        return this.pool.pop() || {
            slot: { triggerTargets: null, affectedTatget: undefined, targetMeta: undefined }
        };
    }

    release(wrapper: any) {
        // 🌟 释放时切断引用
        wrapper.slot.triggerTargets = null;
        wrapper.slot.affectedTatget = undefined;
        wrapper.slot.targetMeta = undefined;
        this.pool.push(wrapper);
    }
}
export const globalWrapperPool = new ApiWrapperPool(POOL_SIZE);

 
export const ExecuteMeshRule = (rule: any, api: any) => {
    const { triggerUids, triggerKeys, targetUid, targetKey, logic, preAllocatedDeps } = rule;
    
    const hasTriggerKeys = triggerKeys && triggerKeys.length > 0;
 

    // 纯粹的 O(1) 指针赋值，没有任何数组或对象的重新分配
    for (let i = 0; i < triggerUids.length; i++) {
        const uid = triggerUids[i];
        const node = api.getProxyByUid(uid);
 
        if (!hasTriggerKeys) {
            preAllocatedDeps[i] = node;
        } else {
            const snap = preAllocatedDeps[i];
            for (let j = 0; j < triggerKeys.length; j++) {
                const key = triggerKeys[j];
                snap[key] = node[key];
            }
            //万一需要triggernodes上其他信息就从这个proxy节点上找
            snap['proxy'] = node;
        }
    }
    const wrapper = globalWrapperPool.acquire();

    wrapper.slot.triggerTargets = preAllocatedDeps;
    wrapper.slot.affectedTatget = api.getProxyByUid(targetUid)[targetKey];
    wrapper.slot.targetMeta = api.getProxyByUid(targetUid).meta;

    // 🌟 3. 将包裹传给业务逻辑！
    const result = logic(wrapper);
 
    if (result && typeof result.then === 'function') {
        // 如果是异步任务，等待执行完毕后释放
        return result.finally(()=>{
            globalWrapperPool.release(wrapper);
        });
    } else {
        // 同步任务，立刻释放
        globalWrapperPool.release(wrapper);
        return result;
    }
};

// ==========================================
// 🌟 纯数据构造器：不再创建任何闭包函数
// ==========================================
const CreateRule = <
    K,
    NM,
    TKeys extends SuggestKey<NM>
>(targetUid: number, targetKey: K, options: {
    value?: any;
    priority?: number;
    logic: (api: logicApi<NM,TKeys>) => any;
    triggerUids: number[];
    triggerKeys: Array<TKeys | InternalKeys>;
}) => {
    const basePriority = 10;
    
    // 初始化时挖好坑，拒绝运行时分配
    const preAllocatedDeps: any[] = new Array(options.triggerUids.length);
    if (options.triggerKeys && options.triggerKeys.length > 0) {
        for (let i = 0; i < preAllocatedDeps.length; i++) {
            preAllocatedDeps[i] = Object.create(null);
        }
    }
 
    return {
        value: options.value,
        targetUid: targetUid,
        targetKey: targetKey,
        triggerUids: options.triggerUids,
        triggerKeys: options.triggerKeys || [],
        logic: options.logic,// 仅存用户逻辑的引用
        priority: options.priority ?? basePriority,
        _hasRun: false,
        preAllocatedDeps, // 将预分配的空间挂载在 rule 实体上
    
    };
}

/**
 * @internal
*/
export const useSetRule = <P extends MeshPath, NM>(
    Finder: (path: P) => MeshFlowTaskNode<P, any, NM>,
    SetBucket: (newBucket: SchemaBucket<P>) => number,
    GetBucket: (bucketId: number) => SchemaBucket<P>,
    dependencyGraph: Array<Array<number>>,
    predecessorGraph: Array<Array<number>>,
    _dependencyGraph: Array<Set<number>>,
    _predecessorGraph: Array<Set<number>>,
    activeTopologyUids: Map<number, number>
) => {
    if (!Finder) {
        throw Error(MeshError.WrongId)
    }
    let GetByPath = Finder;

    const updateGraphRelation = (sourceUid: number, targetUid: number) => {
        if (typeof dependencyGraph[sourceUid] === 'undefined') {
            dependencyGraph[sourceUid] = [];
            _dependencyGraph[sourceUid] = new Set();
        }
        
        if (!_dependencyGraph[sourceUid].has(targetUid)) {
            _dependencyGraph[sourceUid].add(targetUid);
            dependencyGraph[sourceUid].push(targetUid);
        }

        if (typeof predecessorGraph[targetUid] === 'undefined') {
            predecessorGraph[targetUid] = [];
            _predecessorGraph[targetUid] = new Set();
        }
        
        if (!_predecessorGraph[targetUid].has(sourceUid)) {
            _predecessorGraph[targetUid].add(sourceUid);
            predecessorGraph[targetUid].push(sourceUid);
        }  
    };

    const SetRule = <
        K extends SuggestKey<NM>,
        TKeys extends SuggestKey<NM> = SuggestKey<NM>
    >(outDegreePath: P, inDegreePath: P, key: K, options: SetRuleOptions<NM, TKeys>) => {
 
        const outDegree = GetByPath(outDegreePath);
        const inDegree = GetByPath(inDegreePath);
        
        const triggerKeys = options.triggerKeys || [];
        
        let activeIndegreeCount = activeTopologyUids.get(inDegree.uid) || 0;
        let activeOutdegreeCount = activeTopologyUids.get(outDegree.uid) || 0;
       
        activeIndegreeCount += 1;
        activeOutdegreeCount += 1;
         
        activeTopologyUids.set(inDegree.uid, activeIndegreeCount);
        activeTopologyUids.set(outDegree.uid, activeOutdegreeCount);

        let newRule = CreateRule<K, NM, TKeys>(inDegree.uid, key, { ...options, triggerUids: [outDegree.uid], triggerKeys });

        // 取消了隐性的 .map
        const DepsArray: Array<[number, Array<TKeys | Exclude<InternalKeys, 'state'>>, any]> = [
            [outDegree.uid, triggerKeys, outDegree.proxy]
        ];
       
        updateGraphRelation(outDegree.uid, inDegree.uid);
      
        if (typeof inDegree.nodeBucket[key] === 'number') {
            const node = GetBucket(inDegree.nodeBucket[key]);
            node.setRule(newRule, DepsArray);
            
            if (options.effect) {
                node.setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }
        } else {
            const baseValue = (inDegree.meta as any)[key];
            let newBucket = new SchemaBucket<P>(baseValue, key as string, inDegreePath);
            newBucket.setRule(newRule, DepsArray);
            
            if (options.effect) {
                newBucket.setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }

            inDegree.nodeBucket[key] = SetBucket(newBucket);
        }
        
        (inDegree.state as any)[key] = (inDegree.meta as any)[key];
        const bucket = GetBucket(inDegree.nodeBucket[key]);
 
        if (options.forceNotify||triggerKeys.length===0) bucket.forceNotify(); 
        if (options.cacheStrategy == 'none') bucket.setUseCache(false);
    }
 
    const SetRules = <
        K extends SuggestKey<NM>,
        TKeys extends SuggestKey<NM>
    >(
        outDegreePaths: P[],
        inDegreePath: P,
        key: K,
        options: SetRuleOptions<NM, TKeys> 
    ) => {
        const inDegree = GetByPath(inDegreePath);

        let activeIndegreeCount = activeTopologyUids.get(inDegree.uid) || 0;
        activeIndegreeCount += 1;
        activeTopologyUids.set(inDegree.uid, activeIndegreeCount);
     
        // 预分配数组，替代 .map
        const outDegreeUids: Array<number> = new Array(outDegreePaths.length);
        const DepsArray: Array<[number, Array<TKeys | Exclude<InternalKeys, 'state'>>, any]> = new Array(outDegreePaths.length);
        const triggerKeys = options.triggerKeys || [];

        for (let i = 0; i < outDegreePaths.length; i++) {
            const outDegree = GetByPath(outDegreePaths[i]);
            outDegreeUids[i] = outDegree.uid;
            
            let activeOutdegreeCount = activeTopologyUids.get(outDegree.uid) || 0;
            activeOutdegreeCount += 1;
            activeTopologyUids.set(outDegree.uid, activeOutdegreeCount);
            
            updateGraphRelation(outDegree.uid, inDegree.uid);

            DepsArray[i] = [outDegree.uid, triggerKeys, outDegree.state];
        }

        let newRule = CreateRule<K, NM, TKeys>(inDegree.uid, key, { ...options, triggerUids: outDegreeUids, triggerKeys });

        if (typeof inDegree.nodeBucket[key] === 'number') {
            const node = GetBucket(inDegree.nodeBucket[key]);
            node.setRules(newRule, DepsArray);
            
            if (options.effect) {
                node.setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }
        } else {
            const baseValue = (inDegree.meta as any)[key];
            let newBucket = new SchemaBucket<P>(baseValue, key as string, inDegreePath);
            newBucket.setRules(newRule, DepsArray);
            
            if (options.effect) {
                newBucket.setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }

            inDegree.nodeBucket[key] = SetBucket(newBucket);
        }

        (inDegree.state as any)[key] = (inDegree.meta as any)[key];
        const bucket = GetBucket(inDegree.nodeBucket[key]);
 
        if (options.forceNotify||triggerKeys.length===0) bucket.forceNotify(); 
        if (options.cacheStrategy == 'none') bucket.setUseCache(false);
    }

    return { SetRule, SetRules }
}