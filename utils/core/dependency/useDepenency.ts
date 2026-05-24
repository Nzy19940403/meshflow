// 获取全局依赖或者下一步依赖，提供方法检测依赖是否有环

import { MeshError, MeshFlowTaskNode, MeshPath } from "../types/types";

 
export function useDependency<P>(

    getDependencyGraph: () => Array<Array<number>>,
    getPredecessorGraph: () => Array<Array<number>>,
    getDirectParentDependencyGraph: () => Array<Array<number>>,
    getDirectChildDependencyGraph: () => Array<Array<number>>,

    // getShadowDependencyGraph:()=>Array<Set<number>>,
    // getShawowPredecessorGraph:()=>Array<Set<number>>,
) {
 
    const _GetAllPrevDependency = (targetUid: number) => {
        const predecessorGraph = getPredecessorGraph();

        return predecessorGraph[targetUid] || []
      
    };
    const _GetAllNextDependency = (targetUid: number) => {
        const fullGraph = getDependencyGraph();
       
        return fullGraph[targetUid] || []
      
    };

    const _rebuildDirectDependencyMaps = (allUids: number[]) => {
        const _directNextMap: Array<Array<number>> = [];
        const _directPrevMap: Array<Array<number>> = [];
        
        // 🌟 1. 直接拿最原汁原味的物理真相图
        const fullGraph = getDependencyGraph();
    
        for (const uid of allUids) {
            // 🌟 2. 零过滤！因为下游的每一条边，都需要用来给目标节点“减1把锁”
            const nexts = fullGraph[uid] || [];
            
            _directNextMap[uid] = nexts;
    
            // 3. 用完整的边建立反向索引
            for (let i = 0; i < nexts.length; i++) {
                const nextUid = nexts[i];
                if (typeof _directPrevMap[nextUid] === 'undefined') {
                    _directPrevMap[nextUid] = [];
                }
                _directPrevMap[nextUid].push(uid);
            }
        }
        
        return { _directNextMap, _directPrevMap };
    };
    const _GetNextDependency = (targetUid: number) => {
        const map = getDirectChildDependencyGraph();
      
        return map[targetUid] || [];
    }
    const _GetPrevDependency = (targetUid: number) => {
        const map = getDirectParentDependencyGraph();
        return map[targetUid] || [];
    }

    return {
        _GetNextDependency,
        _GetPrevDependency,
        _GetAllPrevDependency,
        _GetAllNextDependency,
        _rebuildDirectDependencyMaps,
    };
}

export function useCheckCycleInGraph<P extends MeshPath,NM>(
    dependencyGraph:Array<Array<number>>,
    activeTopologyUids:Map<number,number>,
) {
    const solve = (inDegreeMap: Map<number, number>): { steps:number[][] , levelMap:Map<number,number>} => {
        const result: number[][] = [];
        // 使用临时队列存储当前层级
        let uidQueue: number[] = [];

        const tempLevelMap = new Map<number, number>();

        const len = inDegreeMap.size;
        let processedCount = 0;
        let currentLevel = 0;

        // 1. 找出第一层（初始入度为 0 的节点）
        for (let [uid, value] of inDegreeMap) {
            if (value === 0) {
                uidQueue.push(uid);
            }
        }

        if (uidQueue.length === 0 && len > 0) {
            throw Error(MeshError.cycle);
        }

        // 2. 逐层剥离
        while (uidQueue.length > 0) {
            // 💡 这一层的节点都在 queue 里
            result.push([...uidQueue]);
            const nextUidQueue: number[] = [];

            // 处理当前层的所有节点
            for (const currentUid of uidQueue) {
                processedCount++;
                

                tempLevelMap.set(currentUid, currentLevel); // 记录到临时表

                const neighbors = dependencyGraph[currentUid];
                
                if (neighbors) {
                    for (const childUid of neighbors) {
                        const newDegree = inDegreeMap.get(childUid)! - 1;
                        inDegreeMap.set(childUid, newDegree);

                        // 💡 只有当下游节点的入度刚好减到 0 时，它才进入“下一层”的队列
                        if (newDegree === 0) {
                            nextUidQueue.push(childUid);
                        }
                    }
                }
            }

            // 切换到下一层
            uidQueue = nextUidQueue;
            currentLevel++;
        }

        if (processedCount < len) {
            throw Error(MeshError.cycle);
        }
         
        return { 
            steps: result, 
            levelMap: tempLevelMap 
        };
    };

    const check = () => {
        const inDegreeMap: Map<number, number> = new Map();
 
        for (let activeUid of activeTopologyUids.keys()) {
    
            const Uids = dependencyGraph[activeUid]||[]

            if (!inDegreeMap.has(activeUid)) {
                inDegreeMap.set(activeUid, 0);
            }

            for (let path of Uids) {
                let num = inDegreeMap.get(path) || 0;
                inDegreeMap.set(path, ++num);
            }
        }

        return solve(inDegreeMap);
    };

    return check;
}
