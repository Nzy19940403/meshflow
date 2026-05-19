import {
  EntangleArgType,
  EntangleGhost,
  MeshFlowTaskNode,
  MeshPath,
  MeshEmit,
  MeshErrorContext,
  GhostProposalApi,
  EntangleOp,
  MeshFlowEventsName,
  MeshFlowHistory,
  InternalMeshFlowHistory
} from "../types/types";
import { createTimeScheduler } from "../utils/util";

type EntangleLink<P extends MeshPath,NM> = {
  impact: P;
  triggerKey: MeshPath;
  filter?: (obs: any, tgt: any) => boolean;
  emit:(src:any,tgt:any,propose:GhostProposalApi<any,NM>) => void | EntangleGhost<any> | undefined | Promise<void | EntangleGhost<any> | undefined>; 
  count: number;
  isProxy:boolean;
  _inBatch: boolean;
};

export const UseSetEntangle = <P extends MeshPath, NM>(
  config: { useEntangleStep: number },
  timeScheduler: ReturnType<typeof createTimeScheduler>,
  GetUidToLevelMap: () => Map<number, number>,
  GetNodeByPath: (path: P) => MeshFlowTaskNode<P, any, NM>,
  GetNodeByUid: (uid: number) => MeshFlowTaskNode<P, any, NM>,
  GetPathByUid: (uid: number) => P,
  hooks: {
    emit: MeshEmit,
    onError: (error: MeshErrorContext) => void
  },
  history:InternalMeshFlowHistory
) => {
  const MAX_ENTANGLE_DEPTH = config.useEntangleStep;

  const _registry: Array<Map<MeshPath, EntangleLink<P,NM>[]>> = [];
  const _ghostBuffer: Array<EntangleGhost[]> = [];
  const _volatileLevels = new Set<number>();

  const _entangleMutations = new Map<string, { path: any; key: any; oldVal: any; newVal: any }>();

  const _GetNodeByPath = GetNodeByPath;
  const _GetNodeByUid = GetNodeByUid;
  const _GetPathByUid = GetPathByUid;
  const _GetUidToLevelMap = GetUidToLevelMap;

  let activeAsyncCount = 0;
  // 🌟 优化点 1：用 O(1) 计数器替代数组扫描
  let pendingGhostNodesCount = 0; 

  let currentEpoch = 0;

  let _linkId = 0;

  const MESH_CAPACITY = 100;

  const EMIT_PAYLOAD  = {
    observer: "" as any,
    target: "" as any,
    via: null as any,
    count:0 ,
    path:'' as any,
    error:null as any,
    type:'' as "no_keys" | "no_level"
  };
  const RESOLVE_PAYLOAD = {
    path: "" as any,
    key: "" as any,
    value: null as any,
    calledBy: 1, // 1 代表 QUANTUM/RESOLVE，与你的底层对齐
    triggerPath: null as any // 幽灵由多源提案汇总，物理上游是多维的，这里设为 null 即可
  };

  const createPoolCell = () => {
    const cell: any = {
      link: null,
      impactNode: null,
      impactUid: -1,
      hitTargetUids: null,
      isDirty: false,
      propose: null
    };

    cell.propose = {
      set: (key: string, value: any, weight = 1) => {
        if (cell.epoch !== currentEpoch) return;

        if (value === cell.impactNode.state[key]) return;
        cell.link.count++;
        
        // 🌟 O(1) 幽灵追踪：如果这是该节点第一个幽灵，计数器 +1
        if (!_ghostBuffer[cell.impactUid] || _ghostBuffer[cell.impactUid].length === 0) {
          _ghostBuffer[cell.impactUid] = [];
          pendingGhostNodesCount++;
        }
        _ghostBuffer[cell.impactUid].push({ key, value, weight });
        
        if (!cell.isDirty) {
          cell.hitTargetUids.push(cell.impactUid);
          cell.isDirty = true;
        }
      },
      update: (key: string, delta: any, op: EntangleOp = "add") => {
        if (cell.epoch !== currentEpoch) return;

        cell.link.count++;
        if (!_ghostBuffer[cell.impactUid] || _ghostBuffer[cell.impactUid].length === 0) {
          _ghostBuffer[cell.impactUid] = [];
          pendingGhostNodesCount++;
        }
        _ghostBuffer[cell.impactUid].push({ key, delta, op, weight: 1 });
        
        if (!cell.isDirty) {
          cell.hitTargetUids.push(cell.impactUid);
          cell.isDirty = true;
        }
      },
      patch: (key: string, patchFn: (oldState: any) => any) => {
        if (cell.epoch !== currentEpoch) return;

        cell.link.count++;
        if (!_ghostBuffer[cell.impactUid] || _ghostBuffer[cell.impactUid].length === 0) {
          _ghostBuffer[cell.impactUid] = [];
          pendingGhostNodesCount++;
        }
        _ghostBuffer[cell.impactUid].push({ key, patch: patchFn, weight: 1 });
        
        if (!cell.isDirty) {
          cell.hitTargetUids.push(cell.impactUid);
          cell.isDirty = true;
        }
      }
    };
    return cell;
  };

  const contextPool = Array.from({ length: MESH_CAPACITY }, createPoolCell);
  let poolCursor = MESH_CAPACITY - 1;

  const processLink = (
    link: EntangleLink<P,NM>, 
    causeNode: MeshFlowTaskNode<P, any, NM>, 
    hitTargetUids: number[],
  ): Promise<void> | void => {
    const causePath = causeNode.path;
    const impactPath = link.impact;

    if (link.count >= MAX_ENTANGLE_DEPTH) {
      EMIT_PAYLOAD.observer = causePath;
      EMIT_PAYLOAD.target = impactPath;
      EMIT_PAYLOAD.count = link.count;
      hooks.emit(MeshFlowEventsName.EntangleBlocked, EMIT_PAYLOAD);
      return;
    }

    const impactNode = _GetNodeByPath(impactPath);
    const causeArg = link.isProxy ? causeNode.proxy : causeNode;
    const impactArg = link.isProxy ? impactNode.proxy : impactNode;

    if (link.filter && !link.filter(causeArg, impactArg)) return;

    let cell;
    let isFromPool = true;

    if (poolCursor < 0) {
      cell = createPoolCell();
      isFromPool = false;
    } else {
      cell = contextPool[poolCursor--];
    }

 
    const runEpoch = currentEpoch;
    cell.epoch = runEpoch;

    cell.isDirty = false;
    cell.link = link;
    cell.impactNode = impactNode;
    cell.impactUid = impactNode.uid;
    cell.hitTargetUids = hitTargetUids;

    const emitResult = link.emit(causeArg, impactArg, cell.propose);
    EMIT_PAYLOAD.observer = causePath;
    EMIT_PAYLOAD.target = impactPath;
    EMIT_PAYLOAD.via = link.triggerKey;
    hooks.emit(MeshFlowEventsName.EntangleEmitCalled,EMIT_PAYLOAD);
    if (emitResult instanceof Promise || (emitResult && typeof (emitResult as any).then === 'function')) {
      activeAsyncCount++;
      return (async () => {
        try {
          await emitResult; 
        } catch (e) {
          EMIT_PAYLOAD.path = causePath;
          EMIT_PAYLOAD.error = e;
          hooks.emit(MeshFlowEventsName.NodeError, EMIT_PAYLOAD);
          hooks.onError({ path: causePath as string, error: e as Error });
        } finally {
          // activeAsyncCount--;
          if (runEpoch === currentEpoch) {
            activeAsyncCount--;
          }
          if (isFromPool) {
            contextPool[++poolCursor] = cell; 
          }
        }
      })();
    } else {
      if (isFromPool) {
        contextPool[++poolCursor] = cell;
      }
    }
  };

  const updateEntangleLevel = () => {
    const levelMap = _GetUidToLevelMap();
    _volatileLevels.clear();
    for (let uid = 0; uid < _registry.length; uid++) {
      if (_registry[uid] !== undefined) {
        const level = levelMap.get(uid) || 0;
        _volatileLevels.add(level);
      }
    }
  };

  const useEntangle = (config: EntangleArgType<P>) => {
    const { cause, impact, via, emit, filter, isProxy } = config;
    
    if (!via || via.length === 0) {
      EMIT_PAYLOAD.path = cause;
      EMIT_PAYLOAD.type = 'no_keys';
      hooks.emit(MeshFlowEventsName.EntangleWarn , EMIT_PAYLOAD);
      return;
    }

    const causeNode = _GetNodeByPath(cause);
    const causeUid = causeNode.uid;

    if (!_registry[causeUid]) {
      _registry[causeUid] = new Map();
    }
      
    const causeMap = _registry[causeUid];
    _linkId++;
    const sharedLink: EntangleLink<P, NM> = {
      impact,
      triggerKey: via as any, // 这里原本是单个 string，现在直接存 via 数组方便溯源
      emit: emit as any,
      filter,
      count: 0,
      isProxy: !!isProxy,
      _inBatch:false
    };
    for (let i = 0; i < via.length; i++) {
      const key = via[i];
      if (!causeMap.has(key)) causeMap.set(key, []);
      // causeMap.get(key)!.push({ triggerKey:key,impact, emit: emit as any, filter, count: 0, isProxy: !!isProxy });
      causeMap.get(key)!.push(sharedLink);
    }
  };

  const Turnstile: any = {
    volatileLevels: _volatileLevels,

    get inFlightCount() {
      return activeAsyncCount;
    },

    // 🌟 优化点 1 收益：全 O(1) 返回，极致性能
    get hasPendingGhosts() {
      return pendingGhostNodesCount > 0;
    },

    nextEpoch: () => {
      currentEpoch++; // 历史长河往前走一步，之前的幽灵全部沦为“前朝丧尸”
 
    },
    reset:()=>{
      currentEpoch=0;
      activeAsyncCount = 0; // 旋转门本朝计数瞬间清零
      pendingGhostNodesCount = 0; // 待结算幽灵节点数清零
      _ghostBuffer.length = 0; 
    },
    hasObserver: (uid: number) => {
      return _registry[uid] !== undefined;
    },

    getTriggerKeys: (uid: number): MeshPath[] => {
      const causeMap = _registry[uid];
      return causeMap ? Array.from(causeMap.keys()) : [];
    },

    receiveGhosts: (causeNode: MeshFlowTaskNode<P, any, NM>, changedKeys: string[] = []): number[] | Promise<number[]> => {
      const causeUid = causeNode.uid;
      const hitTargetUids: number[] = [];
      const causeMap = _registry[causeUid];

      if (!causeMap || changedKeys.length === 0) return hitTargetUids;

      const linksArray: EntangleLink<P,NM>[] = [];
    
      // 🌟 优化点 2：彻底砍掉 impactBuffer 的 new Set。原生数组极速展平。
      for (let k = 0; k < changedKeys.length; k++) {
        const links = causeMap.get(changedKeys[k]);
        if (links) {
          for (let j = 0; j < links.length; j++) {
            // linksArray.push(links[j]);
            const link = links[j];
            if (link._inBatch !== true) {
              link._inBatch = true;
              linksArray.push(link);
            }
          }
        }
      }
      
      for (let x = 0; x < linksArray.length; x++) {
        linksArray[x]._inBatch = false;
      }

      let i = 0;
      let wentAsync = false;
      let firstAsyncPromise: Promise<void> | null = null;

      for (; i < linksArray.length; i++) {
        if (timeScheduler.shouldYield()) {
          wentAsync = true;
          break;
        }

        const p = processLink(linksArray[i], causeNode, hitTargetUids);
        if (p) {
          firstAsyncPromise = p;
          wentAsync = true;
          i++; 
          break;
        }
      }

      // 🌟 提取的公共轻量级去重方法 (替代末尾的 Array.from(new Set))
      const getUniqueHits = () => {
        if (hitTargetUids.length <= 1) return hitTargetUids;
        const unique: number[] = [];
        const seen = Object.create(null); // 极轻量级字典，无原型链
        for (let j = 0; j < hitTargetUids.length; j++) {
          const u = hitTargetUids[j];
          if (!seen[u]) { seen[u] = true; unique.push(u); }
        }
        return unique;
      };

      if (!wentAsync) {
        return getUniqueHits();
      }

      return (async () => {
        if (firstAsyncPromise) await firstAsyncPromise;
        if (timeScheduler.shouldYield()) await timeScheduler.yieldToMain();

        for (; i < linksArray.length; ) {
          const chunkPromises: Promise<void>[] = [];
          const boundary = Math.min(i + MESH_CAPACITY, linksArray.length);

          for (; i < boundary; i++) {
            const p = processLink(linksArray[i], causeNode, hitTargetUids);
            if (p) chunkPromises.push(p);
          }

          if (chunkPromises.length > 0) {
            await Promise.all(chunkPromises.map(async (p) => {
              await p;
              if (timeScheduler.shouldYield()) await timeScheduler.yieldToMain();
            }));
          }

          if (timeScheduler.shouldYield()) await timeScheduler.yieldToMain();
        }

        return getUniqueHits();
      })();
    },

    resolveGhosts: (node: MeshFlowTaskNode<P, any, NM>): string[] => {
      const targetUid = node.uid;
      const buffer = _ghostBuffer[targetUid];
      
      if (!buffer || buffer.length === 0) return [];

      const changedKeys: string[] = [];
      // 🌟 优化点 3：用极其轻量的 Object.create(null) 替代 Map
      const proposalsByKey: Record<string, EntangleGhost[]> = Object.create(null);

      for (let i = 0; i < buffer.length; i++) {
        const p = buffer[i];
        if (!proposalsByKey[p.key]) proposalsByKey[p.key] = [];
        proposalsByKey[p.key].push(p);
      }

      // 🌟 优化点 4：消灭 Reduce 和 Filter 嵌套，改为一趟遍历！
      for (const key in proposalsByKey) {
        const proposals = proposalsByKey[key];
        let finalValue = node.state[key];

        const originalValue = finalValue;

        let bestSetVal: any;
        let bestSetWeight = -Infinity;
        let hasSet = false;

        // Pass 1: 先处理 Patch 和 Set (保持你的业务顺序)
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i];
          if (p.patch !== undefined) {
            finalValue = p.patch(finalValue);
          }
          if (p.value !== undefined) {
            const weight = p.weight ?? 1;
            if (weight >= bestSetWeight) {
              bestSetWeight = weight;
              bestSetVal = p.value;
              hasSet = true;
            }
          }
        }

        if (hasSet) finalValue = bestSetVal;

        // Pass 2: 处理 Delta 运算
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i];
          if (p.delta !== undefined) {
            const op:EntangleOp = p.op || "add";
            switch (op) {
              case "add": 
                finalValue = (typeof finalValue === "number" ? finalValue : 0) + p.delta; break;
              case "remove": 
                finalValue = Array.isArray(finalValue) ? finalValue.filter(v => v !== p.delta) : finalValue; break;
              case "intersect": 
                finalValue = Array.isArray(finalValue) ? finalValue.filter(v => p.delta.includes(v)) : p.delta; break;
              case "union": {
                const baseArr = Array.isArray(finalValue) ? finalValue : [];
                const newItems = Array.isArray(p.delta) ? p.delta : [p.delta];
                // 这里的 Set 是业务逻辑必须的（交并集计算），保留无妨
                finalValue = [...new Set([...baseArr, ...newItems])]; 
                break;
              }
              case "merge": {
                const baseObj = (typeof finalValue === "object" && finalValue !== null && !Array.isArray(finalValue)) ? finalValue : {};
                const patch = (typeof p.delta === "object" && p.delta !== null && !Array.isArray(p.delta)) ? p.delta : {};
                finalValue = { ...baseObj, ...patch };
                break;
              }
            }
          }
        }
      
        if (!Object.is(node.state[key], finalValue)) {
          node.state[key] = finalValue;
          const compositeKey = `${node.path as string}::${key}`;
          if (!_entangleMutations.has(compositeKey)) {
            // 如果是当前事务第一次修改这个节点，记录它的“初恋值”
            _entangleMutations.set(compositeKey, {
              path: node.path as string,
              key: key,
              oldVal: originalValue,
              newVal: finalValue
            });
          } else {
            // 如果这个节点已经被纠缠修改过多次（震荡中），只更新它的“现任值”
            _entangleMutations.get(compositeKey)!.newVal = finalValue;
          }
          changedKeys.push(key);
          
          // 🌟 核心修改点：在这里将异变事件发射出去！
          // 复用 NodeBucketSuccess 或者你们用于追踪属性变更的核心 Event
          RESOLVE_PAYLOAD.path = node.path;
          RESOLVE_PAYLOAD.key = key;
          RESOLVE_PAYLOAD.value = finalValue;
          // (calledBy: 1 已经在初始化时写死，代表它是量子纠缠导致的)
          hooks.emit(MeshFlowEventsName.NodeBucketSuccess, RESOLVE_PAYLOAD as any);
        }
      }

      // 清空，并且追踪器 -1
      _ghostBuffer[targetUid] = [];
      pendingGhostNodesCount--; 
      
      return changedKeys.length > 0 ? changedKeys : [];
    },

    resetCounters: () => {
      for (let i = 0; i < _registry.length; i++) {
        const obsMap = _registry[i];
        if (obsMap) {
          for (const routes of obsMap.values()) {
            for (let j = 0; j < routes.length; j++) {
              routes[j].count = 0;
            }
          }
        }
      }
    },
    commit:()=>{
       
      if(!(history && history.GetCurrentVersion))  return;
      if(!(history.CommitTransaction))  return;
      if(!(history.RecordMutation))  return;
  
     
      const ver = history.GetCurrentVersion();
        
      for (const mutation of _entangleMutations.values()) {
        // 🛡️ 终极防线：如果一个节点在经历了 450 代震荡后，
        // 最终算出来的值和最初的值居然一模一样（比如转了一圈抵消了）。
        // 这种“无净位移”的变动，不需要塞进历史栈！
         
        if (!Object.is(mutation.oldVal, mutation.newVal)) {
          
          // 调用历史模块记录 (参数视你 History 模块实际接口而定，这里假设传对象)
          history.RecordMutation(
            mutation.path,
            mutation.key,
            mutation.oldVal,
            mutation.newVal
          );
          
        }
      }

      // 🌟 2. 极其重要：把本轮的事务快照物理清空，干干净净迎接下一次点火！
      _entangleMutations.clear();
      history.CommitTransaction(ver)
   
    }
  };

  return {
    useEntangle,
    updateEntangleLevel,
    Turnstile,
  };
};