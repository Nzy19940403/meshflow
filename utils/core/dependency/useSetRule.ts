 
 
import {  SchemaBucket } from "../engine/bucket"; 
import { MeshFlowTaskNode, MeshPath, SetRuleOptions, logicApi } from "../types/types";
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
    triggerKeys:Array<TKeys>;
 
}) => {

    const basePriority = 10;
 

    //这里的参数就是调用evaluate的时候传入的参数
    const logic = (api:any) => {
     
        const currentDeps = options.triggerUids.map(uid => {
            const node = api.getProxyByUid(uid);
            
            
            if(options.triggerKeys.length===0) return node;
 
            const triggerSnapshot = {} as Record<TKeys,any>;
    
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

export const useSetRule = <P extends MeshPath,NM>(
 
    Finder: (path: P) => MeshFlowTaskNode<P,any,NM>,
    SetBucket:(newBucket: SchemaBucket<P>) => number,
    GetBucket: (bucketId: number) => SchemaBucket<P>,
    dependencyGraph: Array<Array<number>>,
    predecessorGraph: Array<Array<number>>,

    _dependencyGraph:Array<Set<number>>,
    _predecessorGraph:Array<Set<number>>,

    activeTopologyUids:Map<number,number>
) => {
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
        let newRule = CreateRule<P,K,NM,TKeys>(inDegree.uid, key, { ...options, triggerUids: [outDegree.uid],triggerKeys  });

        // const DepsArray:Array<[P,any]> = [outDegreePath].map(path=>[path,GetByPath(path).value])
        const DepsArray:Array<[number,any]> = [outDegreePath].map(path=>{
            const node = GetByPath(path);
            return [node.uid,node.state.value]
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

   
        const DepsArray:Array<[number,any]> = outDegreePaths.map(path=>{
            const node = GetByPath(path);
            return [node.uid,node.state.value]
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

