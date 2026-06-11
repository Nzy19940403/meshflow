import {  createTimeScheduler, _nextMacroTick, safeRequestAnimationFrame } from "../utils/util";
import {
    MeshPath,
    MeshEmit,
    MeshFlowTaskNode,
    TriggerCause,
    MeshFlowEventsName,
    NodeStatus,
    SuggestKey,
 
    InternalMeshFlowHistory,
} from "../types/types";
import { SchemaBucket } from "./bucket";
import {createTransactionScheduler} from './useTransactionSchduler'
import { EntangleTurnstile } from "../dependency/useSetEntangle";


type MeshTask<NM> = {
    //source用来指定更新源触发是由历史模块触发还是业务触发，用来避免meshtask重复commit任务去历史模块
    TaskRunner: (triggerUid: number | null, initialNodes: number[],keys:any[],source?:number) => Promise<void>,
    _CancelTask: () => void,
    /**
     * @internal
     * */ 
    _stageValueFn: (uid: number, key: SuggestKey<NM>, value: any) => void
}

function useMeshTask<P extends MeshPath, NM> (
    config: {
        useGreedy: boolean;
        NODE_QUOTA_PER_FRAME:number
    },
    dependency: {
        _GetAllNextDependency: (targetUid: number) => number[];
        _GetAllPrevDependency: (targetUid: number) => number[];
        _GetPrevDependency: (targetUid: number) => number[];
        _GetNextDependency: (targetUid: number) => number[];
        GetDependencyOrder: () => number[][];
        _GetUidToLevelMap: () => Map<number, number>;
    },
    data: {
        GetNodeByPath: (p: P) => MeshFlowTaskNode<P, any, NM>;
        GetNodeByUid:(uid:number)=>MeshFlowTaskNode<P, any, NM>,
        GetPathByUid:(uid:number)=>P,
        GetBucket:(bucketId:number)=>SchemaBucket<P>,
        GetMaxUid:()=>number,
        Turnstile: EntangleTurnstile<P, NM>; // 引入旋转门接口
    },
    hooks: {
        callOnError: any;
        callOnSuccess: any;
        callOnStart: any;
        emit: MeshEmit;
    },
    uitrigger: {
        _requestUpdate: () => void;
        // _flushPathSet: Set<number>;
        _addToRender:(uid:number)=>void
    },
    timeScheduler: ReturnType<typeof createTimeScheduler>,
    taskSchduler:ReturnType<typeof createTransactionScheduler<P,NM>>,
    history:InternalMeshFlowHistory,
): MeshTask<NM> {
    const currentExecutionToken: Map<P, symbol> = new Map();

    const isGreedy = config.useGreedy;

    // const scheduler = createScheduler();
    let globalLatestSessionToken: symbol | null = null;

    // ==========================================================
    // 🌟 全局内存池与容量管理 (GC 优化 & 支持动态节点)
    // ==========================================================
    let currentCapacity = 0;
    let flagArray: Uint8Array;
    let resistanceArray: Int32Array;
    let levelArray: Int32Array;
    let triggerSourceArray: Int32Array; //节点来源记录，方便log
    
    let readyQueue: Int32Array;
    let stagingQueue: Int32Array;
    let resureQueue: Int32Array;
    
    let AllAffectedPaths: Uint8Array; // 优化：替换原生 Array
    
    let _dedupeSeenMap: Uint8Array;
    //背压参数
    const BACKPRESSURE_LIMIT = 30;
    //最大并发数
    const MAX_CONCURRENT_TASKS = 40;

    // 普通数组池
    let ghostBaton: Array<MeshPath[] | null> = [];
    // let dirtyKeysPool: Array<Array<MeshPath>> = [];
    // let promisesPool: Array<Array<Promise<void>>> = [];
    // let effectsPool: Array<Array<{ fn: (args: any) => any; args: any[] }>> = [];

    const slotDirtyKeys = Array.from({ length: MAX_CONCURRENT_TASKS }, () => [] as MeshPath[]);
    const slotPromises = Array.from({ length: MAX_CONCURRENT_TASKS }, () => [] as Promise<void>[]);
    const slotEffects = Array.from({ length: MAX_CONCURRENT_TASKS }, () => [] as Array<{ fn: (args: any) => any; args: any[] }>);
    
    // 👇 🌟 新增：存放幽灵装甲带来的 Bucket Uid (纯数字，无 GC 开销)
    const slotIncomingBucketIds = Array.from({ length: MAX_CONCURRENT_TASKS }, () => [] as number[]);

    // 可用工位栈 [0, 1, ..., 39]
    const availableSlots = Array.from({ length: MAX_CONCURRENT_TASKS }, (_, i) => i);

    const ensureCapacity = (requiredMaxUid: number) => {
        if (requiredMaxUid <= currentCapacity) return;

        // 扩容策略：首次给 256，之后翻倍扩容，避免频繁分配内存
        const newCapacity = Math.max(currentCapacity === 0 ? 256 : currentCapacity * 2, requiredMaxUid);

        // TypedArray 扩容并保留老数据 (V8 .set 底层是 memmove，极快)
        const nextFlagArray = new Uint8Array(newCapacity);
        if (flagArray) nextFlagArray.set(flagArray);
        flagArray = nextFlagArray;

        const nextResistanceArray = new Int32Array(newCapacity);
        if (resistanceArray) nextResistanceArray.set(resistanceArray);
        resistanceArray = nextResistanceArray;

        const nextLevelArray = new Int32Array(newCapacity);
        if (levelArray) nextLevelArray.set(levelArray);
        levelArray = nextLevelArray;

        // 队列需要预留两倍空间 (根据你原代码逻辑)
        const nextReadyQueue = new Int32Array(newCapacity * 2);
        if (readyQueue) nextReadyQueue.set(readyQueue);
        readyQueue = nextReadyQueue;

        const nextStagingQueue = new Int32Array(newCapacity * 2);
        if (stagingQueue) nextStagingQueue.set(stagingQueue);
        stagingQueue = nextStagingQueue;

        const nextResureQueue = new Int32Array(newCapacity * 2);
        if (resureQueue) nextResureQueue.set(resureQueue);
        resureQueue = nextResureQueue;

        const nextAllAffectedPaths = new Uint8Array(newCapacity);
        if (AllAffectedPaths) nextAllAffectedPaths.set(AllAffectedPaths);
        AllAffectedPaths = nextAllAffectedPaths;

        const nextTriggerSourceArray = new Int32Array(newCapacity);
        if (triggerSourceArray) nextTriggerSourceArray.set(triggerSourceArray);
        triggerSourceArray = nextTriggerSourceArray;

        const nextDedupeSeenMap = new Uint8Array(newCapacity);
        if (_dedupeSeenMap) nextDedupeSeenMap.set(_dedupeSeenMap);
        _dedupeSeenMap = nextDedupeSeenMap;

        // 对象数组扩容
        const oldCapacity = currentCapacity;
 
        for (let i = oldCapacity; i < newCapacity; i++) {
            ghostBaton[i] = null;
        }

        currentCapacity = newCapacity;
    };

    const _CancelTask = ()=>{
        currentExecutionToken.clear();

    }

    const SHARED_DETAIL = {
        path: null as any,
        level: 0,
        targetLevel: 0,
        currentLevel: 0,
        pendingParentsCount: 0,
        active: 0,
        pending: 0,
        blocked: 0,
        nums: 0,
        asyncNums: 0
    };

    const SHARED_PAYLOAD = {
        path: null as any,
        type: 0 as any,
        triggerPath: null as any,
        calledBy: 0 as any,
        key: null as any,
        value: null as any,
        error: null as any,
        token: null as any,
        duration: null as any,
        timestamp:null as any,
        detail: SHARED_DETAIL ,// 嵌套对象也必须是复用的
        isCache:null as any,
        fromToken:null as any
    };

    // const generatePayload = (
    //     path:any,
    //     type:any,
    //     triggerPath:any,
    //     calledBy:any,
    //     key:any,
    //     value:any,
    //     error:any,
    //     token:any,
    //     duration:any,
    //     timestamp:any,
    //     isCache:any
    // )=>{

    // }

    let isTaskActive:boolean = false;

    /**
     * [BOT] stageBuffer — 外部干预缓冲池 ("避震器")
     *
     * 外部修改 (StageValue/SilentSet 之外的所有入口) 不直接写入 node.state，
     * 而是先进入这个缓冲池。设计意图:
     *
     * 1. 引擎运行时 (isTaskActive=true) 直接修改 node.state 会绕过 token 系统
     *    → 可能导致竞态条件。stageBuffer 将修改"暂存"起来，等安全时机消费。
     *
     * 2. 聚合点火: 同一个 tick 内多次 StageValue 调用只触发一次 TaskRunner
     *    (ignitionTimer 微任务排他锁)
     *
     * 3. 纠缠协作: applyStageValue 中修改的节点标记为 VOLITION，确保与纠缠
     *    系统的预言发射正确协作。
     *
     * 消费时机:
     *   a. 引擎空闲 (isTaskActive=false) → ignitionTimer 微任务 → TaskRunner
     *   b. 引擎运行中 → 等当前 Flow 结算完毕，finally 中收割 → flushQueue
     */
    const stageBuffer: Array<{ uid: number, key: SuggestKey<NM>, value: any }> = [];
    let ignitionTimer: Promise<void> | null = null;
    /**
     * @internal
     * */ 
    const _stageValueFn = (uid: number, key: SuggestKey<NM>, value: any) => {
   
        // 1. 无论如何，数据先入库
        stageBuffer.push({ uid, key, value });

        // 2. 检查引擎是否已经在跑
        if (isTaskActive) return;

        // 3. 🌟 聚合逻辑：如果已经在排队点火了，就不要再点火了
        if (ignitionTimer) return;

        // 4. 开启微任务聚合
        ignitionTimer = Promise.resolve().then(() => {
            ignitionTimer = null; // 清空点火器，准备下一次

            // 再次检查，防止在微任务排队期间引擎被其他途径唤醒了
            if (!isTaskActive) {
             
                TaskRunner(null, [],[{uid,key}]);
            }
        });
    }
    let isTransactionChain = false; // 新增：事务链标志位
    let transactionToken:symbol;
    const setTransactionTrue = () => {
        isTransactionChain = true;
        transactionToken = Symbol('task');
        return transactionToken;
    };
    
    taskSchduler.apply(setTransactionTrue);

    

/**
     * [BOT] TaskRunner — 拓扑推演主循环 (引擎所有计算流的唯一入口)
     *
     * 每次点火（`SetValue`/`_batchNotify`/`StageValue`/`notifyAll`）最终都会调用这里。
     * TaskRunner 内部按严格的 Phase 顺序执行，确保复杂拓扑中因果关系不被并发打乱。
     *
     * ### 三种队列 (节点在推演中的三种等待状态)
     * - `readyQueue`   — 就绪节点。所有活跃上游已完成，安检通过后即可执行
     * - `stagingQueue` — 阻塞节点。还有至少一个活跃上游未完成，在此等待阻力归零
     * - `resureQueue`  — 挂起节点。上游已完成但节点层级高于当前水位，
     *                    必须等水位推进到当前层才放行 (防止"抢跑")
     *
     * ### 执行阶段详解
     *
     * **Phase 0 — 源力探针 (Prime Mover Prophecy)**
     * > 在所有正常节点推演前，先并发发射"纠缠预言"。如果源头节点的变更 key
     * > 匹配了 `useEntangle` 注册的 via 列表，预言回调会把目标节点 uid 收集到
     * > `currentEntangleArray`。预言命中后，normal 节点打入 RESURE 而非 ready，
     * > 防止正常流计算结果被后续纠缠修改覆盖。
     *
     * **Phase 1 — 正常发车**
     * > flushQueue 循环从 readyQueue 取节点，安检(pendingParentsCount+水位)，
     * > 通过后标记 PROCESSING，调用 `executorNodeCalculate` 执行桶计算。
     *
     * **Phase 2 — 贪婪捞取 (仅 isGreedy 模式)**
     * > 扫描 stagingQueue，如果某个节点阻力已归零且层级允许，绕过正常流程
     * > 直接捞入 readyQueue。单亲节点可提前执行 (因为不依赖多个父节点同步)。
     *
     * **Phase 3 — 水位/纠缠结算**
     * > 当前水位所有节点处理完毕后的结算阶段：
     * > - 3A 量子逆转: `resolveGhosts` 坍缩幽灵提案 → 被修改节点打入 ready
     * > - 3B 水位推进: 找到下一个有待处理节点的最小层级 → 推进 currentLevel
     * > - 3C 截流退出: 无更高层级 → break → FlowSuccess
     *
     * **Phase 4 — 并发等待**
     * > 就绪节点存在但 40 个工位占满，break 等待异步节点完成回调。
     *
     * ### 关键变量
     * - `currentLevel`     — 当前水位线。节点层级 <= 此值才允许发车
     * - `quantumWatermark` — 纠缠震荡天花板。低于此的节点可被纠缠复活 (INVERSION)
     * - `AllAffectedPaths` — 本轮 Flow 波及范围的位图。用于阻力计算和剪枝
     * - `maxAffectedLevel` — 本轮波及的最高层级。超过此值的水位推进无意义
     *
     * ### Token 机制
     * 每次点火产生唯一 `curToken` (Symbol)。所有异步操作完成后校验 token：
     * - token 匹配 → 本轮仍然有效，继续执行
     * - token 不匹配 → 有新一轮点火开始，丢弃本轮所有结果 (防竞态)
     *
     * ### TriggerCause 溯源链
     * ```
     * VOLITION(3) ——外部修改直接注入 (applyStageValue/SetValue)
     *     ↓
     * CAUSALITY(0) ——标准因果推导 (正常下游传播)
     *     ↓
     * REPERCUSSION(2) ——纠缠余波 (INVERSION 节点的下游连带)
     *     ↑
     * INVERSION(1) ——纠缠直接修改的目标节点
     * ```
     */
    //运行调用入口
    const TaskRunner:MeshTask<NM>['TaskRunner'] = async (
        triggerUid: number | null, 
        initialNodes: number[],
        keys:any[],
        source:number = 0 
    ) => {
        
        let isTaskTakeOver = false;
        if(isTransactionChain){
            //看看是否被taskschduler接管了
            isTaskTakeOver = taskSchduler.takeover(transactionToken);
            isTransactionChain = false; 
        }

        const curToken =isTaskTakeOver?transactionToken: Symbol("token");

        const triggerToken = (typeof triggerUid === 'number'? triggerUid : "__NOTIFY_ALL__") as unknown as P ;
 
        currentExecutionToken.set(triggerToken, curToken);
        globalLatestSessionToken = curToken;

        isTaskActive = true;
        
        let isLooping = false; // 状态锁：标志 while 循环是否在运行
        let isHeartbeatRunning = false;

        //scheduler重置
        timeScheduler.reset();
        data.Turnstile.reset();
   

        const maxUid = data.GetMaxUid() + 3;
        ensureCapacity(maxUid);

        flagArray.fill(0, 0, maxUid);
        resistanceArray.fill(0, 0, maxUid);
        levelArray.fill(0, 0, maxUid);
        AllAffectedPaths.fill(0, 0, maxUid);
        triggerSourceArray.fill(-1, 0, maxUid);

        // const AllAffectedPaths:Array<number> = new Array(maxUid).fill(0);
        let processingCount:number = 0;

        // 🌟 2. 状态大盘（位运算专用，极其省内存，极速查状态）
        // const flagArray = new Uint8Array(maxUid); 

        // // 🌟 3. 数值大盘（防溢出专用）
        // const resistanceArray = new Int32Array(maxUid);
        // const levelArray = new Int32Array(maxUid);

        // 🌟 4. 遍历队列（负责极速 for 循环）
        // const readyQueue = new Int32Array(maxUid*2);
        let readyCount = 0;
        let readyActiveCount = 0;

        // const stagingQueue = new Int32Array(maxUid*2);
        let stagingCount = 0;
        let stagingActiveCount = 0;

        // const resureQueue = new Int32Array(maxUid*2);
        let resureCount = 0;
        let resureActiveCount = 0;
 
        initialNodes.forEach((uid) => {
            AllAffectedPaths[uid] = 1;
            dependency
                ._GetAllNextDependency(uid)
                .forEach((childUid) =>{
                    AllAffectedPaths[childUid] = 1
                });
        });
 
        ghostBaton.fill(null,0,maxUid)
        if (keys && keys.length > 0) {
            for (let i = 0; i < keys.length; i++) {
                const { uid, key } = keys[i];
                if (!ghostBaton[uid]) {
                    ghostBaton[uid] = [key];
                } else if (!ghostBaton[uid]!.includes(key)) {
                    ghostBaton[uid]!.push(key);
                }
            }
        }
        // ==========================================================
        // 预言弹药库：只在阶段三集中引爆
        /**
         * [BOT] 纠缠预言弹药库
         *
         * `currentEntangleArray` — 本纪元待 resolveGhosts 清算的命中节点 uid 列表
         * `nextEntangleArray`    — 正常节点执行过程中新产生的纠缠命中节点 (下一纪元处理)
         *
         * 为什么分"当前"和"下一"? 因为 resolveGhosts 修改节点后可能触发新的下游
         * 纠缠，如果混在一起会导致无限震荡 (A→B→A→B...)。引擎通过 Turnstile 的
         * epoch 机制分隔: 当前纪元只处理 Phase 0 预言产生的命中，正常节点执行中
         * 产生的命中先暂存到 nextEntangleArray，等当前纪元结算完再推进。
         */
        // ==========================================================
        const currentEntangleArray: number[] = [];
        const nextEntangleArray: number[] = [];

        const turnstile = data.Turnstile;
 

        const stagedBufferUids: number[] = [];

        /**
         * [BOT] applyStageValue — 消费 stageBuffer 中的外部干预
         *
         * 将暂存的修改批量注入节点:
         *   1. 物理写值到 node.state
         *   2. 标记 calledBy = VOLITION (外部自由意志)
         *   3. 接力棒传递: 修改的 key 存入 ghostBaton[uid]
         *   4. 清理旧状态: 清除 STAGING 标记 → 打入 readyQueue
         *   5. 水位修复: 如果注入节点层级低于 currentLevel → 压低水位
         */
        const applyStageValue = () => {
            if (stageBuffer.length === 0) return false;
            
            let hasInjected = false;
            let minInjectedLevel = Infinity; // 记录注入节点的最低水位
            const recordFn = history.RecordMutation ? history.RecordMutation : null;
            while (stageBuffer.length > 0) {
                const { uid, key, value } = stageBuffer.shift()!;
                const node = data.GetNodeByUid(uid);
                if (!stagedBufferUids.includes(uid)) stagedBufferUids.push(uid);
                if (!Object.is(node.state[key], value)) {
                    hasInjected = true;
                    if (recordFn) {
                        recordFn(
                            data.GetPathByUid(uid) as string, 
                            key as string, 
                            node.state[key], 
                            value
                        );
                    }
                    // 1. 物理写值
                    node.state[key] = value;
                    // uitrigger._flushPathSet.add(uid);
                    uitrigger._addToRender(uid);
        
                    // 🌟 2. 核心修复：直接黄袍加身，不再绕道 currentEntangleArray
                    node.calledBy = TriggerCause.VOLITION;
        
                    // 3. 传接力棒：告诉 executor 这个节点改了哪些 key
                    const keys = ghostBaton[uid] || [];
                    if (!keys.includes(key)) keys.push(key);
                    ghostBaton[uid] = keys;
        
                    // 4. 清理旧的阻塞状态
                    flagArray[uid] &= ~NodeStatus.PROCESSED;
                    // 如果它之前被卡在暂存区，直接撕掉它的封条
                    if (flagArray[uid] & NodeStatus.STAGING) {
                        flagArray[uid] &= ~NodeStatus.STAGING;
                        stagingActiveCount--;
                    }
        
                    // 🌟 5. 直接暴力塞入发车队列！
                    if (!(flagArray[uid] & NodeStatus.READY)) {
                        flagArray[uid] |= NodeStatus.READY;
                        readyQueue[readyCount++] = uid;
                        readyActiveCount++;
                        triggerSourceArray[uid] = -1;
                    }
        
                    // 6. 记录这次神谕的层级
                    const level = dependency._GetUidToLevelMap().get(uid) ?? 0;
                    if (level < minInjectedLevel) minInjectedLevel = level;
                    
                    updateWatermark(uid); // 顺手推高影响水位
                }
            }
        
            // 🌟 核心水位修复：冷启动时 currentLevel 可能极大，必须拉回现实
            if (hasInjected) {
                // 如果当前水位比我们注入的水位还要深，强行把水位提上来
                // 这样 flushQueue 发车时，阻力计算才会正确
                if (currentLevel === undefined || currentLevel > minInjectedLevel) {
                    currentLevel = minInjectedLevel;
                }
            }
        
            return hasInjected;
        };

        const resetEngineState = () => {
            readyCount = 0;
            readyActiveCount = 0;
            stagingCount = 0;
            stagingActiveCount = 0;
            resureCount = 0;
            resureActiveCount = 0;
            processingCount = 0;
        
            // 定型数组或连续内存的物理清零
            flagArray.fill(0);
            triggerSourceArray.fill(-1);

            turnstile.resetCounters();   
            ghostBaton.fill(null);
            isTaskActive = false; 
            quantumWatermark = -1;

            currentEntangleArray.length = 0;
            nextEntangleArray.length = 0;
        };

        // ==========================================================
        //  2. 捞取火种 
        // ==========================================================

        /**
         * [BOT] IS_ENTANGLEMENT_ENABLED — 纠缠系统开关
         *
         * 如果拓扑中完全没有调用过 useEntangle, volatileLevels.size=0。
         * 此时所有纠缠相关逻辑被短路: hasObserver 永远返回 false,
         * emitGhosts/resolveGhosts 被替换为空操作函数，零开销跳过。
         */
        // 终极上帝开关：不仅要看 Turnstile 存不存在，还要看它里面有没有真实注册的高危层级！
        // 如果当前拓扑完全没有注册过 useEntangle，那么 volatileLevels.size 就是 0
        const IS_ENTANGLEMENT_ENABLED = turnstile.volatileLevels.size > 0;

        const hasObserver:(uid: number) => boolean = IS_ENTANGLEMENT_ENABLED
            ? turnstile._hasObserver
            : (uid:number) => false;
        const emitGhosts:(observerNode: MeshFlowTaskNode<P, any, NM>, changedKeys: MeshPath[])=>number[] | Promise<number[]> = IS_ENTANGLEMENT_ENABLED
            ? turnstile._receiveGhosts
            : () => [];
        const resolveGhosts:(node: MeshFlowTaskNode<P, any, NM>) => MeshPath[] = IS_ENTANGLEMENT_ENABLED
            ? turnstile._resolveGhosts
            : () => [];
        const getTriggerKeys:(uid: number) => MeshPath[] = IS_ENTANGLEMENT_ENABLED
            ? turnstile._getTriggerKeys
            : () => [];
         
        // 核心优化：直接拿取在 useEntangle 注册时就计算好的高危层级
        const volatileLevels: Set<number> = turnstile?.volatileLevels || new Set();

        // 量子水位线（震荡天花板）
        let quantumWatermark = -1;

        // ==========================================================
        // 1. 基础水位线与队列准备
        // ==========================================================
        // const readyToRunBuffer = new Set<number>();

        // 获取初始水位线（触发点所在层级）
        const uidToLevelMap = dependency._GetUidToLevelMap();
        let currentLevel = 0;
        let maxAffectedLevel = 0;
        const updateWatermark = (uid: number) => {
            const descendants = dependency._GetAllNextDependency(uid);
            descendants.forEach((u) => {
                const level = uidToLevelMap.get(u) || 0;
                if (level > maxAffectedLevel) {
                    maxAffectedLevel = level;
                }
            });
        };

        //  锁定起始推演水位
        if (typeof triggerUid==='number') {
            currentLevel = uidToLevelMap.get(triggerUid) ?? 0;
        } else {
            currentLevel = Math.min(...initialNodes.map(p => uidToLevelMap.get(p) ?? 0));
        }

        const startTime = performance.now();

        let p: P|'__NOTIFY_ALL__';

        if (typeof triggerUid === 'number') {
            // 1. 单源头更新：triggertoken / triggerUid 是 number
            p = data.GetPathByUid(triggerUid);
        } else if (initialNodes && initialNodes.length > 0) {
            // 2. 多源头更新 / 全局更新：第一个参数是 null，第二个参数数组有值
            p = '__NOTIFY_ALL__';
        } else if (keys && keys.length > 0) {
            // 3. stageValue 点火：前两个参数都没值（null 和 空数组），抽取 key 的第一个对象的 uid
            p = data.GetPathByUid(keys[0].uid);
        } else {
            // 4. 极端兜底
            p = '__NOTIFY_ALL__';
        }

        // const p = typeof triggerToken==='number'?data.GetPathByUid(triggerToken):'__NOTIFY_ALL__'
    
        SHARED_PAYLOAD.path = p;
        SHARED_PAYLOAD.token =curToken;
        hooks.emit(MeshFlowEventsName.FlowStart,SHARED_PAYLOAD)

        //调用开始钩子
        hooks.callOnStart({
            path: p,
        });
    
        let isFlowFinished = false;
        applyStageValue();
       // ==========================================================
        // 阶段 0：源力探针 (Prime Mover Prophecy)
        /**
         * [BOT] Phase 0 — 正式推演前并发发射"纠缠预言"
         *
         * 对所有变更种子节点，并行调用 emitGhosts (底层是 _receiveGhosts)。
         * 预言回调检查变更 key 是否匹配 useEntangle 注册的 via 列表:
         * - 匹配 → 收集被命中的目标节点 uid → currentEntangleArray
         * - 不匹配 → 跳过
         *
         * 预言命中后的关键决策:
         *   normal downstream 节点打入 RESURE (挂起等待)，而非 readyQueue。
         *   原因: 如果先发车计算，后续纠缠修改可能覆盖计算结果，
         *   产生 4 倍的重复计算 bug。
         *
         * 预言未命中:
         *   normal downstream 直接进入 readyQueue，立即发车。
         */
        // ==========================================================

        const primeMovers = new Set<number>();

        // 1. 处理外部触发源 (God Node)
        if (typeof triggerUid === 'number') {
            // processed.add(triggerUid);
            // processed[triggerUid] = 1;
            flagArray[triggerUid] |= NodeStatus.PROCESSED


            primeMovers.add(triggerUid);
            updateWatermark(triggerUid);
            // uitrigger._flushPathSet.add(triggerUid);
            uitrigger._addToRender(triggerUid)
 
        }

        // 核心：seedsOfChaos 用于发射预言，它必须包含 triggerUid
        const seedsOfChaos = typeof triggerUid==='number' ? [triggerUid] : [...initialNodes, ...stagedBufferUids];;

        for (let i = 0; i < seedsOfChaos.length; i++) {
            const seedUid = seedsOfChaos[i];
            const seedNode = data.GetNodeByUid(seedUid);
            const seedPath = data.GetPathByUid(seedUid);

            // 1. 统一打上神谕标签，确保后面的 executorNodeCalculate 会闭嘴
            seedNode.calledBy = TriggerCause.VOLITION as any;

            // 2. 统一发射源头点火日志
            SHARED_PAYLOAD.path = seedPath;
            SHARED_PAYLOAD.calledBy = TriggerCause.VOLITION;
            SHARED_PAYLOAD.triggerPath = null;
            SHARED_PAYLOAD.key = undefined;
            hooks.emit(MeshFlowEventsName.NodeStart, SHARED_PAYLOAD);

            // 3. 完美利用 ghostBaton 精准提取刚刚被修改的属性，发射变更日志
            const changedKeys = ghostBaton[seedUid];
            if (changedKeys && changedKeys.length > 0) {
                for (let k = 0; k < changedKeys.length; k++) {
                    const keyName = changedKeys[k] as string;
                    SHARED_PAYLOAD.path = seedPath;
                    SHARED_PAYLOAD.key = keyName;
                    SHARED_PAYLOAD.value = seedNode.state[keyName];
                    SHARED_PAYLOAD.calledBy = TriggerCause.VOLITION;
                    SHARED_PAYLOAD.triggerPath = null;
                    hooks.emit(MeshFlowEventsName.NodeBucketSuccess, SHARED_PAYLOAD);
                }
            }
        }

        if(timeScheduler._shouldYield()){
            uitrigger._requestUpdate();
            await timeScheduler._yieldToMain();
            if (currentExecutionToken.get(triggerToken) !== curToken) return;
        }
        

        // 2. 并发嗅探：发射预言
        const prophecyPromises = seedsOfChaos.map(async (seed) => {
            
            if (hasObserver(seed)) {
                const nodeObj = data.GetNodeByUid(seed);

                // const registeredKeys = getTriggerKeys(seed);
                const changedKeys = ghostBaton[seed] || [];
                // if (registeredKeys.length > 0) {
                if (changedKeys.length > 0) {   
                
                    // let hitTargets = emitGhosts(nodeObj, registeredKeys);
                    let hitTargets = emitGhosts(nodeObj, changedKeys);
                    if (hitTargets instanceof Promise) {
                        hitTargets = await hitTargets;
                    }
                    return { seed, hitTargets };
                }
            }
            return { seed, hitTargets: [] };
        });

        const prophecyResults = await Promise.all(prophecyPromises);

        prophecyResults.forEach(({ seed, hitTargets }) => {
            if (hitTargets && hitTargets.length > 0) {
                currentEntangleArray.push(...hitTargets);
                const seedLevel = uidToLevelMap.get(seed) || 0;
                quantumWatermark = Math.max(quantumWatermark, seedLevel);
            }
        });

        
        if (currentEntangleArray.length > 0 || seedsOfChaos.length > 1) {
            uitrigger._requestUpdate();
            await timeScheduler._yieldToMain();
  
            if (currentExecutionToken.get(triggerToken) !== curToken) return;
        }

        // 3. 致命修复区：必须把正常的下游节点 (initialNodes) 送入队列！
        const isQuantumAwakenedAtStart = currentEntangleArray.length > 0;

        initialNodes.forEach((u) => {
            if (!primeMovers.has(u)) {
                updateWatermark(u); // 确保它们推高水位线
                if (isQuantumAwakenedAtStart) {
                    // 🛡️ 预言已出，正常节点先挂起，等水位推进
                    const level = uidToLevelMap.get(u) ?? 0;
    
                    levelArray[u] = level;

                    if(!(flagArray[u] & NodeStatus.RESURE)){
                        flagArray[u] |= NodeStatus.RESURE;
                        resureQueue[resureCount++] = u;
                        resureActiveCount++;
                    }
                    const p = data.GetPathByUid(u);
                    SHARED_PAYLOAD.path = p;
                    SHARED_PAYLOAD.type = 2;
                    SHARED_PAYLOAD.triggerPath = null;
                    hooks.emit(MeshFlowEventsName.NodeStagnate,SHARED_PAYLOAD)
                     
                } else {
                    // 正常宇宙，准许进入发车队列
                    // readyToRunBuffer.add(u);
                    if(!(flagArray[u] & NodeStatus.READY )){
                        flagArray[u] |= NodeStatus.READY;
                        readyQueue[readyCount++] = u;
                        readyActiveCount++;
                    }

                    // updateWatermark(u); // 确保它们推高水位线
                }
            }
        });

        // // 4. 锁定起始推演水位
        // if (typeof triggerUid==='number') {
        //     currentLevel = uidToLevelMap.get(triggerUid) ?? 0;
        // } else {
        //     currentLevel = Math.min(...initialNodes.map(p => uidToLevelMap.get(p) ?? 0));
        // }

        // const startTime = performance.now();
        // const p = typeof triggerToken==='number'?data.GetPathByUid(triggerToken):'__NOTIFY_ALL__'
   
        // SHARED_PAYLOAD.path = p;
        // SHARED_PAYLOAD.token =curToken;
        // hooks.emit(MeshFlowEventsName.FlowStart,SHARED_PAYLOAD)

        // //调用开始钩子
        // hooks.callOnStart({
        //     path: p,
        // });

        // let isFlowFinished = false;


        /**
         * [BOT] executorNodeCalculate — 单节点完整执行单元
         *
         * 这是引擎的"原子计算单元"，每个节点进入此函数后经历五个步骤:
         *
         * 1. 【工位分配】从 availableSlots 池 pop 一个工位 ID，复用预分配的数组池
         *    (slotDirtyKeys/slotPromises/slotEffects/slotIncomingBucketIds)，避免 GC
         *
         * 2. 【幽灵装甲处理】检查 ghostBaton[targetUid]: 该节点是否被外部或纠缠修改过?
         *    - 被修改过 → hasValueChanged=true, incomingEntangleKeys 记录变更 key
         *    - isGhostly(INVERSION 唤醒) → dirtyEntangleKeys 收集 (二次纠缠发射)
         *    - 非 Ghostly(VOLITION/CAUSALITY) → dirtyEntangleKeys 不收集
         *      (Phase 0 已发射过预言，重复发射 = 4x bug)
         *
         * 3. 【桶计算循环】遍历 nodeBucket 中的所有桶:
         *    - 幽灵拦截: isGhostly && bucketId 在 incomingBucketIds → skip (纠缠已确定终值)
         *    - bucket._evaluate(api) → 同步返回或 Promise
         *    - handleSingleResult(): 值变检测 → hasNotifyKeyTriggered 判定
         *    - effectsToRun 收集副作用函数
         *
         * 4. 【决断时刻】
         *    - 全部同步: 直接 finalizeExecution() → releaseSlot() → return
         *    - 有异步: Promise.all → finalizeExecution() → releaseSlot()
         *
         * 5. 【finalizeExecution】收尾:
         *    - 执行副作用 effects (effect 返回值写入 state)
         *    - 标记 PROCESSED
         *    - 纠缠发射: emitGhosts(本节点的 dirtyEntangleKeys)
         *    - tryActivateChild: 对每个直接下游子节点减阻力 → 归零则入 readyQueue
         *    - scheduleNext(): 如果主循环空闲则继续 flushQueue
         */
        const executorNodeCalculate = (targetUid: number, currentTriggerUid: number | null) => {
            
            const slotId = availableSlots.pop()!;

            // 2. 映射当前工位的物理内存
            const dirtyEntangleKeys = slotDirtyKeys[slotId];
            const pendingPromises = slotPromises[slotId];
            const effectsToRun = slotEffects[slotId];
            // 👇 🌟 新增：拿取当前工位的数字比对池
            const incomingBucketIds = slotIncomingBucketIds[slotId];
            // 物理清空
            dirtyEntangleKeys.length = 0;
            pendingPromises.length = 0;
            effectsToRun.length = 0;
            // 👇 🌟 新增：物理清空数字池
            incomingBucketIds.length = 0;

            let hasValueChanged = false;  // 仅负责：决定是否触发 uitrigger.flushPathSet
            let hasNotifyKeyTriggered = false; // 🌟 负责：判断是否推高水位和通知下游
            let notifyNext = false;

            const targetSchema = data.GetNodeByUid(targetUid);

            const targetPath = data.GetPathByUid(targetUid);

            const immediateTriggerUid = triggerSourceArray[targetUid];
            const immediateTriggerPath = immediateTriggerUid < 0 ? null : data.GetPathByUid(immediateTriggerUid);
            // 记录进入时的状态，用于在纠缠震荡状态时传播给下游
            const originalCause = targetSchema.calledBy as unknown as TriggerCause;
 
            const isNodeWatched = hasObserver(targetUid);
            const watchedKeys = isNodeWatched ? getTriggerKeys(targetUid) : [];
           
            const recordDirtyEntangleKey = (changedKey: string) => {
                 
                // 这里直接读闭包里的局部变量，速度极快
                if (!isNodeWatched) return; 
                if (watchedKeys.length === 0 || watchedKeys.includes(changedKey)) {
                    dirtyEntangleKeys.push(changedKey);
                }
            };

            // const pendingPromises = promisesPool[targetUid];
            // pendingPromises.length = 0;

            // ==========================================================
            // 幽灵装甲 (Ghost Armor)
            /**
             * [BOT] 幽灵装甲 (Ghost Armor) — 处理纠缠/外部修改留下的接力棒
             *
             * `ghostBaton[targetUid]` 是 string[] 数组，记录当前 Flow 中该节点
             * 被修改了哪些属性 key。两个来源:
             *   - Phase 0 外部修改 (applyStageValue/SetValue, calledBy=VOLITION)
             *   - Phase 3 纠缠坍缩 (resolveGhosts 写入后, calledBy=INVERSION)
             *
             * `isGhostly` = calledBy === INVERSION
             *   该节点是被纠缠 resolveGhosts 直接修改的。桶计算循环中:
             *     - 如果 key 在 incomingBucketIds 中 (有桶的 key) → skip 推演
             *       (纠缠已经确定了这个 key 的终值，不需要重新计算)
             *     - 如果 key 没有桶 (基础属性) → 正常推演
             *
             * `dirtyEntangleKeys` 收集规则 (极其重要):
             *   - isGhostly → 接力棒进入 dirtyEntangleKeys → finalizeExecution 中二次发射
             *   - 非 Ghostly → 接力棒不进入 (Phase 0 已发射过预言)
             *   违反此规则会导致同一个纠缠被处理 4 次 (2个源 * 2次发射)
             *
             * `incomingBucketIds`: 被纠缠修改过的桶 bucketId 列表，这些桶跳过推演。
             */
            // ==========================================================
            let isGhostly = false;

            // if (targetSchema.calledBy === TriggerCause.INVERSION) {

                

            //     isGhostly = true;
            //     // targetSchema.calledBy = 0 ; // 卸下装甲，归还自由身，上面以及记录了这个节点是怎么被复活的，所以现在calledBy没有继续以1存在的必要
            //     hasValueChanged = true; // 强制宣告变更，保证触发下游
            //     // uitrigger._flushPathSet.add(targetUid);
            //     uitrigger._addToRender(targetUid)
                
            //     // 提取接力棒：把刚才 resolveGhosts 修改的 Key 拿过来！
            //     // const incomingEntangleKeys = ghostBaton.get(targetPath);
            //     // const incomingEntangleKeys = ghostBaton.get(targetUid)
            //     const incomingEntangleKeys = ghostBaton[targetUid];
            //     if (incomingEntangleKeys) {

            //         dirtyEntangleKeys.push(...incomingEntangleKeys);
                    
            //         for (let i = 0; i < incomingEntangleKeys.length; i++) {
            //             const key = incomingEntangleKeys[i] as any;
            //             const bId = targetSchema.nodeBucket[key as SuggestKey<NM>];

            //             if (bId === undefined) { 
            //                 hasNotifyKeyTriggered = true;
            //             } else {
            //                 incomingBucketIds.push(bId);
            //             }
            //         }
                    
            //         ghostBaton[targetUid] = null;
            //     }
            // }
 
            if (targetSchema.calledBy === TriggerCause.INVERSION) {
                isGhostly = true;
            }

            const incomingEntangleKeys = ghostBaton[targetUid];
            if (incomingEntangleKeys) {
                hasValueChanged = true; 
                uitrigger._addToRender(targetUid);
                
                // 💥 终极精准修复：只有幽灵(INVERSION)的接力棒才允许进入纠缠二次发射池！
                // 外部修改(VOLITION)在 Phase 0 已经发过预言，绝对不能发生重复发射（解决 4 times 的 Bug）！
                if (isGhostly) {
                    dirtyEntangleKeys.push(...incomingEntangleKeys);
                }
                 
                for (let i = 0; i < incomingEntangleKeys.length; i++) {
                    const key = incomingEntangleKeys[i] as any;
                    const bId = targetSchema.nodeBucket[key as SuggestKey<NM>];

                    if (bId === undefined) { 
                        // 无论外部还是幽灵，只要改了基础值，必须激活下游（解决弱信号挂死 Bug）
                        hasNotifyKeyTriggered = true;
                    } else {
                        // 如果有桶，把桶拉进免算名单
                        incomingBucketIds.push(bId);
                    }
                }
                
                ghostBaton[targetUid] = null;
            }

            const releaseSlot = () => {
                availableSlots.push(slotId);
            };

            // 这个函数只负责：减阻力 -> 判断归零 -> 入队
            /**
             * [BOT] tryActivateChild — 下游节点的阻力计算与激活 (DAG 水位线核心)
             *
             * 每个节点完成执行后，对其每个直接下游子节点调用此函数递减阻力。
             * 只有当子节点的所有活跃上游都完成后 (阻力归零)，子节点才能发车。
             *
             * 阻力计算两种策略:
             *   Case A (惰性初始化): 子节点第一次被触碰 → 遍历所有上游父节点，
             *     计数在 AllAffectedPaths 中且未 PROCESSED 的数量
             *   Case B (递减): 子节点已在 stagingQueue 中 → resistanceArray 记录的值 - 1
             *
             * 阻力归零后的行为:
             *   - 在震荡辐射区 (isInRepercussionZone) → calledBy = REPERCUSSION (纠缠余波)
             *   - 正常流 → calledBy = CAUSALITY → 打入 readyQueue
             *
             * 阻力未归零:
             *   - pendingParentsCount > 0 → 打入 stagingQueue，记录剩余阻力
             *   - 如果 stagingActiveCount > BACKPRESSURE_LIMIT(30) 且 childLevel > currentLevel
             *     → 打入 resureQueue (背压保护，防止 staging 堆积过多)
             *
             * @param childUid  — 下游子节点 uid
             * @param reasonType — 1=上游值变了(强信号) 2=上游完成但值未变(穿透信号)
             */
            //reasontype -> 1:上游 ${targetPath} 值变了 2: 当上游值没有变但是下游节点已经在stagingArea的时候`上游 ${targetPath} 完成(穿透)`
            const tryActivateChild = (childUid: number, reasonType: number) => {
                const childLevel = uidToLevelMap.get(childUid) ?? 0;
                //用uid拿到node节点
                const childNode = data.GetNodeByUid(childUid);
         
                const childPath = data.GetPathByUid(childUid);
             
                // 核心判断：当前这个子节点，是不是处于“震荡辐射区”？
                const isInRepercussionZone =
                    (originalCause === TriggerCause.INVERSION ||
                        originalCause === TriggerCause.REPERCUSSION) 
                        && childLevel <= quantumWatermark;

                // 行为 1：复活老兵（只针对在 processed 里的节点）
                // if (isInRepercussionZone && processed[childUid]===1) {
                if(isInRepercussionZone && (flagArray[childUid] & NodeStatus.PROCESSED)) { 
                    // processed.delete(childUid); // 抹除本轮 Flow 的记忆
                    // processed[childUid] = 0;
                    flagArray[childUid] &= ~NodeStatus.PROCESSED;
                    
                    // 注意：这里不要写 childNode.calledBy = 2！我们统一在入队的时候发工牌！
                    // hooks.emit(MeshFlowEventsName.NodeRevive , { path: childPath, triggerPath: targetPath });
                    SHARED_PAYLOAD.path = childPath;
                    SHARED_PAYLOAD.triggerPath = targetPath;
                    hooks.emit(MeshFlowEventsName.NodeRevive,SHARED_PAYLOAD)
                }

                let newResistance = 0;

                const currentStatus = flagArray[childUid];
                // 1. 如果已经处理过或正在处理，直接忽略
                if (
                    currentStatus & (NodeStatus.PROCESSED | NodeStatus.PROCESSING | NodeStatus.READY)
                ) {
                   
                    return
                }

                // 2. 阻力计算策略：惰性初始化 vs 递减
                // if (!stagingArea.has(childUid)) {
                if (!( flagArray[childUid] & NodeStatus.STAGING )) {
                    if (
                        childLevel > currentLevel &&
                        stagingActiveCount > BACKPRESSURE_LIMIT
                    ) {
                        // if (!resureArea.has(childLevel))
                        //     resureArea.set(childLevel, new Set());
                        // resureArea.get(childLevel)!.add(childUid);
                        levelArray[childUid] = childLevel;
                        if(!(flagArray[childUid] & NodeStatus.RESURE)){
                            flagArray[childUid] |= NodeStatus.RESURE;
                            resureQueue[resureCount++] = childUid;
                            resureActiveCount++;
                            triggerSourceArray[childUid] = targetUid;
                        }
     
                        SHARED_PAYLOAD.path = childPath;
                        SHARED_PAYLOAD.type = 7;
                        SHARED_PAYLOAD.triggerPath = targetPath;
                        hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)
                        return;
                    }
                    // Case A: 第一次被触碰 (Lazy Init)
                    // 我们不查 AllAffectedPaths，我们查“还有几个爸爸没死？”
                    const parentUids = dependency._GetPrevDependency(childUid);

                    let pendingCount = 0;
                    for (const uid of parentUids) {
                        // 如果爸爸已经在已完成名单里，它就不是阻力
                        // if (processed.has(p)) continue;
                        // if(processed[uid]===1) continue;
                        if(flagArray[uid] & NodeStatus.PROCESSED) continue;

                        // const pLevel = uidToLevelMap.get(uid) ?? 0;

                        // // 🔥 核心逻辑：你的需求实现
                        // // 如果爸爸还没跑完，但爸爸的层级 <= 当前水位线，
                        // // 说明这个爸爸是“上一波”的人，它被跳过/剪枝了，不算阻力。
                        // // 只有那些层级比当前还高的（或者未来的）未完成节点，才是真正的阻力。
                        // if (pLevel > currentLevel) {
                        //     pendingCount++;
                        // }
                        if (AllAffectedPaths[uid] === 0) continue;

                        // 只要是在波及范围内、且没处理完的，统统算作真正的阻力！
                        // 彻底废除之前的 if (pLevel > currentLevel) 静态限制！
                        pendingCount++;
                    }
                    newResistance = pendingCount;

                    // 注意：这里不需要 -1，因为调用 tryActivateChild 的那个 targetPath
                    // 已经在 finalizeExecution 里被 add 进 processed 了，
                    // 上面的循环会自动排除它。
                } else {
                    // Case B: 之前已经进过暂存区，直接递减
                    // const currentResistance = stagingArea.get(childUid)!;
                    const currentResistance = resistanceArray[childUid];
                    newResistance = currentResistance - 1;
                }

                if (newResistance <= 0) {
                    // 检查忙碌状态
                    // const isAlreadyInReadyBuffer = readyToRunBuffer.has(childUid);

                    const isAlreadyInReadyBuffer = (flagArray[childUid] & NodeStatus.READY) !== 0;
                    // const isAlreadyRunning = processingSet[childUid]===1;
                    const isAlreadyRunning = (flagArray[childUid] & NodeStatus.PROCESSING) !== 0;

                    if (isAlreadyInReadyBuffer || isAlreadyRunning) {
                        
 
                        SHARED_PAYLOAD.path = childPath;
                        SHARED_PAYLOAD.type = isAlreadyRunning ? 3 : 3.1;
                        SHARED_PAYLOAD.triggerPath = targetPath;
                        hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)

                        return;
                    }

     
                    // stagingArea.delete(childUid);
                    if(flagArray[childUid] & NodeStatus.STAGING){
                        flagArray[childUid] &= ~NodeStatus.STAGING;
                        stagingActiveCount--;
                    }

                    // 行为 2：颁发工牌（动能传承，针对所有准备入队的节点）
                    if (isInRepercussionZone) {
                        childNode.calledBy = TriggerCause.REPERCUSSION; // 新老兵都带电！
                    } else {
                        childNode.calledBy = TriggerCause.CAUSALITY; // 正常流恢复 0
                    }

                    //加入准备跑的集合,用来做batch
                    // readyToRunBuffer.add(childUid);
                    if (!(flagArray[childUid] & NodeStatus.READY)) {
                        flagArray[childUid] |= NodeStatus.READY;
                        readyQueue[readyCount++] = childUid;
                        readyActiveCount++;
                    }
 
                    SHARED_PAYLOAD.path = childPath;
                    SHARED_PAYLOAD.type = reasonType;
                    // SHARED_DETAIL.path = targetPath;
                    SHARED_PAYLOAD.triggerPath = targetPath;
                 
                    hooks.emit(MeshFlowEventsName.NodeRelease,SHARED_PAYLOAD)

                } else {
                    // 更新阻力
                    // stagingArea.set(childUid, newResistance);
                    resistanceArray[childUid] = newResistance;
                    if(!(flagArray[childUid] & NodeStatus.STAGING)){
                        flagArray[childUid] |= NodeStatus.STAGING;
                        stagingQueue[stagingCount++] = childUid;
                        stagingActiveCount++;
                    }
           
                }
            };

            // --- 3. 提取公共逻辑：收尾工作 (对应原来的 finally 块) ---
            // 无论是同步跑完，还是异步 catch/then 跑完，最后都必须走这里
            const finalizeExecution = (
                effects: Array<{ fn: (args: any[]) => any; args: Array<string> }> = []
            ) => {
                // 再次检查令牌（防止异步期间被废弃）
                if (currentExecutionToken.get(triggerToken) !== curToken) return;
                
                // 此时所有的 Bucket 都算完了（同步的已更新，异步的已 await）
                // 开始处理下游激活逻辑 (Dependency Propagation)

                if (effects.length) {
                    let result: any = {};
                    const proxy = targetSchema.proxy;
                    for (let effect of effects) {
                        const argsObj = (effect.args || []).reduce(
                            (acc: any, key: string) => {
                                acc[key] = proxy[key];
                                return acc;
                            },
                            {}
                        );

                        try {
                            const patch = effect.fn(argsObj);

                            // 如果副作用返回了有效的对象，合并到总补丁中
                            if (patch && typeof patch === "object") {
                                Object.assign(result, patch);
                            }
                        } catch (e) {
                            console.warn(e);
                        }
                    }
                    for (let key in result) {
                        if (key in targetSchema.state) {
                            // 精准记录副作用导致的属性变动
                            if (!Object.is(targetSchema.state[key], result[key])) {
                                targetSchema.state[key] = result[key];
                                // dirtyEntangleKeys.push(key); 
                                recordDirtyEntangleKey(key);

                                hasValueChanged = true;
                              
                                if(key in targetSchema.nodeBucket){
                                    const bucketid:number = targetSchema.nodeBucket[key as SuggestKey<NM>];
                                    targetSchema._syncCache(data.GetBucket(bucketid),result[key])
                                }
                             
                                // 新增：副作用里的 key 也受 notifyKeys 检查！
                                if (targetSchema.notifyKeys.size === 0 || targetSchema.notifyKeys.has(key as any)) {
                                    hasNotifyKeyTriggered = true;
                                }
                            }
                        } else {
                            const errorInfo = {
                                error: `error return ${key} in ${String(targetSchema.path)}`,
                            };
                            throw errorInfo;
                        }
                    }
      
                }

                // if (hasValueChanged) uitrigger._flushPathSet.add(targetUid);
                if(hasValueChanged) uitrigger._addToRender(targetUid)

                const finishPropagation = (hitTargetUids: number[] = []) => {
                    if (currentExecutionToken.get(triggerToken) !== curToken) return;
                     
                    if (hitTargetUids && hitTargetUids.length > 0) {
                        nextEntangleArray.push(...hitTargetUids);
   
                        // currentEntangleArray.push(...hitTargetUids);
                        // quantumWatermark = Math.max(
                        //     quantumWatermark,
                        //     uidToLevelMap.get(targetUid) || 0
                        // );
                    }

                    // 清理脏位回收池，避免影响下次使用
                    dirtyEntangleKeys.length = 0;
       

                    SHARED_PAYLOAD.path = targetPath;
                    SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                    SHARED_PAYLOAD.triggerPath = immediateTriggerPath;
                    hooks.emit(MeshFlowEventsName.NodeSuccess,SHARED_PAYLOAD)

                    // processed.add(targetUid);
                    // processed[targetUid] = 1;
                    flagArray[targetUid] |= NodeStatus.PROCESSED;

                    const directChildren = dependency._GetNextDependency(targetUid);

                    // 3.1 扩充疆域 (AllAffectedPaths)
                    // if ( hasValueChanged || notifyNext) {
                    if ( hasNotifyKeyTriggered || notifyNext) {
                        updateWatermark(targetUid);

                        const allNextOrder = dependency._GetAllNextDependency(targetUid);
                        // allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                        allNextOrder.forEach((uid:number) => {
                            AllAffectedPaths[uid] = 1;
                        });
                    }
                    const currentPathNode = data.GetNodeByUid(targetUid);
                  

                    //  动态屏障判定 (本层有静态风险，或当前已有活跃的预言)
                    const targetLevel = uidToLevelMap.get(targetUid) ?? 0;
                    const isLevelBarrierActive =
                        volatileLevels.has(targetLevel) || currentEntangleArray.length > 0 || nextEntangleArray.length>0 ;
                   
                    // 3.2 激活下游 (Try Activate Children)
                    for (const childUid of directChildren) {
                        const childLevel = uidToLevelMap.get(childUid) ?? 0;
                        const childPath = data.GetPathByUid(childUid);

                        // 屏障拦截：本层有预言风险且孩子是下游，则绝对禁止穿透，直接强制挂起为平民
                        if (isLevelBarrierActive && childLevel >= targetLevel) {
                            // if (!resureArea.has(childLevel))
                            //     resureArea.set(childLevel, new Set());
                            // resureArea.get(childLevel)!.add(childUid);
                            levelArray[childUid] = childLevel;

                            if(!(flagArray[childUid] & NodeStatus.RESURE )){
                                flagArray[childUid] |= NodeStatus.RESURE;
                                resureQueue[resureCount++] = childUid;
                                resureActiveCount++;
                            }

                            
                            SHARED_PAYLOAD.path = childPath;
                            SHARED_PAYLOAD.type = 2;
                            SHARED_PAYLOAD.triggerPath = targetPath;
                            hooks.emit(MeshFlowEventsName.NodeStagnate,SHARED_PAYLOAD)
 
                            continue;
                        }

                        
                        const shouldFire = hasNotifyKeyTriggered || notifyNext;
                       
                        if(flagArray[childUid] & NodeStatus.PROCESSED) {

                            const childNode = data.GetNodeByUid(childUid);
                            const isGhostlyNode = childNode.calledBy === TriggerCause.INVERSION;
                             
                            // 🌟 2. 核心后门：如果它是幽灵，并且上游传来了物理强信号，允许它重塑肉身！
                            if (shouldFire) {
                                
                                // 抹除幽灵的已处理状态，这样它就不会被 continue 掉
                                // 并且后续进入 tryActivateChild 时，也会被当做正常节点计算阻力！
                                flagArray[childUid] &= ~NodeStatus.PROCESSED; 
                                SHARED_PAYLOAD.path = childPath;
                                SHARED_PAYLOAD.triggerPath = targetPath;
                                hooks.emit(MeshFlowEventsName.NodeRevive, SHARED_PAYLOAD);
                            } else {
                                // 正常情况下的已处理节点，或者虽然是幽灵但只是弱信号，老老实实拦截
                                SHARED_PAYLOAD.path = childPath;
                                SHARED_PAYLOAD.type = 2;
                                SHARED_PAYLOAD.triggerPath = targetPath;
                                hooks.emit(MeshFlowEventsName.NodeIntercept, SHARED_PAYLOAD);
                                continue;
                            }
                        }
                        if (
                            (flagArray[childUid] & NodeStatus.PROCESSING)||
                            (flagArray[childUid] & NodeStatus.READY) !== 0
                        ) {
 

                            SHARED_PAYLOAD.path = childPath;
                            SHARED_PAYLOAD.type = (flagArray[childUid]&NodeStatus.PROCESSING) ? 3:3.1;
                            SHARED_PAYLOAD.triggerPath = targetPath;
                            hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)

                            continue;
                        }
 
                        if (shouldFire) {
                            // 强影响逻辑

                            tryActivateChild(childUid, 1);
                        } else {
                            // 弱影响逻辑
                            // if (stagingArea.has(childUid)) {
                            if( flagArray[childUid] & NodeStatus.STAGING ){
                                tryActivateChild(childUid, 2);
                            } else {
                                // 原地待命逻辑
                                const level = uidToLevelMap.get(childUid)!;
 
                                levelArray[childUid] = level;
                                if(!(flagArray[childUid] & NodeStatus.RESURE )){
                                    flagArray[childUid] |= NodeStatus.RESURE;
                                    resureQueue[resureCount++] = childUid;
                                    resureActiveCount++;
                                     
                                    SHARED_PAYLOAD.path = childPath;
                                    SHARED_PAYLOAD.type = 1;
                                    SHARED_PAYLOAD.triggerPath = targetPath;
                                    hooks.emit(MeshFlowEventsName.NodeStagnate,SHARED_PAYLOAD)
                                }
                            }
                        }
                    }

                    // 3.3 清理现场 & 尝试点火 (Flush Queue)
 
                    if( flagArray[targetUid] & NodeStatus.PROCESSING  ){
                        flagArray[targetUid] &= ~NodeStatus.PROCESSING;
                        processingCount--;
                    }

                    currentPathNode.calledBy = TriggerCause.CAUSALITY;

                    // --- 4. 调度逻辑与 UI 点火 (嵌入在这里) ---
                    const scheduleNext =  () => {
                        // 4.3 重启引擎 (Flush Queue)
                        if (!isLooping) {
                            isLooping = true;
                            // const activenums = processingSet.size;
                            const activenums = processingCount;
                            // const pendingnums = readyToRunBuffer.size;
                            const pendingnums = readyActiveCount;
                            const blockednums = stagingActiveCount;
 
                            SHARED_PAYLOAD.path = targetPath;
                            SHARED_PAYLOAD.type = 1;
                            SHARED_DETAIL.active = activenums;
                            SHARED_DETAIL.pending = pendingnums;
                            SHARED_DETAIL.blocked = blockednums;
                            hooks.emit(MeshFlowEventsName.FlowFire,SHARED_PAYLOAD)

                            flushQueue();
                        }
                    };

                    // 执行调度
                    // 如果上面没有 await (即没有切片)，这里是同步执行的
                    scheduleNext();
                };

                // ==========================================================
                // 修改点：支持异步嗅探的 emit
                // ==========================================================
               
                if (hasObserver(targetUid) && dirtyEntangleKeys.length > 0) {

                    const hitTargetsOrPromise = emitGhosts(targetSchema, dirtyEntangleKeys);
                     
                    // 判断是否为 Promise
                    if (
                        hitTargetsOrPromise instanceof Promise) {
                        // 异步：挂起等待
                        hitTargetsOrPromise.then(finishPropagation).catch(handleError);
                    } else {
                        // 同步：极速穿透
                        finishPropagation(hitTargetsOrPromise);
                    }
                } else {
                    finishPropagation([]);
                }
            };

            // --- 4. 提取公共逻辑：错误处理 (对应原来的 catch 块) ---
            const handleError = (err: any) => {
                
                // hooks.emit( MeshFlowEventsName.NodeError , { path: targetPath, error: err });
                SHARED_PAYLOAD.path = targetPath;
                SHARED_PAYLOAD.error = err;
                SHARED_PAYLOAD.triggerPath = immediateTriggerPath;
                hooks.emit(MeshFlowEventsName.NodeError,SHARED_PAYLOAD)
            
                const abortToken = Symbol("abort");
                currentExecutionToken.set(triggerToken, abortToken);
 

                // readyCount = 0;
                // readyActiveCount = 0;
                
                // stagingCount = 0;
                // stagingActiveCount = 0;
                
                // resureCount = 0;
                // resureActiveCount = 0;
                // flagArray.fill(0);

 

                // processingCount = 0;
          
                // ghostBaton.fill(null);
                // isTaskActive = false;

                resetEngineState();
                hooks.callOnError(err);

                // 错误发生后，依然要执行收尾（清理 processingSet 等）
            };
            // --- 5. 核心逻辑：处理单个桶的计算结果 ---
            // 这个函数囊括了原来循环体内的所有逻辑

            // 提取公共的处理结果逻辑
            const handleSingleResult = <K extends SuggestKey<NM>>(
                result: any,
                bucketName: K
            ) => {

                // let shouldNotify = false;
                //这部分应该交给副作用处理
    
                // 值更新检查
                if (result !== targetSchema.state[bucketName]) {
                    // targetSchema[bucketName] = result;
                    targetSchema.state[bucketName] = result;
                    hasValueChanged = true;
                    // 精准记录桶产生的属性变动
                    // dirtyEntangleKeys.push(String(bucketName));
                    recordDirtyEntangleKey(String(bucketName));
                   
          
                    SHARED_PAYLOAD.path = targetPath;
                    SHARED_PAYLOAD.key = bucketName,
                    SHARED_PAYLOAD.value = result;
                    SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                    SHARED_PAYLOAD.triggerPath = immediateTriggerPath;
                    hooks.emit(MeshFlowEventsName.NodeBucketSuccess,SHARED_PAYLOAD)
        
                    if (targetSchema.notifyKeys.size===0 || targetSchema.notifyKeys.has(bucketName)) {
                        hasNotifyKeyTriggered = true;
                    }
                }
                const bucket = data.GetBucket(targetSchema.nodeBucket[bucketName]);
                if (bucket._isForceNotify()) notifyNext = true;

                if (hasNotifyKeyTriggered || notifyNext) {
                    updateWatermark(targetUid);
                }
            };

            if (originalCause !== TriggerCause.VOLITION) {
               
                SHARED_PAYLOAD.path = targetPath;
                SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                SHARED_PAYLOAD.triggerPath = immediateTriggerPath;
                hooks.emit(MeshFlowEventsName.NodeStart,SHARED_PAYLOAD)
            }
            
         
            try {
                // --- 循环遍历开始 ---
                //副作用列表
                // const effectsToRun: Array<{ fn: (args: any) => any; args: any[] }> = [];
                // const effectsToRun = effectsPool[targetUid];
                // effectsToRun.length = 0;
                const api = {
                    affectKey: '',
                    triggerUid: currentTriggerUid,

                    getProxyByUid: (u: number) => data.GetNodeByUid(u).proxy,
            
                    getStateByUid: (u: number) => data.GetNodeByUid(u).state,
                    GetToken: () => curToken,
                    iscache:false
                }
 
                for (let bucketName in targetSchema.nodeBucket) {
                   
                    const bucketId = targetSchema.nodeBucket[bucketName as SuggestKey<NM>];
                    const bucket = data.GetBucket(bucketId);
                   
                    // 🛡️ 预言拦截：如果被量子纠缠唤醒，跳过自身推演逻辑！
                    if (isGhostly && incomingBucketIds.includes(bucketId)) {
                        SHARED_PAYLOAD.path = targetPath;
                        SHARED_PAYLOAD.key = bucketName;
                        SHARED_PAYLOAD.value = targetSchema.state[bucketName];
                        SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                        hooks.emit(MeshFlowEventsName.NodeBucketSuccess , SHARED_PAYLOAD);
                        if (bucket._isForceNotify()) notifyNext = true;
                        if ( targetSchema.notifyKeys.size === 0 || targetSchema.notifyKeys.has(bucketName)) {
                            updateWatermark(targetUid);
                        }
                        continue;

                        // const incomingKeys = ghostBaton[targetUid] || [];
                        // if (incomingKeys.includes(bucketName)) {
                        //     hooks.emit(MeshFlowEventsName.NodeBucketSuccess , {
                        //         path: targetPath,
                        //         key: String(bucketName),
                        //         value: targetSchema.state[bucketName],
                        //         calledBy: targetSchema.calledBy,
                        //     });
                        //     if (bucket._isForceNotify()) notifyNext = true;
                        //     if ( targetSchema.notifyKeys.size === 0 || targetSchema.notifyKeys.has(bucketName)) {
                        //         updateWatermark(targetUid);
                        //     }
                        //     continue; 
                        // }
                    }

                    api.affectKey = bucketName;
                    api.iscache = false;
    
                    // 1. 启动计算
                    const resultOrPromise = bucket._evaluate(api);

                    SHARED_PAYLOAD.path = targetPath;
                    SHARED_PAYLOAD.key = bucketName; 
                    SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                    (SHARED_PAYLOAD as any).isCache = api.iscache; // 💥 动态注入缓存标记
                    SHARED_PAYLOAD.triggerPath = immediateTriggerPath;
                    hooks.emit(MeshFlowEventsName.NodeProcessing, SHARED_PAYLOAD);

                    if(!api.iscache){
                       
                        effectsToRun.push(...bucket._getSideEffect());
                    }
                    // 2. 嗅探结果类型
                    if (resultOrPromise instanceof Promise) {
                        // -> 异步：存起来，别 await，继续下一个循环
                        const promise = resultOrPromise.then((res: any) => {
                            // 异步回来后，依然要检查令牌

                            if (currentExecutionToken.get(triggerToken) !== curToken) return;
                            handleSingleResult(res, bucketName);
                        });
                        pendingPromises.push(promise);
                    } else {
                        // -> 同步：当场处理，趁热吃
                        handleSingleResult(resultOrPromise, bucketName);
                    }
                }
                // --- 循环遍历结束 ---

                // 3. 决断时刻：是同步穿透还是异步等待？
                if (pendingPromises.length > 0) {
                    // -> 异步路径：必须交出控制权
                    // 使用 Promise.all 等待所有挂起的桶
                    return Promise.all(pendingPromises)
                        .then(() => {
                            // 全部异步桶都回来了，开始收尾
                            finalizeExecution(effectsToRun);
                            releaseSlot();
                        })
                        .catch(handleError);
                } else {
                    // -> 同步路径：极速穿透！
                    // 没有任何异步桶，直接收尾，无需微任务延迟
                    finalizeExecution(effectsToRun);
                    releaseSlot();
                    // 返回 void，这在 flushQueue 的 while 循环里意味着可以立即跑下一个
                    return;
                }
            } catch (err) {
                handleError(err);
                releaseSlot();
            }
        };

        /**
         * [BOT] flushQueue — 引擎主调度循环 (while true 事件循环)
         *
         * 这是整个引擎的"心跳"。一个无限循环，每次迭代处理一批次工作，
         * 批次由三个边界条件控制:
         *   - 时间片: timeScheduler._shouldYield() 超过 12ms → 让出主线程
         *   - 名额限制: nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME (首帧30, 后续按配置)
         *   - 并发上限: processingCount >= MAX_CONCURRENT_TASKS (40)
         *
         * 循环内部按优先级处理四个阶段:
         *
         * 阶段 1【正常发车】从 readyQueue 取出节点 → 安检(活跃上游数+水位检测)
         *   → 通过: PROCESSING → executorNodeCalculate
         *   → 失败: STAGING (阻塞) 或 RESURE (挂起)
         *
         * 阶段 2【贪婪捞取】仅 isGreedy 模式。扫描 stagingQueue:
         *   阻力归零 && (层级<=currentLevel || 单亲节点) → 直接捞入 readyQueue
         *
         * 阶段 3【水位/纠缠】processingCount=0 && readyActiveCount=0 时进入:
         *   3A 量子逆转: resolveGhosts 坍缩幽灵提案 → 压低水位 → continue 回 1
         *   3B 水位推进: 找到最小下一层级 → currentLevel 推进 → 捞出节点 → continue
         *   3C 截流退出: 无可用下级 → RESURE/STAGING 全标记 PROCESSED → break
         *
         * 阶段 4【并发等待】有就绪节点但 40 工位占满 → break
         *   等异步节点 finalizeExecution → scheduleNext → flushQueue 重入
         *
         * 退出路径:
         *   正常退出: 阶段 3C 截流 → break → finally → FlowSuccess
         *   挂起退出: 并发满/有异步 → break → finally → FlowWait + 心跳监听
         *   异常退出: token 失效 → break → finally → FlowAbort
         */
        const flushQueue = async () => {
            // 1. 令牌检查 (安全熔断)
            
            if (currentExecutionToken.get(triggerToken) !== curToken) {
                isLooping = false;
                return;
            }

            isLooping = true;
            let isFirstFrame = timeScheduler._getIsFirstFrame();
            let yieldCount = 0;
            // 1. 定义名额决策函数
            const getNodeQuota = () => {
                // A. 如果是非贪婪模式，名额给无限（由水位线逻辑自己控制节奏）
                if (!isGreedy) return config.NODE_QUOTA_PER_FRAME;

                // C. 普通贪婪模式，首帧严苛限流，后续稍微放开
                return isFirstFrame ? 30 : config.NODE_QUOTA_PER_FRAME;
            };

            // 新增：帧内计数器
            let nodesProcessedInFrame = 0;
            // 新增：硬指标，一帧最多只算 10 个 (你可以根据实际测试调整为 20 或 50)
            const NODE_QUOTA_PER_FRAME = getNodeQuota();
         

            try {
                while (true) {
                    
                    // 令牌检查
                    if (currentExecutionToken.get(triggerToken) !== curToken) break;
                  
                    // ==========================================================
                    // 修改点 1：双重检查 (时间到了 OR 数量够了 -> 都要休息)
                    // ==========================================================
                      
                    const isQuotaExceeded = nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME;
                    const isTimeExceeded = timeScheduler._shouldYield();

                    if (isQuotaExceeded || isTimeExceeded) {
                        // 只有在真的做过计算后，才申请更新 UI
                        if (nodesProcessedInFrame > 0) {
                            yieldCount++;
                            const shouldUpdateUI = isFirstFrame || yieldCount % 2 === 0;
                            if (shouldUpdateUI) {
                                uitrigger._requestUpdate();
                            }
                        }

                        await timeScheduler._yieldToMain();

                        // 醒来后检查令牌
                        if (currentExecutionToken.get(triggerToken) !== curToken) break;

                        // 🔥 关键：睡醒了，重置计数器，开始新的一帧
                        nodesProcessedInFrame = 0;

                        isFirstFrame = timeScheduler._getIsFirstFrame();
                    }
                     
                    /**
                     * [BOT] 阶段 1: 正常发车 — 从 readyQueue 取节点安检后执行
                     *
                     * 安检流程 (shouldIntercept):
                     *   - pendingParentsCount > 0 → 还有活跃上游未完成 → 打入 STAGING
                     *   - !isGreedy && targetLevel > currentLevel → 水位不足 → 打入 STAGING
                     *
                     * 通过安检 → 标记 PROCESSING → executorNodeCalculate(targetUid, triggerUid)
                     *
                     * 中途中止 (isMidFlightAborted):
                     *   名额用完 / 时间超了 / 并发满了 → 搬运剩余节点到 readyQueue 前部 → break
                     */
                    if (readyActiveCount > 0 && processingCount < MAX_CONCURRENT_TASKS) {
                        // 🌟 保持原样：快照发车前的长度
                        const originalReadyCount = readyCount;
                        let nextReadyCount = 0; 
                        let isMidFlightAborted = false;

                        for (let i = 0; i < originalReadyCount; i++) {
                            const targetUid = readyQueue[i];

                            if ((flagArray[targetUid] & NodeStatus.READY) === 0) {
                                readyActiveCount--;  
                           
                                continue;
                            };
                    
                            // --- 核心修改点 1：名额满了或时间到了的“救火”搬运 ---
                            if (processingCount >= MAX_CONCURRENT_TASKS || nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME || timeScheduler._shouldYield()) {
                                
                                // 🌟 关键：j 的上限必须是动态的 readyCount，而不是 originalReadyCount！
                                // 因为在跑循环时，新产生的子节点已经让 readyQueue 变长了
                                for (let j = i; j < readyCount; j++) {
                                    const leftoverUid = readyQueue[j];
                                    if (flagArray[leftoverUid] & NodeStatus.READY) {
                                        readyQueue[nextReadyCount++] = leftoverUid;
                                    }
                                }
                                
                                // 搬运完后，立刻同步物理指针和逻辑计数，然后跳出
                                readyCount = nextReadyCount;
                                readyActiveCount = nextReadyCount; 
                                isMidFlightAborted = true;
                                break; 
                            }
                    
                            const targetNode = data.GetNodeByUid(targetUid);
                            const targetPath = data.GetPathByUid(targetUid);
                            const targetLevel = uidToLevelMap.get(targetUid) ?? 0;
                            const staticParents = dependency._GetPrevDependency(targetUid);

                            // const isMergeNode = staticParents.length > 1;
                            // // 🌟 保持原样：完全没动你的 shouldIntercept 变量
                            // const shouldIntercept = (!isGreedy || isMergeNode) && targetLevel > currentLevel;

                            const pendingParentsCount = staticParents.filter(
                                (uid) => AllAffectedPaths[uid] === 1 && (flagArray[uid] & NodeStatus.PROCESSED ) === 0
                            ).length;
        
                            const isLevelBlocked = !isGreedy && targetLevel > currentLevel;

                            // 🌟 终极剪枝机制：只要活跃上游清零，哪怕我的静态 Level 是 100 级，我也立刻发车！
                            // 彻底删除之前的 (!isGreedy || isMergeNode) && targetLevel > currentLevel;
                            const shouldIntercept = pendingParentsCount > 0 || isLevelBlocked;

                    
                            if (shouldIntercept) {

                                flagArray[targetUid] &= ~NodeStatus.READY;
                                readyActiveCount--;
                    
                                // const pendingParentsCount = staticParents.filter(
                                //     // (uid) => AllAffectedPaths[uid] === 1 && processed[uid] === 0
                                //     (uid) => AllAffectedPaths[uid] === 1 && (flagArray[uid] & NodeStatus.PROCESSED )===0
                                // ).length;
                    
                                resistanceArray[targetUid] = pendingParentsCount || 0;
                                if (!(flagArray[targetUid] & NodeStatus.STAGING)) {
                                    flagArray[targetUid] |= NodeStatus.STAGING;
                                    stagingQueue[stagingCount++] = targetUid;
                                    stagingActiveCount++;
                                }
                    
                                const tUid = triggerSourceArray[targetUid];

                                SHARED_PAYLOAD.path = targetPath;
                                SHARED_PAYLOAD.type = pendingParentsCount > 0 ? 4 : 5;
                                SHARED_DETAIL.targetLevel = targetLevel;
                                SHARED_DETAIL.currentLevel = currentLevel;
                                SHARED_DETAIL.pendingParentsCount = pendingParentsCount;
                                SHARED_PAYLOAD.triggerPath = tUid >= 0 ? data.GetPathByUid(tUid) : null;
                                hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)

                                continue;
                            }
                    
                            // --- 通过安检，发车 ---
                            flagArray[targetUid] &= ~NodeStatus.READY;
                            readyActiveCount--;
                    
                            // if(processingSet[targetUid] === 0){
                            //     processingSet[targetUid] = 1;
                            //     processingCount++;
                            // }

                            if( (flagArray[targetUid] & NodeStatus.PROCESSING)  === 0){
                  
                                flagArray[targetUid] |= NodeStatus.PROCESSING
                                processingCount++;
                            }
                            
                 
                            SHARED_PAYLOAD.path = targetPath;
                            SHARED_PAYLOAD.calledBy =  targetNode.calledBy;
                            SHARED_PAYLOAD.key = undefined;
                            hooks.emit(MeshFlowEventsName.NodeProcessing,SHARED_PAYLOAD)
                          
                            executorNodeCalculate(
                                targetUid,
                                triggerUid,
                            );
                    
                            nodesProcessedInFrame++;
                        }
                    
                        // --- 核心修改点 2：正常跑完一轮后的扫尾 ---
                        // 只有在没触发上面那个 break 的情况下，才执行这里的合并
                        // 这里的上限同样要看动态的 readyCount
                        if(!isMidFlightAborted){
 
                            if (readyCount > originalReadyCount) {
                                for (let k = originalReadyCount; k < readyCount; k++) {
                                    const newlyAddedUid = readyQueue[k];
                                    if (flagArray[newlyAddedUid] & NodeStatus.READY) {
                                        readyQueue[nextReadyCount++] = newlyAddedUid;
                                    }
                                }
                                readyCount = nextReadyCount;
                                // 注意：这里的 readyActiveCount 已经在上面 shouldIntercept 或发车时减过了
                                // 所以物理长度和逻辑计数在这里应该是对齐的
                                readyActiveCount = readyCount; 
                            } else {
                                // 如果没有新节点产生，也要更新物理指针
                                readyCount = nextReadyCount;
                            }
                        }
                        // --- 核心修改点 3：解除“熄火”的关键点 ---
                        // 🌟 必须放开这个 continue！只要还有人没跑，且发车位没满，就要立刻回到 while 顶部
                        if (readyActiveCount > 0 && processingCount < MAX_CONCURRENT_TASKS) {
                            continue;
                        }
                    }
                  
                    // ==========================================================
                    // 阶段二：贪婪捞取 (Greedy Catch-up)
                    /**
                     * [BOT] 阶段 2: 贪婪捞取 — 仅 isGreedy 模式
                     *
                     * 扫描 stagingQueue: 阻力归零 (resistance<=0) 且 (层级<=currentLevel 或单亲节点)
                     * → 绕过正常 tryActivateChild 流程直接捞入 readyQueue
                     *
                     * 单亲节点特殊处理: 它的唯一父节点完成时阻力就归零了，可提前执行。
                     * 多亲节点必须等水位推进 → 阶段 3 处理。
                     */
                    // ==========================================================
                    if (
                        nodesProcessedInFrame < NODE_QUOTA_PER_FRAME &&
                        isGreedy &&
                        // stagingArea.size > 0 &&
                        stagingActiveCount > 0 &&
                        // processingSet.size < MAX_CONCURRENT_TASKS
                        processingCount < MAX_CONCURRENT_TASKS
                    ) {
                        let foundGreedy = false;
                        let releasedCount = 0;
                        // const isFirstFrame = scheduler._getIsFirstFrame();
                        // const releaseQuota = isFirstFrame ? 5 : 15;
                        let nextStagingCount = 0; 

                        // for (const [uid, resistance] of stagingArea) {
                        for (let i = 0; i < stagingCount; i++) {
                            const uid = stagingQueue[i];
                            // 检查活人
                            if ((flagArray[uid] & NodeStatus.STAGING) === 0) continue;
                            const resistance = resistanceArray[uid];

                            if (resistance <= 0 && releasedCount < NODE_QUOTA_PER_FRAME) {
                                const level = uidToLevelMap.get(uid) ?? 0;
                                const staticParents = dependency._GetPrevDependency(uid);

                                if (level <= currentLevel || staticParents.length <= 1) {
                                    // 捞起！
                                    flagArray[uid] &= ~NodeStatus.STAGING; // 撕 STAGING
                                    stagingActiveCount--;

                                    if (!(flagArray[uid] & NodeStatus.READY)) {
                                        flagArray[uid] |= NodeStatus.READY; // 发 READY
                                        readyQueue[readyCount++] = uid;
                                        readyActiveCount++;
                                    }

                                    releasedCount++;
                                    foundGreedy = true;
                                    const path = data.GetPathByUid(uid);
                                    const triggerUid = triggerSourceArray[uid];

                                    SHARED_PAYLOAD.path = path;
                                    SHARED_PAYLOAD.type = 4;
                                    // SHARED_PAYLOAD.triggerPath = null;
                                    SHARED_PAYLOAD.triggerPath = triggerUid >= 0 ? data.GetPathByUid(triggerUid) : null;
                                    hooks.emit(MeshFlowEventsName.NodeRelease,SHARED_PAYLOAD)
                                    continue; // 捞起的不进 nextStagingCount
                                }
 
                            }
                            stagingQueue[nextStagingCount++] = uid;
                        }
                        stagingCount = nextStagingCount;

                        if (releasedCount > 0) continue;

                        if (foundGreedy) {
                            // 修复点：在 continue 之前，必须再次检查时间片！
                            // 如果已经超时，不能 continue 去跑新任务，必须 break 出去让位
                            if (timeScheduler._shouldYield()) {
                                await timeScheduler._yieldToMain();
                                if (currentExecutionToken.get(triggerToken) !== curToken) break;
                            }
                            continue;
                        }
                    }
                  
                    // ==========================================================
                    // 阶段三：水位推进 (逻辑出口 A)
                    /**
                     * [BOT] 阶段 3: 水位推进 & 量子逆转 (当前水位工作全部完成的结算阶段)
                     *
                     * 条件: processingCount===0 && readyActiveCount===0
                     *
                     * 3A【量子逆转】currentEntangleArray 非空:
                     *   1. 对每个命中节点调用 resolveGhosts() — 坍缩幽灵提案
                     *      (按权重裁决 set/update/patch，将终值写入 node.state)
                     *   2. 标记 calledBy=INVERSION → 打入 readyQueue
                     *   3. 压低水位: 如果纠缠命中了超低层级节点，currentLevel 回退
                     *   4. continue → 回到阶段 1 (纠缠修改需要重新推演下游)
                     *
                     * 3B【水位推进】无量子逆转，但有更高层待处理节点:
                     *   1. 从 RESURE (弱信号) 和 STAGING (强信号) 中找最小下一层级
                     *   2. currentLevel = nextLevel (推进水位)
                     *   3. 捞出该层级所有节点 → continue → 回到阶段 1
                     *
                     * 3C【截流退出】无更高层级可推进:
                     *   1. 所有 RESURE/STAGING 节点标记 PROCESSED (静默丢弃)
                     *   2. break → 退出 while → finally → FlowSuccess
                     *   (这些节点因为上游没有真正变更而被剪枝)
                     */
                    // ==========================================================
                    if (processingCount === 0 && readyActiveCount === 0) {    
                     
                      // 🛑 核心屏障：如果天上还有纠缠任务在飞，拒绝结算！
                        if (turnstile.inFlightCount > 0) {
                            // 直接跳出 while 循环！
                            // 引擎会顺滑地进入下方的 finally 块，触发 waitType = 3，
                            // 然后启动 requestAnimationFrame(monitor) 挂起等待。
                     
                            break; 
                        }
                        if(timeScheduler._shouldYield()){
                            uitrigger._requestUpdate();
                            await timeScheduler._yieldToMain();
                            if (currentExecutionToken.get(triggerToken) !== curToken) break;
                        }
                        if (currentEntangleArray.length === 0 && nextEntangleArray.length > 0 ) {
                            currentEntangleArray.push(...nextEntangleArray);
                            nextEntangleArray.length = 0; // 清空未来缓冲区
                            quantumWatermark = Math.max(
                                ...currentEntangleArray.map(uid => uidToLevelMap.get(uid) || 0)
                            );
                          
                            turnstile._nextEpoch();
                            SHARED_PAYLOAD.timestamp = performance.now();
                            hooks.emit(MeshFlowEventsName.EntangleEpochChange,SHARED_PAYLOAD);
                        }
                        if (currentEntangleArray.length > 0) {
                            let hasQuantumReversal = false;
                            let minReversalLevel = currentLevel;

                            // 去重
                            // const uniqueHitTargetUids = Array.from(
                            //     new Set(currentEntangleArray)
                            // );
                            const uniqueHitTargetUids: number[] = [];
                            for (let i = 0; i < currentEntangleArray.length; i++) {
                                const u = currentEntangleArray[i];
                                if (_dedupeSeenMap[u] === 0) {
                                    _dedupeSeenMap[u] = 1;
                                    uniqueHitTargetUids.push(u);
                                }
                            }
                            // 清理现场
                            for (let i = 0; i < uniqueHitTargetUids.length; i++) {
                                _dedupeSeenMap[uniqueHitTargetUids[i]] = 0;
                            }
                            currentEntangleArray.length = 0;   
                            
                            for (const targetUid of uniqueHitTargetUids) {
                                const targetNode = data.GetNodeByUid(targetUid);
                                // const targetPath = data.GetPathByUid(targetUid);
                                
                                //  resolveGhosts 现返回被修改的具体 Key 数组
                                const changedByGhost = resolveGhosts(targetNode);
                            
                                if (changedByGhost && changedByGhost.length > 0) {
                                    hasQuantumReversal = true;

                                    // 核心标记：打上量子唤醒烙印
                                    targetNode.calledBy = TriggerCause.INVERSION;

                                    // 必须把坍缩修改的 key 塞进接力棒，等它进入 executor 时才能拿出来！
                                    // const existingBaton = ghostBaton[targetUid] || [];
                                    // ghostBaton[targetUid] = Array.from(new Set([...existingBaton, ...changedByGhost]));
                                    const currentBaton = ghostBaton[targetUid];
                                    if (!currentBaton) {
                                        // 第一次，直接把数组引用丢进去 (注意，如果 changedByGhost 是复用的，这里需要 slice，但根据你的 resolveGhosts 它是新建返回的，所以直接复用引用最快)
                                        ghostBaton[targetUid] = changedByGhost;
                                    } else {
                                        // 已经有接力棒了，原地推入不存在的 Key
                                        for (let i = 0; i < changedByGhost.length; i++) {
                                            const changedKey = changedByGhost[i];
                                            // 字符串比对在短数组里极快
                                            if (currentBaton.indexOf(changedKey) === -1) {
                                                currentBaton.push(changedKey);
                                            }
                                        }
                                    }

                                    //  只抹除目标节点自己的记忆！
                                    // 绝对不要去扫荡 GetAllNextDependency！把唤醒下游的任务交给 calledBy 动能传导！
                                    // processed.delete(targetNode.uid);
                                    // processed[targetUid] = 0;
                                    flagArray[targetUid] &= ~NodeStatus.PROCESSED

                                    // 从暂存区拉回起跑线
                                    // stagingArea.delete(targetNode.uid);
                                    // readyToRunBuffer.add(targetNode.uid);
                                    if (flagArray[targetUid] & NodeStatus.STAGING) {
                                        flagArray[targetUid] &= ~NodeStatus.STAGING;
                                        stagingActiveCount--;
                                    }
                                    if (!(flagArray[targetUid] & NodeStatus.READY)) {
                                        flagArray[targetUid] |= NodeStatus.READY;
                                        readyQueue[readyCount++] = targetUid;
                                        readyActiveCount++;
                                        triggerSourceArray[targetUid] = -2;
                                    }

                                    // 获取最低影响水位
                                    const targetLevel = uidToLevelMap.get(targetNode.uid) ?? 0;
                                    if (targetLevel < minReversalLevel) {
                                        minReversalLevel = targetLevel;
                                    }

                                    updateWatermark(targetNode.uid);
                                    // uitrigger._flushPathSet.add(targetNode.uid);
                                    uitrigger._addToRender(targetNode.uid);
 
                                }else{
                                    //没有发生变更就走这里
                                    SHARED_PAYLOAD.path = targetNode.path;
                                    SHARED_PAYLOAD.type = 2; // 对应 "状态已定型"
                                    SHARED_PAYLOAD.triggerPath = null; 
                                    hooks.emit(MeshFlowEventsName.NodeIntercept, SHARED_PAYLOAD);
                                }
                            }

                            if (hasQuantumReversal) {
                                if (minReversalLevel <= currentLevel) {
                                    currentLevel = minReversalLevel;
                                }
                                uitrigger._requestUpdate();

                                if(timeScheduler._shouldYield()){
                                    await timeScheduler._yieldToMain();
 
                                    if (currentExecutionToken.get(triggerToken) !== curToken) break;
                                }
                                

                                continue; // 有节点被唤醒，重新开始循环发车，绝不提升水位
                            }
                        }
 
                        // ==========================================================
                        // 极速优化：寻找最小的待处理层级 (Zero-Allocation 模式)
                        // ==========================================================
                        let nextLevel = Infinity; // 初始设为无限大

                        // 1. 从弱信号区 (resureArea) 找最低水位
 
                        for (let i = 0; i < resureCount; i++) {
                            const uid = resureQueue[i];
                            if ((flagArray[uid] & NodeStatus.RESURE)) {
                                const lvl = levelArray[uid];
                                if (lvl < nextLevel) nextLevel = lvl;
                            }
                        }

                        // 2. 从强信号阻力区 (stagingArea) 找最低水位
 
                        for (let i = 0; i < stagingCount; i++) {
                            const uid = stagingQueue[i];
                            if ((flagArray[uid] & NodeStatus.STAGING)) {
                                const lvl = uidToLevelMap.get(uid) ?? 0;
                                if (lvl > currentLevel && lvl < nextLevel) {
                                    nextLevel = lvl;
                                }
                            }
                        }

                        if (nextLevel !== Infinity && nextLevel <= maxAffectedLevel) {
 
                                currentLevel = nextLevel;

                                // 捞弱信号
                                let nextResureCount = 0;
                                for (let i = 0; i < resureCount; i++) {
                                    const uid = resureQueue[i];
                                    // 如果节点依然有 RESURE 标记
                                    if (flagArray[uid] & NodeStatus.RESURE) {

                                        // 如果恰好是当前水位，捞走！
                                        if (levelArray[uid] === nextLevel) {
                                            flagArray[uid] &= ~NodeStatus.RESURE;
                                            resureActiveCount--;
                                            // const node = data.GetNodeByUid(uid);
                                            // if (node.calledBy === TriggerCause.INVERSION) {
                                            //     node.calledBy = TriggerCause.CAUSALITY; // 洗回正常的因果流标签
                                            // }

                                            if (!(flagArray[uid] & NodeStatus.READY)) {
                                                flagArray[uid] |= NodeStatus.READY;
                                                readyQueue[readyCount++] = uid;
                                                readyActiveCount++;
                                            }
                                        } else {
                                            // 不是当前水位的，原地压缩，挪到前面
                                            resureQueue[nextResureCount++] = uid;
                                        }
                                    }
                                }
                                resureCount = nextResureCount;

                                // 捞被水位拦截的强信号
 
                                let nextStagingCount = 0;
                                for (let i = 0; i < stagingCount; i++) {
                                    const uid = stagingQueue[i];
                                    if (flagArray[uid] & NodeStatus.STAGING) {
                                        const nodeLevel = uidToLevelMap.get(uid) ?? 0;
                                        if (nodeLevel === nextLevel) {
                                            flagArray[uid] &= ~NodeStatus.STAGING;
                                            stagingActiveCount--;
                                            // const node = data.GetNodeByUid(uid);
                                            // if (node.calledBy === TriggerCause.INVERSION) {
                                            //     node.calledBy = TriggerCause.CAUSALITY; 
                                            // }
                                            if (!(flagArray[uid] & NodeStatus.READY)) {
                                                flagArray[uid] |= NodeStatus.READY;
                                                readyQueue[readyCount++] = uid;
                                                readyActiveCount++;
                                            }
                                            const path = data.GetPathByUid(uid);
                                            const triggerUid = triggerSourceArray[uid];
                                            // hooks.emit(MeshFlowEventsName.NodeRelease, { path, type: 3, detail: { level: nextLevel } });
                                            SHARED_PAYLOAD.path = path;
                                            SHARED_PAYLOAD.type = 3;
                                            SHARED_DETAIL.level = nextLevel;
                                            SHARED_PAYLOAD.triggerPath = triggerUid >= 0 ? data.GetPathByUid(triggerUid) : null;
                                            hooks.emit(MeshFlowEventsName.NodeRelease,SHARED_PAYLOAD)
                                        } else {
                                            stagingQueue[nextStagingCount++] = uid;
                                        }
                                    }
                                }
                                stagingCount = nextStagingCount;
                                continue; // 推进水位后，重新循环发车
                            // }
                        } else {

                            for (let i = 0; i < resureCount; i++) {
                                const uid = resureQueue[i];
                                if ((flagArray[uid] & NodeStatus.RESURE)) {
                                    // processed[uid] = 1;
                                    flagArray[uid] |= NodeStatus.PROCESSED
                                    const path = data.GetPathByUid(uid);
                                    const triggerUid = triggerSourceArray[uid];
                                    SHARED_PAYLOAD.path = path;
                                    SHARED_PAYLOAD.type = 6;
                                    SHARED_PAYLOAD.triggerPath = triggerUid >= 0 ? data.GetPathByUid(triggerUid) : null;
                                    hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)
                                }
                            }
                            resureCount = 0; resureActiveCount = 0;

                            // 2. 清除所有强信号 (StagingArea)
 
                            for (let i = 0; i < stagingCount; i++) {
                                const uid = stagingQueue[i];
                                if ((flagArray[uid] & NodeStatus.STAGING)) {
                                    // processed[uid] = 1;
                                    flagArray[uid] |= NodeStatus.PROCESSED
                                    const path = data.GetPathByUid(uid);
                                    const triggerUid = triggerSourceArray[uid];
                                    SHARED_PAYLOAD.path = path;
                                    SHARED_PAYLOAD.type = 6;
                                    SHARED_PAYLOAD.triggerPath = triggerUid >= 0 ? data.GetPathByUid(triggerUid) : null;
                                    hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)
                                }
                            }
                            stagingCount = 0; stagingActiveCount = 0;
                            // 3. 彻底退出 while 循环，进入 finally 结算 flow:success
                            break;
                        }
                    }

                    // ==========================================================
                    // 阶段四：判定是否进入物理等待 (逻辑出口 B)
                    /**
                     * [BOT] 阶段 4: 并发等待 — 就绪节点存在但并发工位已满
                     *
                     * break 退出 while，等正在执行的异步节点 finalizeExecution 完成后
                     * 通过 scheduleNext() 重新调起 flushQueue，形成天然背压回流。
                     */
                    // ==========================================================
                    if (
                        // readyToRunBuffer.size > 0 &&
                        readyActiveCount > 0 &&
                        // processingSet.size >= MAX_CONCURRENT_TASKS
                        processingCount >= MAX_CONCURRENT_TASKS
                    ) {
                        // 这种情况叫“并发限制等待”
                        // hooks.emit( MeshFlowEventsName.FlowWait , {
                        //     type: 2,
                        // });
                        SHARED_PAYLOAD.type = 2;
                        hooks.emit(MeshFlowEventsName.FlowWait,SHARED_PAYLOAD)
                    }
                    
                    // 实在没活了，或者正在等异步任务返回
                    break;
                }
            } finally {
                /**
                 * [BOT] finally 结算 — 无论 while 如何退出都走到这里，处理三种结果:
                 *
                 * 【FlowSuccess】remaining===0 && asyncRemaining===0 (全部完成，无异步飞行):
                 *   1. 检查 stageBuffer 是否有残留外部输入 → 收割后重新 flushQueue
                 *   2. 发射 FlowEnd → FlowSuccess 事件
                 *   3. turnstile.commit() — 将纠缠修改写入历史模块
                 *   4. callOnSuccess() — 触发用户注册的成功钩子
                 *   5. 事务链则 taskSchduler.runNext() 执行下一个事务
                 *
                 * 【FlowWait】remaining>0 || asyncRemaining>0 (还有工作未完成):
                 *   waitType=1: 有节点在执行中 (等 finalizeExecution 回调重入 flushQueue)
                 *   waitType=3: 纠缠异步任务未归 → 启动 rAF 心跳监听器 (monitor)
                 *     每帧检查 turnstile.inFlightCount → 归零则 applyStageValue + flushQueue
                 *
                 * 【FlowAbort】globalLatestSessionToken !== curToken (本轮被新点火废弃):
                 *   发射 FlowAbort 事件 → 直接 return，不执行任何清理 (新轮已接管)
                 */
                isLooping = false;
                // 最终结算检查
                const remaining =
                    // processingSet.size + stagingArea.size + readyToRunBuffer.size;
                    // processingCount + stagingArea.size + readyToRunBuffer.size;
                    processingCount + stagingActiveCount + readyActiveCount;
                // 🌟 从 Turnstile 获取当前是否有正在飞行的异步纠缠
                const asyncRemaining = turnstile.inFlightCount || 0;

                const isGlobalValid = globalLatestSessionToken === curToken;
                
           
                // 核心修复：死前必须发送遗言 
                if (!isGlobalValid) {
                    // 告诉 Logger：“我被挤掉了，把我的 token 销毁吧，别等我了”
                    // hooks.emit( MeshFlowEventsName.FlowAbort , { token: curToken });
                    SHARED_PAYLOAD.token = curToken;
                    hooks.emit(MeshFlowEventsName.FlowAbort,SHARED_PAYLOAD)
                    return;
                }

                uitrigger._requestUpdate();
 
                
                if (remaining === 0 && asyncRemaining === 0) {
                  
                    if (stageBuffer.length > 0) {
                        
                        // 发现未处理的外部输入！
                        applyStageValue(); // 把 stageBuffer 里的值并入节点，这会触发节点状态变为 READY
                        
                        // 并入之后，立刻安排下一波发车，千万不能结束！
                        _nextMacroTick(() => {
                            if (globalLatestSessionToken === curToken) {
                                flushQueue(); 
                            }
                        });
                        return; // 截断下面的 FlowSuccess 逻辑！
                    }

                    if (
                        currentExecutionToken.get(triggerToken) === curToken &&
                        !isFlowFinished
                    ) {
 
                        isFlowFinished = true;
             

                        SHARED_PAYLOAD.type = 1;
                        hooks.emit(MeshFlowEventsName.FlowEnd,SHARED_PAYLOAD)

                    
                        turnstile.resetCounters();
                 
                        ghostBaton.fill(null);
                        isTaskActive = false; 
                    
                        quantumWatermark = -1;
                        

                        // resetEngineState()


                        currentExecutionToken.delete(triggerToken);
                       
                        if(isTaskTakeOver){
                            SHARED_PAYLOAD.duration = performance.now() - startTime;
                            SHARED_PAYLOAD.fromToken = curToken
                            hooks.emit(MeshFlowEventsName.TransactionProgress, SHARED_PAYLOAD);
                            taskSchduler.runNext();
                            return
                             
                          
                        }else{
                            taskSchduler.reset();
                        }

                      
                        SHARED_PAYLOAD.token = curToken;
                        SHARED_PAYLOAD.duration = (performance.now() - startTime);
                        hooks.emit(MeshFlowEventsName.FlowSuccess,SHARED_PAYLOAD)
                      
                        currentEntangleArray.length = 0;
                        nextEntangleArray.length = 0;
                        Promise.resolve().then(() => {
                            if(source!==1){
                                turnstile.commit();
                            };
                            
                            hooks.callOnSuccess();
                        });
                    } 
                } else {
                    const waitType = remaining === 0 && asyncRemaining > 0 ? 3 : 1;
                 
                    // hooks.emit( MeshFlowEventsName.FlowWait , {
                    //     type: waitType,
                    //     detail: {
                    //         // nums: processingSet.size,
                    //         nums:processingCount,
                    //         asyncNums: asyncRemaining, // 把纠缠数传给 logger
                    //     },
                    // });

                    SHARED_PAYLOAD.type = waitType;
                    SHARED_DETAIL.nums = processingCount;
                    SHARED_DETAIL.asyncNums = asyncRemaining;
                    hooks.emit(MeshFlowEventsName.FlowWait,SHARED_PAYLOAD)

                    if(asyncRemaining>0){

                        if (!isHeartbeatRunning) {
                            isHeartbeatRunning = true; // 上锁

                            const monitor = () => {
                                // 1. 令牌校验：如果中途被新任务顶替，旧心跳必须物理终止并放锁
                                if (globalLatestSessionToken !== curToken) {
                                    isHeartbeatRunning = false; // 🌟 补丁：令牌失效，必须放锁
                                    return;
                                };
                            
                                // 2. 核心分水岭
                                if (turnstile.inFlightCount === 0) {
                                    // 🌟 补丁 1：既然账平了，心跳使命就结束了，立刻放锁
                                    isHeartbeatRunning = false; 
                            
                                    // 账平了！重新调起主引擎收割
                                    applyStageValue();
                                    //发射纪元变更事件
                                    // SHARED_PAYLOAD.timestamp = performance.now();
                                    // hooks.emit(MeshFlowEventsName.EntangleEpochChange,SHARED_PAYLOAD);
                                    
                                    _nextMacroTick(() => {
                                        if (globalLatestSessionToken === curToken) {
                                            // 如果在 tick 期间又冒出幽灵了，交给下一次 flushQueue 的 finally 处理
                                            if (turnstile.inFlightCount === 0) {
                                                flushQueue(); 
                                            }
                                        }
                                    });
                                    
                                    // 🌟 补丁 2：这里直接 return，彻底截断递归链条
                                    // 这样底部的 requestAnimationFrame(monitor) 就永远不会在 0 的时候执行
                                    return; 
                            
                                } else {
                                    // 🌟 证明：只有在幽灵还在飞 (>0) 时，才会执行这里的打印和递归
                             
                            
                                    safeRequestAnimationFrame(monitor)
                                }
                            };
                            
                            // 启动帧循环监听
                    
                            safeRequestAnimationFrame(monitor)
                        }
                    }
                }
            }
        };

        flushQueue();
    };

    return {TaskRunner,_CancelTask,_stageValueFn};
}

export { useMeshTask };
