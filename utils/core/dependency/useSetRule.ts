 
 
import {  SchemaBucket } from "../engine/bucket"; 
import { InternalKeys, MeshError, MeshFlowTaskNode, MeshPath, SetRuleOptions, logicApi } from "../types/types";
import { KeysOfUnion } from '../utils/util';
 
const CreateRule = <
P,
K,
NM,
TKeys extends KeysOfUnion<NM>  ,
 
>(targetUid: number, targetKey: K , options: {
    value?: any
    priority?: number,
    logic: (api: logicApi<TKeys>) => any,
    triggerUids: number[],
    triggerKeys:Array<TKeys | InternalKeys >;
 
}) => {

    const basePriority = 10;
 

    //这里的参数就是调用evaluate的时候传入的参数
    const logic = (api:any) => {
     
        const currentDeps = options.triggerUids.map(uid => {
            const node = api.getProxyByUid(uid);
            
            
            if(options.triggerKeys.length===0) return node;
 
            const triggerSnapshot = {} as Record<TKeys|InternalKeys ,any>;
    
            // 依然只摘取用户关心的 Keys，保持数据量最轻
            options.triggerKeys.forEach((key) => {
              
               
                triggerSnapshot[key] = node[key];
            });

    
            return triggerSnapshot;
        });
 
        const slot = Object.create(null);
        Object.defineProperty(slot, 'triggerTargets', {
            get: () => currentDeps
        });
        Object.defineProperty(slot, 'affectedTatget', {
            get: () => {
            
                return api.getProxyByUid(targetUid)[targetKey]
            }
        });

        const result = options.logic({ slot });

 

        return result;
    }

    return {
    
        value: options.value,
        targetUid:targetUid,
        triggerUids: options.triggerUids,
        priority: options.priority ?? basePriority,
        logic,
    }
}

/**
 * @category DAG
 */
export interface RulesContext<P, NM> {
/**
   * @category DAG
   * @description 建立一对一依赖关系，并自动加入异步校验队列。
   * * @remarks
   * **安全性保障**：引擎会自动探测循环依赖（Cycle Detection）。
   * **性能优化**：校验逻辑被设计为“异步批量执行”。即便你在一个宏任务（如同步代码块）内连续调用 100 次 `SetRule`，
   * 引擎也只会通过微任务（Microtask）在下一刻触发 **一次** 全局环路扫描，确保初始化零负担。
   * * @throws {MeshError.cycle} 当新建立的规则与现有规则构成环路（如 A -> B -> A）时抛出。
   * * @example
   * ```ts
   * // 场景：A 节点的 count 变化时，B 节点的 value 自动加 1
   * engine.config.SetRule('path/A', 'path/B', 'value', {
   *   triggerKeys: ['count'],
   *   logic: ({ slot }) => {
   *     // 从 slot 中安全解构出触发源的数据快照
   *     const [sourceValue] = slot.triggerTargets;
   *     return sourceValue.count + 1;
   *   }
   * });
   * ```
   */
  SetRule: <K extends KeysOfUnion<NM>, TKeys extends KeysOfUnion<NM>>(
    outDegreePath: P,
    inDegreePath: P,
    key: K,
    options: SetRuleOptions<NM, TKeys>
  ) => void;
/**
   * @category DAG
   * @description 建立多对一的聚合依赖关系，将多个源节点状态收敛至目标节点。
   * * @remarks
   * **聚合逻辑**：只要 `outDegreePaths` 数组中的任何一个节点发生变更（匹配 `triggerKeys`），
   * 引擎就会触发一次目标节点的 `logic` 计算。
   * **数据快照**：`slot.triggerTargets` 将按照你传入路径的顺序，完整提供所有源节点的数据快照。
   * **性能保障**：同样受“微任务批处理”保护，自动检测跨节点构成的复杂环路。
   * * @example
   * ```ts
   * // 场景：计算总分。当 A 节点或 B 节点的 score 变化时，C 节点的 total 自动更新
   * engine.config.SetRules(['path/A', 'path/B'], 'path/C', 'total', {
   *   triggerKeys: ['score'],
   *   logic: ({ slot }) => {
   *     // 按照输入顺序解构：targetA 对应 path/A，targetB 对应 path/B
   *     const [targetA, targetB] = slot.triggerTargets;
   *     return targetA.score + targetB.score;
   *   }
   * });
   * ```
   */
  SetRules: <K extends KeysOfUnion<NM>, TKeys extends KeysOfUnion<NM>>(
    outDegreePaths: P[],
    inDegreePath: P,
    key: K,
    options: SetRuleOptions<NM, TKeys>
  ) => void;
}


export const useSetRule = <P extends MeshPath,NM>(
 
    Finder: (path: P) => MeshFlowTaskNode<P,any,NM>,
    SetBucket:(newBucket: SchemaBucket<P>) => number,
    GetBucket: (bucketId: number) => SchemaBucket<P>,
    dependencyGraph: Array<Array<number>>,
    predecessorGraph: Array<Array<number>>,

    _dependencyGraph:Array<Set<number>>,
    _predecessorGraph:Array<Set<number>>,

    activeTopologyUids:Map<number,number>
): RulesContext<P, NM> => {
    if (!Finder) {
        throw Error()
    }
    let GetByPath = Finder;

    const updateGraphRelation = (sourceUid: number, targetUid: number) => {
        // 1. 维护出度表 (dependencyGraph): source -> targets
    
        if(typeof dependencyGraph[sourceUid] === 'undefined'){
            dependencyGraph[sourceUid] = [];
            _dependencyGraph[sourceUid] = new Set();
        }
        //避免多次加入,影子节点用来避免大数据量的情况下加入节点时候的去重问题，稳定之后可以删除影子节点
 
        _dependencyGraph[sourceUid].add(targetUid);
        if(_dependencyGraph[sourceUid].size>dependencyGraph[sourceUid].length){
            dependencyGraph[sourceUid].push(targetUid);
            // dependencyGraph[sourceUid] = Array.from(_dependencyGraph[sourceUid])
        }
        

        // 2. 维护入度表 (predecessorGraph): target -> sources
        if(typeof predecessorGraph[targetUid] === 'undefined'){
            predecessorGraph[targetUid] = [];
            _predecessorGraph[targetUid]= new Set();
        }
        _predecessorGraph[targetUid].add(sourceUid);
        if(_predecessorGraph[targetUid].size>predecessorGraph[targetUid].length){
            predecessorGraph[targetUid].push(sourceUid)
            // predecessorGraph[targetUid] = Array.from(_predecessorGraph[targetUid]);
        }  
 
    };
/**
 * @category DAG
 */
    const SetRule = <
    K extends KeysOfUnion<NM>,
    TKeys extends KeysOfUnion<NM>  ,
    >(outDegreePath: P, inDegreePath: P, key: K , options: SetRuleOptions<NM,TKeys>) => {
        
       
        const outDegree = GetByPath(outDegreePath);
        const inDegree = GetByPath(inDegreePath);
        
        const triggerKeys = options.triggerKeys || [] ;
        
        let activeIndegreeCount = activeTopologyUids.get(inDegree.uid)||0
        let activeOutdegreeCount = activeTopologyUids.get(outDegree.uid)||0
       
        activeIndegreeCount+=1;
        activeOutdegreeCount+=1
         
        activeTopologyUids.set(inDegree.uid,activeIndegreeCount);
        activeTopologyUids.set(outDegree.uid,activeOutdegreeCount)

        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule<P,K,NM,TKeys>(inDegree.uid, key, { ...options, triggerUids: [outDegree.uid],triggerKeys });

        // const DepsArray:Array<[P,any]> = [outDegreePath].map(path=>[path,GetByPath(path).value])
        const DepsArray:Array<[number,Array<TKeys| Exclude<InternalKeys,'state'>>,any]> = [outDegreePath].map(path=>{
            const node = GetByPath(path);
           
            return [node.uid,triggerKeys,node.proxy]
        })
       
        // 维护图关系
        updateGraphRelation(outDegree.uid, inDegree.uid);
        
     

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
        
          
        const inDegree = GetByPath(inDegreePath);

        let activeIndegreeCount = activeTopologyUids.get(inDegree.uid)||0
      
        activeIndegreeCount+=1;
     
        activeTopologyUids.set(inDegree.uid,activeIndegreeCount)
     
        const outDegreeUids:Array<number> = []
        // 维护多对一的图关系
        for (let outDegreePath of outDegreePaths) {
            const outDegree = GetByPath(outDegreePath);
            outDegreeUids.push(outDegree.uid);
            let activeOutdegreeCount = activeTopologyUids.get(outDegree.uid)||0
            activeOutdegreeCount+=1;
            activeTopologyUids.set(outDegree.uid,activeOutdegreeCount);
            
            updateGraphRelation(outDegree.uid, inDegree.uid);
        }

        const triggerKeys = options.triggerKeys || [];
 

        //创建rule,第一个是id，现在先由触发它的表单的path来定义
        let newRule = CreateRule<P,K,NM,TKeys>(inDegree.uid, key, { ...options, triggerUids: outDegreeUids,triggerKeys });

   
        const DepsArray:Array<[number,Array<TKeys| Exclude<InternalKeys,'state'>>,any]> = outDegreePaths.map(path=>{
            const node = GetByPath(path);
            
            return [node.uid,triggerKeys,node.state]
        })
       
        
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

