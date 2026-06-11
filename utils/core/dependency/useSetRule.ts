 
 
import {  SchemaBucket } from "../engine/bucket"; 
import { InternalKeys, MeshError, MeshFlowTaskNode, MeshPath, SetRuleOptions, SuggestKey, logicApi } from "../types/types";

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
    /**
     * @internal
     * */ 
    _acquire() {
        return this.pool.pop() || {
            slot: { triggerTargets: null, affectedTatget: undefined, targetMeta: undefined }
        };
    }
    /**
     * @internal
     * */ 
    _release(wrapper: any) {
        // 🌟 释放时切断引用
        wrapper.slot.triggerTargets = null;
        wrapper.slot.affectedTatget = undefined;
        wrapper.slot.targetMeta = undefined;
        this.pool.push(wrapper);
    }
} 

/**
* @internal
* */ 
export const globalWrapperPool = new ApiWrapperPool(POOL_SIZE);

/**
 * [BOT] ExecuteMeshRule — 执行单条规则，构造 logicApi 注入业务逻辑
 *
 * 这是每次桶计算时规则的具体执行入口。流程:
 *   1. 遍历 triggerUids，从 pool 中预分配的 _preAllocatedDeps 快照上游节点数据
 *   2. 从 ApiWrapperPool 借一个 wrapper (享元，零 GC)
 *   3. 将快照填入 wrapper.slot (triggerTargets / affectedTarget / targetMeta)
 *   4. 调用用户注册的 logic(wrapper) → 同步返回或 Promise
 *   5. 归还 wrapper 到池
 *
 * triggerKeys 的作用: 精确快照 — 只取 triggerKeys 中声明的 key，而非整个节点状态
 *   未声明 → _preAllocatedDeps[i] = node (全节点引用)
 *   已声明 → 逐 key 拷贝到 _preAllocatedDeps[i] (快照隔离)
 *
 * @internal
 */
export const ExecuteMeshRule = <T>(rule: ReturnType<typeof CreateRule>, api: any) => {
    const { triggerUids, triggerKeys, targetUid, targetKey, logic, _preAllocatedDeps } = rule;
    
    const hasTriggerKeys = triggerKeys && triggerKeys.length > 0;
 
    // 纯粹的 O(1) 指针赋值，没有任何数组或对象的重新分配
    for (let i = 0; i < triggerUids.length; i++) {
        const uid = triggerUids[i];
        const node = api.getProxyByUid(uid);
 
        if (!hasTriggerKeys) {
            _preAllocatedDeps[i] = node;
        } else {
            const snap = _preAllocatedDeps[i];
            for (let j = 0; j < triggerKeys.length; j++) {
                const key = triggerKeys[j];
                snap[key] = node[key];
            }
            //万一需要triggernodes上其他信息就从这个proxy节点上找
            snap['proxy'] = node;
        }
    }
    const wrapper = globalWrapperPool._acquire();

    wrapper.slot.triggerTargets = _preAllocatedDeps;
    wrapper.slot.affectedTatget = api.getProxyByUid(targetUid)[targetKey as any];
    wrapper.slot.targetMeta = api.getProxyByUid(targetUid).meta;

    // 🌟 3. 将包裹传给业务逻辑！
    const result = logic(wrapper);
 
    if (result && typeof result.then === 'function') {
        // 如果是异步任务，等待执行完毕后释放
        return result.finally(()=>{
            globalWrapperPool._release(wrapper);
        });
    } else {
        // 同步任务，立刻释放
        globalWrapperPool._release(wrapper);
        return result;
    }
};

// ==========================================
// 🌟 纯数据构造器：不再创建任何闭包函数
// ==========================================
/**
 * [BOT] CreateRule — 纯数据结构，将用户配置转化为引擎可执行的 rule 实体
 *
 * 一条 rule = 用户 SetRule 调用的一次物化。包含:
 *   - triggerUids: 这条规则依赖的上游节点 uid 列表 (谁变了触发我)
 *   - targetUid / targetKey: 计算结果写入哪个节点的哪个 key
 *   - logic: 用户的计算函数 (接收 logicApi, 返回新值)
 *   - _preAllocatedDeps: 为每个上游节点预分配的槽位 (避免运行时 GC)
 *   - _hasRun: 首次执行标记 (配合桶缓存做脏检查)
 *
 * CreateRule 本身不做任何计算——它只是把配置"捏成"一个数据结构，
 * 真正的执行在 ExecuteMeshRule 中。
 *
 * @internal
 */
export const CreateRule = <
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
        _preAllocatedDeps:preAllocatedDeps, // 将预分配的空间挂载在 rule 实体上
    
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

    /**
     * [BOT] updateGraphRelation — 向 DAG 邻接表插入一条有向边
     *
     * 同时更新两套图:
     *   dependencyGraph[source]  → 下游 (source 变了会影响谁)
     *   predecessorGraph[target] → 上游 (target 依赖谁)
     *
     * _dependencyGraph / _predecessorGraph 是 Set 结构的影子图，
     * 用于 O(1) 去重——如果这条边已存在则跳过，防止重复注册。
     */
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

    /**
     * [BOT] SetRule — 建立一对一因果依赖 (DAG 的"边")
     *
     * 这是用户 API `engine.config.SetRule(A, B, key, options)` 的底层实现。
     * 调用它等于说: "当 A 的 triggerKeys 变更时，用 logic 计算 B 的 key"。
     *
     * 内部流程 (搭建多米诺骨牌):
     *   1. CreateRule → 将用户配置物化为 rule 实体 (含预分配内存)
     *   2. DepsArray → 建立上游数据的快照引用 (用于后续脏检查)
     *   3. updateGraphRelation → 更新 DAG 邻接表 (DependencyGraph / PredecessorGraph)
     *   4. SchemaBucket._setRule → 将 rule 注入目标 key 的桶 (多个 rule 共存，按策略执行)
     *   5. 如果该 key 是首次建桶 → new SchemaBucket + SetBucket 注册
     *   6. forceNotify / cacheStrategy → 配置桶的传播策略
     *
     * @param outDegreePath — 上游节点路径 (谁触发)
     * @param inDegreePath  — 下游节点路径 (谁被更新)
     * @param key           — 目标节点的哪个属性
     * @param options       — 规则配置 (logic/triggerKeys/priority/effect/...)
     */
    const SetRule = <
        K extends SuggestKey<NM>,
        TKeys extends SuggestKey<NM> = SuggestKey<NM>
    >(outDegreePath: P, inDegreePath: P, key: K, options: SetRuleOptions<NM, TKeys,K>) => {
 
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
            node._setRule(newRule, DepsArray);
            
            if (options.effect) {
                node._setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }
        } else {
            const baseValue = (inDegree.meta as any)[key]||(inDegree.state as any)[key];
            let newBucket = new SchemaBucket<P>(baseValue, key as string, inDegreePath);
            newBucket._setRule(newRule, DepsArray);
            
            if (options.effect) {
                newBucket._setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }

            inDegree.nodeBucket[key] = SetBucket(newBucket);
        }
        
        (inDegree.state as any)[key] = (inDegree.meta as any)[key];
        const bucket = GetBucket(inDegree.nodeBucket[key]);
 
        if (options.forceNotify||triggerKeys.length===0) bucket._setForceNotify(); 
        if (options.cacheStrategy == 'none') bucket._setUseCache(false);
    }
 
    /**
     * [BOT] SetRules — 建立多对一聚合依赖 (多个上游→一个下游)
     *
     * 与 SetRule 的区别仅在于第一个参数: 路径数组 vs 单个路径。
     * 其余逻辑完全相同——CreateRule 的 triggerUids 数组由多个 outDegree 组成。
     *
     * @param outDegreePaths — 多个上游节点路径
     * @param inDegreePath   — 下游节点路径
     * @param key            — 目标属性
     * @param options        — 规则配置
     */
    const SetRules = <
        K extends SuggestKey<NM>,
        TKeys extends SuggestKey<NM>
    >(
        outDegreePaths: P[],
        inDegreePath: P,
        key: K,
        options: SetRuleOptions<NM, TKeys,K> 
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
            node._setRules(newRule, DepsArray);
            
            if (options.effect) {
                node._setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }
        } else {
            const baseValue = (inDegree.meta as any)[key]||(inDegree.state as any)[key];
            let newBucket = new SchemaBucket<P>(baseValue, key as string, inDegreePath);
            newBucket._setRules(newRule, DepsArray);
            
            if (options.effect) {
                newBucket._setSideEffect({ fn: options.effect, args: options.effectArgs ? options.effectArgs : [key] });
            }

            inDegree.nodeBucket[key] = SetBucket(newBucket);
        }

        (inDegree.state as any)[key] = (inDegree.meta as any)[key];
        const bucket = GetBucket(inDegree.nodeBucket[key]);
 
        if (options.forceNotify||triggerKeys.length===0) bucket._setForceNotify(); 
        if (options.cacheStrategy == 'none') bucket._setUseCache(false);
    }

    return { SetRule, SetRules }
}