import {
  EntangleArgType,
  EntangleGhost,
  MeshFlowTaskNode,
  MeshPath,
  MeshEmit,
  MeshErrorContext
} from "../types/types";
import { createScheduler } from "../utils/util";

type EntangleRoute<P extends MeshPath> = {
  target: P;
  emit: EntangleArgType<P>["emit"];
  filter?: (obs: any, tgt: any) => boolean;
  count: number;
};

export const UseSetEntangle = <P extends MeshPath, NM>(
  config: {
    useEntangleStep: number
  },
  timeScheduler: ReturnType<typeof createScheduler>,
  getPathToLevelMap: () => Map<P, number>,
  GetNodeByPath: (path: P) => MeshFlowTaskNode<P, any, NM>,
 
  hooks:{
    emit: MeshEmit,
    onError: (error: MeshErrorContext) => void
  }
  
) => {
  const MAX_ENTANGLE_DEPTH = config.useEntangleStep;
 
  const _registry = new Map<P, Map<string, EntangleRoute<P>[]>>();
  const _ghostBuffer = new Map<P, EntangleGhost[]>();
  const _volatileLevels = new Set<number>();

  const _GetNodeByPath = GetNodeByPath;

  
  
  let _onSettle: (() => void) | null = null;

  // 全局异步任务飞行计数器
  let activeAsyncCount = 0;

  const updateEntangleLevel = () => {
     
    const levelMap = getPathToLevelMap();
    // if (!levelMap || levelMap.size === 0) return;
    
    _volatileLevels.clear();
    for (const observer of _registry.keys()) {
      const level = levelMap.get(observer)||0;
      // if (level !== undefined) {
        _volatileLevels.add(level);
      // } else {
      //   hooks.emit('entangle:warn' as any, { path: observer as string, type: 'no_level' });
      // }
    }
  };

  const useEntangle = (config: EntangleArgType<P>) => {
    const { observer, target, triggerKeys, emit: entangleEmit,filter } = config;
   
    if (!triggerKeys || triggerKeys.length === 0) {
      hooks.emit('entangle:warn' as any, { path: observer as string, type: 'no_keys' });
      return;
    }

    if (!_registry.has(observer)) {
      _registry.set(observer, new Map());
    }
     
    const obsMap = _registry.get(observer)!;

    triggerKeys.forEach((key) => {
      if (!obsMap.has(key)) {
        obsMap.set(key, []);
      }
      obsMap.get(key)!.push({ target, emit: entangleEmit, filter, count: 0 });
    });
     
  };

  const Turnstile: any = {
    volatileLevels: _volatileLevels,

    get inFlightCount() {
      
      return activeAsyncCount;
    },

    get hasPendingGhosts() {
      for (const ghosts of _ghostBuffer.values()) {
        if (ghosts.length > 0) return true;
      }
      return false;
    },

    onSettle: (cb: () => void) => { _onSettle = cb; },

    hasObserver: (path: P) => {
      
      return _registry.has(path)
    },

    getTriggerKeys: (path: P): string[] => {
      const obsMap = _registry.get(path);
      return obsMap ? Array.from(obsMap.keys()) : [];
    },

    receiveGhosts: (observerNode: MeshFlowTaskNode<P, any, NM>, changedKeys: string[] = []): P[] | Promise<P[]> => {
 
 

      const observerPath = observerNode.path;
      const hitTargets: P[] = [];

      const obsMap = _registry.get(observerPath);
      if (!obsMap || changedKeys.length === 0) return hitTargets;

      const routesToFire = new Set<EntangleRoute<P>>();

      changedKeys.forEach(key => {
        const routes = obsMap.get(key);
        if (routes) {
          routes.forEach(r => routesToFire.add(r));
        }
      });
       
      const isPromise = (obj: any): obj is Promise<any> => {
        return obj instanceof Promise || (obj !== null && typeof obj === 'object' && typeof obj.then === 'function');
      };

      const processRoute = (route: EntangleRoute<P>): Promise<void> | void => {
        const targetPath = route.target;

        if (route.count >= MAX_ENTANGLE_DEPTH) {
          
          hooks.emit('entangle:blocked' as any, { observer: observerPath as string, target: targetPath as string, count: route.count });
          return;
        }

        const currentNode = _GetNodeByPath(targetPath);

        if (route.filter && !route.filter(observerNode.proxy, currentNode.proxy)) {
          return; // 被过滤器挡下，静默拦截
        }
        const ghostProposalOrPromise = route.emit(observerNode.proxy, currentNode.proxy);

        const handleProposal = (ghostProposal: any) => {
          
          if (ghostProposal && ghostProposal.key !== undefined) {

            if (
              ghostProposal.delta === undefined && 
              ghostProposal.value !== undefined && 
              ghostProposal.value === currentNode.state[ghostProposal.key]
            ) {
              return; // 直接截断因果链！不上报 hitTargets，系统在此处恢复稳态！
            }

            route.count++;
            if (!_ghostBuffer.has(targetPath)) _ghostBuffer.set(targetPath, []);
            _ghostBuffer.get(targetPath)!.push({ weight: 1, ...ghostProposal });
            hitTargets.push(targetPath);
            
 
          }
        };

        if (isPromise(ghostProposalOrPromise)) {
          activeAsyncCount++;
  
          return (async () => {
            try {
              const res = await ghostProposalOrPromise;
 
              handleProposal(res);
            } catch (e) {
              hooks.emit('node:error', { path: observerPath, error: e });
              hooks.onError({ path: observerPath as any, error: e });
            } finally {
          
                activeAsyncCount--;
                // 🌟 核心：只有当天上没有幽灵时，才鸣枪！
                // if (activeAsyncCount === 0 && _onSettle) {
                //   _onSettle();
                // }
            }
          })();
        } else {
          handleProposal(ghostProposalOrPromise);
        }
      };

      const routesArray = Array.from(routesToFire);
      
      let i = 0;
      let wentAsync = false;
      let firstAsyncPromise: Promise<void> | null = null;

      // 第一阶段：尝试纯同步执行
      for (; i < routesArray.length; i++) {
        // 1. 如果当前帧时间耗尽，必须强制转为异步模式，把主线程还给 UI
        if (timeScheduler.shouldYield()) {
          // 🌟 修改点 2：在让位之前，向外部发射渲染请求，告诉 UI 此时可以先渲染已定型的中间态
          // uitrigger.requestUpdate(); 
          wentAsync = true;
          break;
        }

        const p = processRoute(routesArray[i]);
        if (p) {
          firstAsyncPromise = p;
          wentAsync = true;
          i++; 
          break;
        }
      }

      if (!wentAsync) {
        return Array.from(new Set(hitTargets));
      }

      return (async () => {
        if (firstAsyncPromise) {
          await firstAsyncPromise;
        }

        // 🌟 修改点 3：如果在进入大循环前就需要让位，发射更新信号
        if (timeScheduler.shouldYield()) {
          // uitrigger.requestUpdate();
          await timeScheduler.yieldToMain();
        }

        const CHUNK_SIZE = 50; 
        for (; i < routesArray.length; i += CHUNK_SIZE) {
          const chunkRoutes = routesArray.slice(i, i + CHUNK_SIZE);
          const chunkPromises: Promise<void>[] = [];

          for (const route of chunkRoutes) {
            const p = processRoute(route);
            if (p) chunkPromises.push(p);
          }

          if (chunkPromises.length > 0) {
            // 🌟 修改点 4：包裹并发任务。任何一个任务完成如果超时了，立刻请求 UI 渲染并让位
            const wrappedChunk = chunkPromises.map(async (p) => {
              await p;
              if (timeScheduler.shouldYield()) {
                // uitrigger.requestUpdate();
                await timeScheduler.yieldToMain();
              }
            });
            await Promise.all(wrappedChunk);
          }

          // 🌟 修改点 5：Chunk 批次之间，同样进行渲染探测
          if (timeScheduler.shouldYield()) {
            // uitrigger.requestUpdate();
            await timeScheduler.yieldToMain();
          }
        }

        return Array.from(new Set(hitTargets));
      })();
    },

    resolveGhosts: (node: MeshFlowTaskNode<P, any, NM>): string[] => {
      const targetPath = node.path;
      const buffer = _ghostBuffer.get(targetPath);
      
      if (!buffer || buffer.length === 0) return [];

      const changedKeys: string[] = [];
      const proposalsByKey = new Map<string, EntangleGhost[]>();

      for (const p of buffer) {
        if (!proposalsByKey.has(p.key)) proposalsByKey.set(p.key, []);
        proposalsByKey.get(p.key)!.push(p);
      }

      for (const [key, proposals] of proposalsByKey.entries()) {
        let finalValue = node.state[key];
        
        // patch优先级最高，存在时直接用patch计算，忽略其他规则
        const patchProposals = proposals.filter((p) => p.patch !== undefined);
        if (patchProposals.length > 0) {
          // 多个patch按顺序叠加执行
          finalValue = patchProposals.reduce((acc, p) => {
            return p.patch!(acc);
          }, finalValue);
        } else {
          // 没有patch才走原来的规则
          const deltaProposals = proposals.filter((p) => p.delta !== undefined);
          const setProposals = proposals.filter((p) => p.value !== undefined);
      
          if (setProposals.length > 0) {
            const winner = setProposals.reduce((prev, curr) =>
              (curr.weight ?? 1) >= (prev.weight ?? 1) ? curr : prev
            );
            finalValue = winner.value;
          }
      
          if (deltaProposals.length > 0) {
            finalValue = deltaProposals.reduce((acc, p) => {
              const op = p.op || "add";
              switch (op) {
                case "add":
                  return (typeof acc === "number" ? acc : 0) + p.delta;
                case "remove":
                  return Array.isArray(acc) ? acc.filter(v => v !== p.delta) : acc;
                case "intersect":
                  return Array.isArray(acc) ? acc.filter(v => p.delta.includes(v)) : p.delta;
                case "union": {
                  const baseArr = Array.isArray(acc) ? acc : [];
                  const newItems = Array.isArray(p.delta) ? p.delta : [p.delta];
                  return [...new Set([...baseArr, ...newItems])];
                }
                case "merge": {
                  const baseObj = (typeof acc === "object" && acc !== null && !Array.isArray(acc)) ? acc : {};
                  const patch = (typeof p.delta === "object" && p.delta !== null && !Array.isArray(p.delta)) ? p.delta : {};
                  return { ...baseObj, ...patch };
                }
                default:
                  return acc;
              }
            }, finalValue);
          }
        }
      
        if (!Object.is(node.state[key], finalValue)) {
          node.state[key] = finalValue;
          changedKeys.push(key);
        }
      }
      // for (const [key, proposals] of proposalsByKey.entries()) {
      //   let finalValue = node.state[key];
      //   const deltaProposals = proposals.filter((p) => p.delta !== undefined);
      //   const setProposals = proposals.filter((p) => p.value !== undefined);

      //   if (setProposals.length > 0) {
      //     const winner = setProposals.reduce((prev, curr) =>
      //       (curr.weight ?? 1) >= (prev.weight ?? 1) ? curr : prev
      //     );
      //     finalValue = winner.value;
      //   }

      //   if (deltaProposals.length > 0) {
      //     // const totalDelta = deltaProposals.reduce((sum, p) => sum + p.delta!, 0);
      //     // const nextVal = (typeof finalValue === "number" ? finalValue : 0) + totalDelta;
      //     // finalValue = Math.max(0, parseFloat(nextVal.toFixed(6)));
      //     finalValue = deltaProposals.reduce((acc, p) => {
      //       const op = p.op || "add"; // 默认 add 兼容老代码
      
      //       switch (op) {
      //         case "add":
      //           return (typeof acc === "number" ? acc : 0) + p.delta;
      
      //         case "remove":
      //           // 数组剔除：如果基准是 [1,2,3]，邻居说 remove 2，结果就是 [1,3]
      //           return Array.isArray(acc) ? acc.filter(v => v !== p.delta) : acc;
      
      //         case "intersect":
      //           // 交集过滤： 
      //           return Array.isArray(acc) ? acc.filter(v => p.delta.includes(v)) : p.delta;
      
      //         case "union":
      //           // 并集去重
      //           const baseArr = Array.isArray(acc) ? acc : [];
      //           const newItems = Array.isArray(p.delta) ? p.delta : [p.delta];
      //           return [...new Set([...baseArr, ...newItems])];
      
      //         case "merge": {
      //           const baseObj = (typeof acc === "object" && acc !== null && !Array.isArray(acc)) ? acc : {};
      //           const patch = (typeof p.delta === "object" && p.delta !== null && !Array.isArray(p.delta)) ? p.delta : {};
      //           return { ...baseObj, ...patch };
      //         }

      //         default:
      //           return acc;
      //       }
      //     }, finalValue);
      //   }

      //   if (!Object.is(node.state[key], finalValue)) {
      //     node.state[key] = finalValue;
      //     changedKeys.push(key);
      //   }
      // }

      _ghostBuffer.set(targetPath, []);

      if (changedKeys.length > 0) {
        return changedKeys;
      }

      return [];
    },

    resetCounters: () => {
      for (const obsMap of _registry.values()) {
        for (const routes of obsMap.values()) {
          routes.forEach(r => r.count = 0);
        }
      }
    },
  };

  return {
    useEntangle,
    updateEntangleLevel,
    Turnstile,
  };
};