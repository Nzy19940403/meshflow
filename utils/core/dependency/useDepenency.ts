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
 
    const _GetNextDependency = (targetUid: number) => {
        const fullGraph = getDependencyGraph(); // 出度 Map
        const predecessorGraph = getPredecessorGraph(); // 入度 Map

        // 1. 获取所有直接下游 (这是真理，不受 Order 影响)
        const directChildren:Array<number> = fullGraph[targetUid]||[];
        
    

        if (directChildren.length === 0) return directChildren;

        // 2. 局部权重决策：在这些直接下游中，谁该现在跑？
        // 我们不再去查全局 Order 的 Level 0, 1, 2...
        // 我们只看：在这些 children 中，有没有人是“互相依赖”的？

        return directChildren.filter((childUid) => {
            // 1. 找到这个孩子的所有依赖（爸爸们）
            const allMyParents = predecessorGraph[childUid] || [];

            // 2. 看看这些爸爸里，有没有人正待在“本次待处理”的名单中
            const isAnyParentWaiting = allMyParents.some((parentUid) =>
                directChildren.indexOf(parentUid)>=0
            );

            // 3. 如果没有任何爸爸在等，说明我是这波里辈分最大的，我可以走
            const iAmReady = !isAnyParentWaiting;

            return iAmReady;
        });
    };
   
 
    const GetAllPrevDependency = (targetUid: number) => {
        const predecessorGraph = getPredecessorGraph();

        return predecessorGraph[targetUid] || []
      
    };
    const GetAllNextDependency = (targetUid: number) => {
        const fullGraph = getDependencyGraph();
       
        return fullGraph[targetUid] || []
      
    };

    const rebuildDirectDependencyMaps = (allUids: number[]) => {
        const directNextMap: Array<Array<number>> = [];
        const directPrevMap: Array<Array<number>> = [];
        
        // 🌟 1. 直接拿最原汁原味的物理真相图
        const fullGraph = getDependencyGraph();
    
        for (const uid of allUids) {
            // 🌟 2. 零过滤！因为下游的每一条边，都需要用来给目标节点“减1把锁”
            const nexts = fullGraph[uid] || [];
            
            directNextMap[uid] = nexts;
    
            // 3. 用完整的边建立反向索引
            for (let i = 0; i < nexts.length; i++) {
                const nextUid = nexts[i];
                if (typeof directPrevMap[nextUid] === 'undefined') {
                    directPrevMap[nextUid] = [];
                }
                directPrevMap[nextUid].push(uid);
            }
        }
        
        return { directNextMap, directPrevMap };
    };
    const GetNextDependency = (targetUid: number) => {
        const map = getDirectChildDependencyGraph();
      
        return map[targetUid] || [];
    }
    const GetPrevDependency = (targetUid: number) => {
        const map = getDirectParentDependencyGraph();
        return map[targetUid] || [];
    }

    return {
        GetNextDependency,
        GetPrevDependency,
        GetAllPrevDependency,
        GetAllNextDependency,
        rebuildDirectDependencyMaps,
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
