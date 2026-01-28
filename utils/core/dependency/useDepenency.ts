// 获取全局依赖或者下一步依赖，提供方法检测依赖是否有环
 
export function useDependency<P>(
    getDependencyGraph: () => Map<P, Set<P>>,
    getPredecessorGraph: () => Map<P, Set<P>>,
    getDirectParentDependencyGraph: () => Map<P, Set<P>>,
    getDirectChildDependencyGraph: () => Map<P, Set<P>>
) {
 
    const _GetNextDependency = (targetPath: P) => {
        const fullGraph = getDependencyGraph(); // 出度 Map
        const predecessorGraph = getPredecessorGraph(); // 入度 Map

        // 1. 获取所有直接下游 (这是真理，不受 Order 影响)
        const directChildren = new Set<P>();
        // for (const path of targetPaths) {
        fullGraph.get(targetPath)?.forEach((child) => directChildren.add(child));
        // }

        if (directChildren.size === 0) return [];

        // 2. 局部权重决策：在这些直接下游中，谁该现在跑？
        // 我们不再去查全局 Order 的 Level 0, 1, 2...
        // 我们只看：在这些 children 中，有没有人是“互相依赖”的？

        return Array.from(directChildren).filter((child) => {
            // 1. 找到这个孩子的所有依赖（爸爸们）
            const allMyParents = predecessorGraph.get(child) || new Set();

            // 2. 看看这些爸爸里，有没有人正待在“本次待处理”的名单中
            const isAnyParentWaiting = Array.from(allMyParents).some((parent) =>
                directChildren.has(parent)
            );

            // 3. 如果没有任何爸爸在等，说明我是这波里辈分最大的，我可以走
            const iAmReady = !isAnyParentWaiting;

            return iAmReady;
        });
    };
   
 
    const GetAllPrevDependency = (targetPath: P) => {
        const predecessorGraph = getPredecessorGraph();

        return Array.from(predecessorGraph.get(targetPath) || []);
    };
    const GetAllNextDependency = (targetPath: P) => {
        const fullGraph = getDependencyGraph();

        return Array.from(fullGraph.get(targetPath) || []);
    };

    const rebuildDirectDependencyMaps = (allPaths: P[]) => {
        const directNextMap = new Map<P, Set<P>>();
        const directPrevMap = new Map<P, Set<P>>();

        for (const path of allPaths) {
            // 1. 调用你那个“基于全量表计算直接下游”的方法
            const nexts = _GetNextDependency(path);
            directNextMap.set(path, new Set(nexts));

            // 2. 建立反向索引
            for (const nextPath of nexts) {
                if (!directPrevMap.has(nextPath)) {
                    directPrevMap.set(nextPath, new Set());
                }
                directPrevMap.get(nextPath)!.add(path);
            }
        }

        return { directNextMap, directPrevMap };
    };

    const GetNextDependency = (targetPath: P) => {
        const map = getDirectChildDependencyGraph();
        
        return Array.from(map.get(targetPath) || [])
    }
    const GetPrevDependency = (targetPath: P) => {
        const map = getDirectParentDependencyGraph();
        return Array.from(map.get(targetPath) || [])
    }

    return {
        GetNextDependency,
        GetPrevDependency,
        GetAllPrevDependency,
        GetAllNextDependency,
        rebuildDirectDependencyMaps,
    };
}

export function useCheckCycleInGraph<T>(
    dependencyGraph: Map<T, Set<T>>
) {
    const solve = (inDegreeMap: Map<T, number>): { steps:T[][] , levelMap:Map<T,number>} => {
        const result: T[][] = [];
        // 使用临时队列存储当前层级
        let queue: T[] = [];

        const tempLevelMap = new Map<T, number>();

        const len = inDegreeMap.size;
        let processedCount = 0;
        let currentLevel = 0;

        // 1. 找出第一层（初始入度为 0 的节点）
        for (let [path, value] of inDegreeMap) {
            if (value === 0) {
                queue.push(path);
            }
        }

        if (queue.length === 0 && len > 0) {
            throw Error("Circular dependency detected");
        }

        // 2. 逐层剥离
        while (queue.length > 0) {
            // 💡 这一层的节点都在 queue 里
            result.push([...queue]);
            const nextQueue: T[] = [];

            // 处理当前层的所有节点
            for (const current of queue) {
                processedCount++;
                tempLevelMap.set(current, currentLevel); // 记录到临时表

                const neighbors = dependencyGraph.get(current);
                
                if (neighbors) {
                    for (const child of neighbors) {
                        const newDegree = inDegreeMap.get(child)! - 1;
                        inDegreeMap.set(child, newDegree);

                        // 💡 只有当下游节点的入度刚好减到 0 时，它才进入“下一层”的队列
                        if (newDegree === 0) {
                            nextQueue.push(child);
                        }
                    }
                }
            }

            // 切换到下一层
            queue = nextQueue;
            currentLevel++;
        }

        if (processedCount < len) {
            throw Error("Circular dependency detected");
        }
         
        return { 
            steps: result, 
            levelMap: tempLevelMap 
        };
    };

    const check = () => {
        const inDegreeMap: Map<T, number> = new Map();

        for (let item of dependencyGraph.keys()) {
            let paths = Array.from(dependencyGraph.get(item) || []);

            if (!inDegreeMap.has(item)) {
                inDegreeMap.set(item, 0);
            }

            for (let path of paths) {
                let num = inDegreeMap.get(path) || 0;
                inDegreeMap.set(path, ++num);
            }
        }

        return solve(inDegreeMap);
    };

    return check;
}
