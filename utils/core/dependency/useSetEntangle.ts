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
  
  InternalMeshFlowHistory,
   
} from "../types/types";
import { createTimeScheduler } from "../utils/util";

type EntangleLink<P extends MeshPath,NM> = {
  impact: P;
  triggerKey: MeshPath[];
  filter?: (obs: any, tgt: any) => boolean;
  emit:(src:any,tgt:any,propose:GhostProposalApi<any,NM>) => void | EntangleGhost<any> | undefined | Promise<void | EntangleGhost<any> | undefined>; 
  count: number;
  isProxy:boolean;
  _inBatch: boolean;
};

/**
 * [BOT] 缠结转门 (Turnstile) — 纪元并发控制接口
 *
 * "旋转门"隐喻: 每个纪元是一扇旋转门。_nextEpoch() 推进后，
 * 旧纪元提案仍可被 resolveGhosts 处理，新纪元 epoch 标记
 * 会使旧纪元的 propose 调用自动失效，确保多轮纠缠不互相污染。
 */
export interface EntangleTurnstile<P extends MeshPath, NM> {
  volatileLevels: Set<number>;
  
  // Getter 属性使用 readonly 标记
  readonly inFlightCount: number;
  readonly hasPendingGhosts: boolean;
  
  _nextEpoch: () => void;
  reset: () => void;
  _hasObserver: (uid: number) => boolean;
  _getTriggerKeys: (uid: number) => MeshPath[];
  
  // 核心演化与幽灵解析方法
  _receiveGhosts: (
    causeNode: MeshFlowTaskNode<P, any, NM>, 
    changedKeys?: MeshPath[]
  ) => number[] | Promise<number[]>;
  
  _resolveGhosts: (node: MeshFlowTaskNode<P, any, NM>) => string[];
  
  resetCounters: () => void;
  commit: () => void;
}

// 🌟 2. 定义 UseSetEntangle 的整体返回值
export interface UseSetEntangleReturn<P extends MeshPath, NM> {
  _useEntangle: (config: EntangleArgType<P>) => void;
  _updateEntangleLevel: () => void;
  Turnstile: EntangleTurnstile<P, NM>;
  _dispose:()=>void
}

export const UseSetEntangle = <P extends MeshPath, NM>(
  config: { useEntangleStep: number },
  timeScheduler: ReturnType<typeof createTimeScheduler>,
  GetUidToLevelMap: () => Map<number, number>,
  GetNodeByPath: (path: P) => MeshFlowTaskNode<P, any, NM>,
  // GetNodeByUid: (uid: number) => MeshFlowTaskNode<P, any, NM>,
  // GetPathByUid: (uid: number) => P,
  hooks: {
    emit: MeshEmit,
    onError: (error: MeshErrorContext) => void
  },
  history:InternalMeshFlowHistory
): UseSetEntangleReturn<P, NM> => {
  const MAX_ENTANGLE_DEPTH = config.useEntangleStep;

  // const _registry: Array<Map<MeshPath, EntangleLink<P,NM>[]>> = [];
  const _ghostBuffer: Array<EntangleGhost[]> = [];
  const _volatileLevels = new Set<number>();

  const _entangleMutations = new Map<string, { path: any; key: any; oldVal: any; newVal: any }>();

  const _allLinks: EntangleLink<P, NM>[] = [];

  const _uidToKeysCache: MeshPath[][] = [];
  
  const _uidToLinks: EntangleLink<P, NM>[][] = [];

  const _sharedSeenMap: boolean[] = [];
  const _dedupeUidsFast = (uids: number[]): number[] => {
    if (uids.length <= 1) return uids;
    
    const unique: number[] = [];
    for (let j = 0; j < uids.length; j++) {
      const u = uids[j];
      // 利用 V8 数组下标准确寻址，极速判断
      if (_sharedSeenMap[u] !== true) {
        _sharedSeenMap[u] = true;
        unique.push(u);
      }
    }
    
    // 清理现场：极其重要，保证下次进入时这块内存是干净的
    for (let j = 0; j < unique.length; j++) {
      _sharedSeenMap[unique[j]] = false; 
    }
    
    return unique;
  };

  const _GetNodeByPath = GetNodeByPath;
  // const _GetNodeByUid = GetNodeByUid;
  // const _GetPathByUid = GetPathByUid;
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
    type:'' as "no_keys" | "no_level",
    triggerPath: null as any
  };
  const RESOLVE_PAYLOAD = {
    path: "" as any,
    key: "" as any,
    value: null as any,
    calledBy: 1, // 1 代表 QUANTUM/RESOLVE，与你的底层对齐
    triggerPath: null as any // 幽灵由多源提案汇总，物理上游是多维的，这里设为 null 即可
  };

  /**
   * [BOT] 对象池单元工厂 — 每次纠缠链路执行时从此池借一个 cell
   *
   * cell 承载"发射→提案→收集→归还"的完整生命周期。
   *
   * ### propose 三种操作 (对应 GhostProposalApi):
   * - `set(key, value, weight=1)` — 绝对值覆盖。resolveGhosts 中最高权重获胜
   * - `update(key, delta, op)`   — 增量运算。支持 add/remove/intersect/union/merge
   * - `patch(key, patchFn)`      — 函数式补丁。以当前 state 为输入推导新值
   *
   * ### 同一 key 收到多个提案时的执行逻辑 (resolveGhosts 内部):
   *
   * **无论 emit 中 propose 的调用顺序如何，resolveGhosts 始终分两趟扫描:**
   *
   * Pass 1: 遍历同 key 的**全部**提案，找出权重最高的 set。
   *         有 set → finalValue = 最高权重 set 的值，threshold = 该权重
   *         无 set → finalValue = node.state[key] (当前值)，threshold = -Infinity
   *         （所以即使写 propose.patch(...); propose.set(...)，也是 set 先生效）
   *
   * Pass 2: 再次遍历全部提案，按 _ghostBuffer push 顺序依次执行:
   *         set → 已在 Pass1 处理，跳过
   *         patch → finalValue = patchFn(finalValue)
   *         update → 按 op 操作 finalValue
   *         权重 < threshold → 跳过（低权重 set 的跟随操作全部被否决）
   *
   * 举例 (无论哪种调用顺序，结果都一样):
   *   emit 中: propose.set('price', 100); propose.patch('price', v=>v+10)
   *   → Pass1: finalValue=100, Pass2: finalValue=100+10=110
   *
   *   emit 中: propose.patch('price', v=>v+10); propose.set('price', 100)
   *   → Pass1: finalValue=100 (先扫了全部提案找到 set), Pass2: 110
   *   **注意**: 即使 patch 写在 set 前面，结果也是 110 而非先 patch 再 set 覆盖 = 100
   *
   * ### 纪元隔离: cell.epoch !== currentEpoch → 提案被丢弃
   */
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
       
        // if (value === cell.impactNode.state[key]) return;
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
    viakeys: MeshPath[]
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

    
    EMIT_PAYLOAD.observer = causePath;
    EMIT_PAYLOAD.target = impactPath;
    // EMIT_PAYLOAD.via = link.triggerKey;
    EMIT_PAYLOAD.via = viakeys;
    hooks.emit(MeshFlowEventsName.EntangleEmitCalled,EMIT_PAYLOAD);
    const emitResult = link.emit(causeArg, impactArg, cell.propose);

    // if (emitResult instanceof Promise || (emitResult && typeof (emitResult as any).then === 'function')) {
    if (emitResult != null && typeof (emitResult as any).then === 'function'){
      activeAsyncCount++;
      return (async () => {
        try {
          await emitResult; 
        } catch (e) {
          EMIT_PAYLOAD.path = causePath;
          EMIT_PAYLOAD.error = e;
          EMIT_PAYLOAD.triggerPath = null
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

  const _updateEntangleLevel = () => {
    const levelMap = _GetUidToLevelMap();
    _volatileLevels.clear();
    // for (let uid = 0; uid < _registry.length; uid++) {
    //   if (_registry[uid] !== undefined) {
    //     const level = levelMap.get(uid) || 0;
    //     _volatileLevels.add(level);
    //   }
    // }
    for (let uid = 0; uid < _uidToLinks.length; uid++) {
      if (_uidToLinks[uid] !== undefined && _uidToLinks[uid].length > 0) {
        const level = levelMap.get(uid) || 0;
        _volatileLevels.add(level);
      }
    }
  };

  const _useEntangle = (config: EntangleArgType<P>) => {
    const { cause, impact, via, emit, filter, isProxy } = config;
    
    if (!via || via.length === 0) {
      EMIT_PAYLOAD.path = cause;
      EMIT_PAYLOAD.type = 'no_keys';
      hooks.emit(MeshFlowEventsName.EntangleWarn , EMIT_PAYLOAD);
      return;
    }

    const causeNode = _GetNodeByPath(cause);
    const causeUid = causeNode.uid;

    // if (!_registry[causeUid]) {
    //   _registry[causeUid] = new Map();
    // }
      
    // const causeMap = _registry[causeUid];

    if (!_uidToLinks[causeUid]) _uidToLinks[causeUid] = [];
    // 🌟 初始化该 UID 的 Keys 缓存槽位
    if (!_uidToKeysCache[causeUid]) _uidToKeysCache[causeUid] = [];
  
    const uidLinks = _uidToLinks[causeUid];
    const cachedKeys = _uidToKeysCache[causeUid];

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
    _allLinks.push(sharedLink);
    uidLinks.push(sharedLink)

    for (let i = 0; i < via.length; i++) {
      const key = via[i];
      if (cachedKeys.indexOf(key) === -1) {
        cachedKeys.push(key);
      }
    }

    // for (let i = 0; i < via.length; i++) {
    //   const key = via[i];
    //   if (!causeMap.has(key)) causeMap.set(key, []);
    //   // causeMap.get(key)!.push({ triggerKey:key,impact, emit: emit as any, filter, count: 0, isProxy: !!isProxy });
    //   causeMap.get(key)!.push(sharedLink);
    // }
  };

  const Turnstile: EntangleTurnstile<P, NM> = {
    volatileLevels: _volatileLevels,

    get inFlightCount() {
      return activeAsyncCount;
    },

    // 🌟 优化点 1 收益：全 O(1) 返回，极致性能
    get hasPendingGhosts() {
      return pendingGhostNodesCount > 0;
    },
    /**
     * @internal
    */
    _nextEpoch: () => {
      currentEpoch++; // 历史长河往前走一步，之前的幽灵全部沦为“前朝丧尸”
 
    },
    reset:()=>{
      currentEpoch=0;
      activeAsyncCount = 0; // 旋转门本朝计数瞬间清零
      pendingGhostNodesCount = 0; // 待结算幽灵节点数清零
      _ghostBuffer.length = 0; 
    },
    /**
     * @internal
    */
    _hasObserver: (uid: number) => {
      return _uidToLinks[uid] !== undefined && _uidToLinks[uid].length > 0;
    },
    /**
     * @internal
    */
    _getTriggerKeys: (uid: number): MeshPath[] => {
      // const causeMap = _registry[uid];
      // return causeMap ? Array.from(causeMap.keys()) : [];
      return _uidToKeysCache[uid] || [];
    },
    /**
     * @internal
    */
    _receiveGhosts: (causeNode: MeshFlowTaskNode<P, any, NM>, changedKeys: MeshPath[] = []): number[] | Promise<number[]> => {
      const causeUid = causeNode.uid;
      const hitTargetUids: number[] = [];
      const allLinksForThisUid = _uidToLinks[causeUid];

      if (!allLinksForThisUid || changedKeys.length === 0) return hitTargetUids;

      // 🌟 极限优化 1：使用平行数组（Parallel Arrays）彻底消灭临时对象 {}
      const activeLinks: EntangleLink<P, NM>[] = [];
      const activeKeysList: MeshPath[][] = [];
      let activeCount = 0;

      // 🌟 极限优化 2：彻底消灭 filter 和闭包，采用传统的 for 循环和惰性初始化
      for (let i = 0; i < allLinksForThisUid.length; i++) {
        const link = allLinksForThisUid[i];
        if (link._inBatch) continue;

        let matchedKeys: MeshPath[] | null = null; // 💧 惰性游标：没命中前，绝对不分配内存！
        const triggers = link.triggerKey;

        // 手写 O(N*M) 嵌套判断：因为 triggers 和 changedKeys 通常极小(1~3个元素)，
        // 在 V8 引擎中，这种没有任何函数调用的裸 for 循环，速度碾压一切 Array 原生方法。
        for (let c = 0; c < changedKeys.length; c++) {
          const key = changedKeys[c];
          for (let t = 0; t < triggers.length; t++) {
            if (key === triggers[t]) {
              if (matchedKeys === null) {
                matchedKeys = []; // 💥 只有真正发生碰撞了，才分配数组空间
              }
              matchedKeys.push(key);
              break; // 这个 key 命中了，不用再查 triggerKey 了，继续查下一个 changedKey
            }
          }
        }

        // 如果找到了交集，将其压入平行数组
        if (matchedKeys !== null) {
          link._inBatch = true;
          activeLinks[activeCount] = link;
          activeKeysList[activeCount] = matchedKeys;
          activeCount++;
        }
      }

      if (activeCount === 0) return hitTargetUids;

      // 立即恢复批次标记，保持无副作用
      for (let i = 0; i < activeCount; i++) {
        activeLinks[i]._inBatch = false;
      }

      // 🌟 3. 同步快速路径探测 (使用 while 循环精准控制边界)
      let processedCount = 0;
      let wentAsync = false;
      let firstAsyncPromise: Promise<void> | null = null;

      while (processedCount < activeCount) {
        if (timeScheduler._shouldYield()) {
          wentAsync = true;
          break; // 超时，将剩下的交给异步
        }

        // 🌟 直接从平行数组中按索引取值，没有任何解构和对象读取开销
        const p = processLink(
          activeLinks[processedCount], 
          causeNode, 
          hitTargetUids, 
          activeKeysList[processedCount]
        );
         
        processedCount++; // 处理完一个，指针向前推进

        if (p) {
          firstAsyncPromise = p;
          wentAsync = true;
          break; // 撞到异步，立刻跳出，此时 processedCount 刚好指向已被触发的这个异步任务之后
        }
      }

      // 性能最高路径：全部同步跑完
      if (!wentAsync) {
        return _dedupeUidsFast(hitTargetUids);
      }

      // 🌟 4. 异步分片阶段
      return (async () => {
        if (firstAsyncPromise) await firstAsyncPromise;
        if (timeScheduler._shouldYield()) await timeScheduler._yieldToMain();

        // 用传统的步进方式处理剩下的平行数组，避免 slice 产生新数组！
        for (let chunkStart = processedCount; chunkStart < activeCount; chunkStart += MESH_CAPACITY) {
          const chunkEnd = Math.min(chunkStart + MESH_CAPACITY, activeCount);
          const chunkPromises: Promise<void>[] = [];

          for (let idx = chunkStart; idx < chunkEnd; idx++) {
            const p = processLink(
              activeLinks[idx], 
              causeNode, 
              hitTargetUids, 
              activeKeysList[idx]
            );
            if (p) chunkPromises.push(p);
          }

          if (chunkPromises.length > 0) {
            await Promise.all(chunkPromises.map(async (p) => {
              await p;
              if (timeScheduler._shouldYield()) await timeScheduler._yieldToMain();
            }));
          }

          if (timeScheduler._shouldYield()) await timeScheduler._yieldToMain();
        }

        return _dedupeUidsFast(hitTargetUids);
      })();
    },

    _resolveGhosts: (node: MeshFlowTaskNode<P, any, NM>): string[] => {
    /**
     * [BOT] 幽灵提案清算 — 纠缠系统的终极裁决
     *
     * 对每个被纠缠命中的节点执行:
     *   Pass 1 (采集) — 收集 _ghostBuffer 中同 key 权重最高的 set 提案
     *   Pass 2 (应用) — 以 Pass1 结果为基准, 依次应用 patch/delta
     *     (权重 < thresholdWeight 的提案被否决)
     *
     * 终值≠原始值 → 写入 node.state → 记录 _entangleMutations
     *   (供 turnstile.commit 写入历史) → 加入 changedKeys 返回
     */
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

        // Pass 1: 找出拥有最高权重的“绝对真理” (Set)
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i];
          // if (p.patch !== undefined) {
          //   finalValue = p.patch(finalValue);
          // }
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

        const thresholdWeight = hasSet ? bestSetWeight : -Infinity;

        // Pass 2: 处理 Delta 运算
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i];
          const proposalWeight = p.weight ?? 1;
          if (proposalWeight < thresholdWeight) continue
          if (p.patch !== undefined) {
            finalValue = p.patch(finalValue); // 在新基准上执行函数
          } else if (p.delta !== undefined) {
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
      // _ghostBuffer[targetUid] = [];
      _ghostBuffer[targetUid].length = 0;
      pendingGhostNodesCount--; 
      
      return changedKeys.length > 0 ? changedKeys : [];
    },

    resetCounters: () => {
      // for (let i = 0; i < _registry.length; i++) {
      //   const obsMap = _registry[i];
      //   if (obsMap) {
      //     for (const routes of obsMap.values()) {
      //       for (let j = 0; j < routes.length; j++) {
      //         routes[j].count = 0;
      //       }
      //     }
      //   }
      // }
      for (let i = 0; i < _allLinks.length; i++) {
        _allLinks[i].count = 0;
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
  const _dispose = () => {
    // 1. 清空注册表 (Map 需要 clear, 数组可以赋 length = 0)
    // for (let i = 0; i < _registry.length; i++) {
    //   if (_registry[i]) {
    //     _registry[i].clear();
    //   }
    // }
    // _registry.length = 0;

    _uidToLinks.length = 0;
    _uidToKeysCache.length = 0;

    // 2. 清空缓冲与状态
    _ghostBuffer.length = 0;
    _volatileLevels.clear();
    _entangleMutations.clear();
    
    // 3. 清空我们新增的高性能数组
    _allLinks.length = 0;
    _sharedSeenMap.length = 0;

    // 4. 清空对象池 (释放内存引用)
    contextPool.length = 0;
    
    // 5. 重置计数器
    activeAsyncCount = 0;
    pendingGhostNodesCount = 0;
    currentEpoch = 0;
    _linkId = 0;
  };
  return {
    _useEntangle,
    _updateEntangleLevel,
    Turnstile,
    _dispose
  };
};