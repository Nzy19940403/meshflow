import { createScheduler, nextMacroTick } from "../utils/util";
import {
    MeshPath,
    MeshEmit,
    MeshFlowTaskNode,
    TriggerCause,
    MeshFlowEventsName,
    NodeStatus,
} from "../types/types";
import { SchemaBucket } from "./bucket";

function useMeshTask<P extends MeshPath, NM>(
    config: {
        useGreedy: boolean;
    },
    dependency: {
        GetAllNextDependency: (targetUid: number) => number[];
        GetAllPrevDependency: (targetUid: number) => number[];
        GetPrevDependency: (targetUid: number) => number[];
        GetNextDependency: (targetUid: number) => number[];
        GetDependencyOrder: () => number[][];
        GetUidToLevelMap: () => Map<number, number>;
    },
    data: {
        GetNodeByPath: (p: P) => MeshFlowTaskNode<P, any, NM>;
        GetNodeByUid:(uid:number)=>MeshFlowTaskNode<P, any, NM>,
        GetPathByUid:(uid:number)=>P,
        GetBucket:(bucketId:number)=>SchemaBucket<P>,
        GetMaxUid:()=>number,
        Turnstile: any; // 引入旋转门接口
    },
    hooks: {
        callOnError: any;
        callOnSuccess: any;
        callOnStart: any;
        emit: MeshEmit;
    },
    uitrigger: {
        requestUpdate: () => void;
        flushPathSet: Set<number>;
    },
    timeScheduler: ReturnType<typeof createScheduler>
) {
    const currentExecutionToken: Map<P, symbol> = new Map();

    const isGreedy = config.useGreedy;

    // const scheduler = createScheduler();
    let globalLatestSessionToken: symbol | null = null;

    const CancelTask = ()=>{
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
        detail: SHARED_DETAIL // 嵌套对象也必须是复用的
    };

    //运行调用入口
    const TaskRunner = async (triggerUid: number | null, initialNodes: number[]) => {
        //最大并发数
        const MAX_CONCURRENT_TASKS = 40;

        const curToken = Symbol("token");

        const triggerToken = (typeof triggerUid === 'number'? triggerUid : "__NOTIFY_ALL__") as unknown as P ;
 
        currentExecutionToken.set(triggerToken, curToken);
        globalLatestSessionToken = curToken;

     
        
        let isLooping = false; // 状态锁：标志 while 循环是否在运行
        let isHeartbeatRunning = false;

        //scheduler重置
        timeScheduler.reset();

        const maxUid = data.GetMaxUid() + 3;
      
 
        // const processed = new Set<number>();
        // const processingSet = new Set<number>();
        // const AllAffectedPaths = new Set<number>();

        // const processed:Array<number> = new Array(maxUid).fill(0);
        // const processingSet:Array<number> = new Array(maxUid).fill(0);
        const AllAffectedPaths:Array<number> = new Array(maxUid).fill(0);
        let processingCount:number = 0;

        // 🌟 2. 状态大盘（位运算专用，极其省内存，极速查状态）
        const flagArray = new Uint8Array(maxUid); 

        // 🌟 3. 数值大盘（防溢出专用）
        const resistanceArray = new Int32Array(maxUid);
        const levelArray = new Int32Array(maxUid);

        // 🌟 4. 遍历队列（负责极速 for 循环）
        const readyQueue = new Int32Array(maxUid*2);
        let readyCount = 0;
        let readyActiveCount = 0;

        const stagingQueue = new Int32Array(maxUid*2);
        let stagingCount = 0;
        let stagingActiveCount = 0;

        const resureQueue = new Int32Array(maxUid*2);
        let resureCount = 0;
        let resureActiveCount = 0;

        initialNodes.forEach((uid) => {
            AllAffectedPaths[uid] = 1;
            dependency
                .GetAllNextDependency(uid)
                .forEach((childUid) =>{
                    AllAffectedPaths[childUid] = 1
                });
        });

        //等待执行区,直接上游发生变化了会把节点加入这里
        // const stagingArea = new Map<number, number>();
        // // 等待捕捞区,上游没有变但是不好直接扔所以把这个先扔在这里等待捕捞
        // const resureArea = new Map<number, Set<number>>();

        // 幽灵接力棒：暂存 resolveGhosts 真正修改了哪些 Key，交给 executor 使用，用完即焚
        // const ghostBaton = new Map<P, string[]>();
        // const ghostBaton = new Map<number, string[]>();
        const ghostBaton: Array<string[] | null> = new Array(maxUid).fill(null);

        // ==========================================================
        // 预言弹药库：只在阶段三集中引爆
        // ==========================================================
        const currentEntangleArray: number[] = [];

        const turnstile = data.Turnstile;


        const dirtyKeysPool:Array<Array<string>> = new Array(maxUid).fill(null).map(() => []);
        const promisesPool:Array<Array<Promise<void>>> = new Array(maxUid).fill(null).map(() => []);


        // ==========================================================
        //  2. 捞取火种 
        // ==========================================================

        // 终极上帝开关：不仅要看 Turnstile 存不存在，还要看它里面有没有真实注册的高危层级！
        // 如果当前拓扑完全没有注册过 useEntangle，那么 volatileLevels.size 就是 0
        const IS_ENTANGLEMENT_ENABLED = turnstile.volatileLevels.size > 0;

        const hasObserver:(uid: number) => boolean = IS_ENTANGLEMENT_ENABLED
            ? turnstile.hasObserver
            : (uid:number) => false;
        const emitGhosts:(observerNode: MeshFlowTaskNode<P, any, NM>, changedKeys: string[])=>number[] | Promise<number[]> = IS_ENTANGLEMENT_ENABLED
            ? turnstile.receiveGhosts
            : () => [];
        const resolveGhosts:(node: MeshFlowTaskNode<P, any, NM>) => string[] = IS_ENTANGLEMENT_ENABLED
            ? turnstile.resolveGhosts
            : () => [];
        const getTriggerKeys:(uid: number) => string[] = IS_ENTANGLEMENT_ENABLED
            ? turnstile.getTriggerKeys
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
        const uidToLevelMap = dependency.GetUidToLevelMap();

        // const triggerLevel = pathToLevelMap.get(triggerPath) ?? 0;
        let currentLevel = 0;
        let maxAffectedLevel = 0;
        const updateWatermark = (uid: number) => {
            const descendants = dependency.GetAllNextDependency(uid);
            descendants.forEach((u) => {
                const level = uidToLevelMap.get(u) || 0;
                if (level > maxAffectedLevel) {
                    maxAffectedLevel = level;
                }
            });
        };

       // ==========================================================
        // 阶段 0：源力探针 (Prime Mover Prophecy)
        // ==========================================================

        const primeMovers = new Set<number>();

        // 1. 处理外部触发源 (God Node)
        if (typeof triggerUid === 'number') {
            // processed.add(triggerUid);
            // processed[triggerUid] = 1;
            flagArray[triggerUid] |= NodeStatus.PROCESSED


            primeMovers.add(triggerUid);
            updateWatermark(triggerUid);
            uitrigger.flushPathSet.add(triggerUid);
 
        }

        // 核心：seedsOfChaos 用于发射预言，它必须包含 triggerUid
        const seedsOfChaos = typeof triggerUid==='number' ? [triggerUid] : initialNodes;

        if(timeScheduler.shouldYield()){
            uitrigger.requestUpdate();
            await timeScheduler.yieldToMain();
        }
        

        // 2. 并发嗅探：发射预言
        const prophecyPromises = seedsOfChaos.map(async (seed) => {
            
            if (hasObserver(seed)) {
                const nodeObj = data.GetNodeByUid(seed);
                const registeredKeys = getTriggerKeys(seed);

                if (registeredKeys.length > 0) {
                    let hitTargets = emitGhosts(nodeObj, registeredKeys);
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
            uitrigger.requestUpdate();
            await timeScheduler.yieldToMain();
  
            if (currentExecutionToken.get(triggerToken) !== curToken) return;
        }

        // 3. 致命修复区：必须把正常的下游节点 (initialNodes) 送入队列！
        const isQuantumAwakenedAtStart = currentEntangleArray.length > 0;

        initialNodes.forEach((u) => {
            if (!primeMovers.has(u)) {
                if (isQuantumAwakenedAtStart) {
                    // 🛡️ 预言已出，正常节点先挂起，等水位推进
                    const level = uidToLevelMap.get(u) ?? 0;
                    // if (!resureArea.has(level)) resureArea.set(level, new Set());
                    // resureArea.get(level)!.add(p);
                    levelArray[u] = level;
                    if(!(flagArray[u] & NodeStatus.RESURE)){
                        flagArray[u] |= NodeStatus.RESURE;
                        resureQueue[resureCount++] = u;
                        resureActiveCount++;
                    }
                    const p = data.GetPathByUid(u);
                    SHARED_PAYLOAD.path = p;
                    SHARED_PAYLOAD.type = 2;
                    hooks.emit(MeshFlowEventsName.NodeStagnate,SHARED_PAYLOAD)
                    // hooks.emit(MeshFlowEventsName.NodeStagnate, { path: p, type: 2 });
                } else {
                    // 正常宇宙，准许进入发车队列
                    // readyToRunBuffer.add(u);
                    if(!(flagArray[u] & NodeStatus.READY )){
                        flagArray[u] |= NodeStatus.READY;
                        readyQueue[readyCount++] = u;
                        readyActiveCount++;
                    }

                    updateWatermark(u); // 确保它们推高水位线
                }
            }
        });

        // 4. 锁定起始推演水位
        if (typeof triggerUid==='number') {
            currentLevel = uidToLevelMap.get(triggerUid) ?? 0;
        } else {
            currentLevel = Math.min(...initialNodes.map(p => uidToLevelMap.get(p) ?? 0));
        }

        const startTime = performance.now();
        const p = typeof triggerToken==='number'?data.GetPathByUid(triggerToken):'__NOTIFY_ALL__'
        // hooks.emit(MeshFlowEventsName.FlowStart, { path: p , token:curToken });
        SHARED_PAYLOAD.path = p;
        SHARED_PAYLOAD.token =curToken;
        hooks.emit(MeshFlowEventsName.FlowStart,SHARED_PAYLOAD)

        //调用开始钩子
        hooks.callOnStart({
            path: p,
        });

        let isFlowFinished = false;

        //背压参数
        const BACKPRESSURE_LIMIT = 30;

        const executorNodeCalculate = (targetUid: number, currentTriggerUid: number | null) => {
         
    
            let hasValueChanged = false;  // 仅负责：决定是否触发 uitrigger.flushPathSet
            let hasNotifyKeyTriggered = false; // 🌟 负责：判断是否推高水位和通知下游

            let notifyNext = false;

            const targetSchema = data.GetNodeByUid(targetUid);

            const targetPath = data.GetPathByUid(targetUid);

            // 记录进入时的状态，用于在纠缠震荡状态时传播给下游
            const originalCause = targetSchema.calledBy as unknown as TriggerCause;

            // 性能核心：这是本节点生命周期内唯一的“脏位收集器”
            // const dirtyEntangleKeys: string[] = [];

            // // 收集所有的异步 Promise
            // const pendingPromises: Promise<void>[] = [];

            const dirtyEntangleKeys = dirtyKeysPool[targetUid];
            dirtyEntangleKeys.length = 0; // 物理清空

            const pendingPromises = promisesPool[targetUid];
            pendingPromises.length = 0;

            // ==========================================================
            // 幽灵装甲 (Ghost Armor)
            // ==========================================================
            let isGhostly = false;
            
            if (targetSchema.calledBy === TriggerCause.INVERSION) {
                isGhostly = true;
                // targetSchema.calledBy = 0 ; // 卸下装甲，归还自由身，上面以及记录了这个节点是怎么被复活的，所以现在calledBy没有继续以1存在的必要
                hasValueChanged = true; // 强制宣告变更，保证触发下游
                uitrigger.flushPathSet.add(targetUid);

                // 提取接力棒：把刚才 resolveGhosts 修改的 Key 拿过来！
                // const incomingEntangleKeys = ghostBaton.get(targetPath);
                // const incomingEntangleKeys = ghostBaton.get(targetUid)
                const incomingEntangleKeys = ghostBaton[targetUid];
                if (incomingEntangleKeys) {
                    dirtyEntangleKeys.push(...incomingEntangleKeys);
                    // ghostBaton.delete(targetUid); // 物理清空，释放内存
                    ghostBaton[targetUid] = null;
                }
            }

            // 这个函数只负责：减阻力 -> 判断归零 -> 入队
            //reasontype -> 1:上游 ${targetPath} 值变了 2: 当上游值没有变但是下游节点已经在stagingArea的时候`上游 ${targetPath} 完成(穿透)`
            const tryActivateChild = (childUid: number, reasonType: number) => {
                // if((targetPath as any).includes('Renew2')){
                //     debugger
                // }
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
                // 1. 如果已经处理过或正在处理，直接忽略
                if (
                    flagArray[childUid] & (NodeStatus.PROCESSED | NodeStatus.PROCESSING | NodeStatus.READY)
                ) {
                    // 这里可以 emit 一个 intercept，但对于性能优化可以省略
                    return;
                }

                // 2. 阻力计算策略：惰性初始化 vs 递减
                // if (!stagingArea.has(childUid)) {
                if (!( flagArray[childUid] & NodeStatus.STAGING )) {
                    if (
                        childLevel > currentLevel &&
                        // stagingArea.size > BACKPRESSURE_LIMIT
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
                        }
                        // hooks.emit( MeshFlowEventsName.NodeIntercept , {
                        //     path: childPath,
                        //     type: 7, // 自定义类型：背压拦截
                        //     // detail: { stagingSize: stagingArea.size }
                        // });
                        SHARED_PAYLOAD.path = childPath;
                        SHARED_PAYLOAD.type = 7;
                        hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)
                        return;
                    }
                    // Case A: 第一次被触碰 (Lazy Init)
                    // 我们不查 AllAffectedPaths，我们查“还有几个爸爸没死？”
                    const parentUids = dependency.GetPrevDependency(childUid);

                    let pendingCount = 0;
                    for (const uid of parentUids) {
                        // 如果爸爸已经在已完成名单里，它就不是阻力
                        // if (processed.has(p)) continue;
                        // if(processed[uid]===1) continue;
                        if(flagArray[uid] & NodeStatus.PROCESSED) continue;

                        const pLevel = uidToLevelMap.get(uid) ?? 0;

                        // 🔥 核心逻辑：你的需求实现
                        // 如果爸爸还没跑完，但爸爸的层级 <= 当前水位线，
                        // 说明这个爸爸是“上一波”的人，它被跳过/剪枝了，不算阻力。
                        // 只有那些层级比当前还高的（或者未来的）未完成节点，才是真正的阻力。
                        if (pLevel > currentLevel) {
                            pendingCount++;
                        }
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
                        
                        // hooks.emit( MeshFlowEventsName.NodeIntercept , {
                        //     path: childPath,
                        //     // reason: `节点 ${child} 正忙 (Q:${isAlreadyInQueue}, R:${isAlreadyRunning})`,
                        //     type: isAlreadyRunning ? 3 : 3.1,
                        // });

                        SHARED_PAYLOAD.path = childPath;
                        SHARED_PAYLOAD.type = isAlreadyRunning ? 3 : 3.1;
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

                    // hooks.emit( MeshFlowEventsName.NodeRelease , {
                    //     path: childPath,
                    //     type: reasonType,
                    //     detail: { path: targetPath },
                    // });

                    SHARED_PAYLOAD.path = childPath;
                    SHARED_PAYLOAD.type = reasonType;
                    SHARED_DETAIL.path = targetPath;
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
                                dirtyEntangleKeys.push(key); 
                                hasValueChanged = true;

                                // 新增：副作用里的 key 也受 notifyKeys 检查！
                                if (targetSchema.notifyKeys.size === 0 || targetSchema.notifyKeys.has(key as any)) {
                                    hasNotifyKeyTriggered = true;
                                }
                            }
                        } else {
                            const errorInfo = {
                                error: `wrong effect in ${String(targetSchema.path)}`,
                            };
                            throw errorInfo;
                        }
                    }
      
                }

                if (hasValueChanged) uitrigger.flushPathSet.add(targetUid);

                const finishPropagation = (hitTargetUids: number[] = []) => {
                    if (currentExecutionToken.get(triggerToken) !== curToken) return;
                     
                    if (hitTargetUids && hitTargetUids.length > 0) {
                        currentEntangleArray.push(...hitTargetUids);
                        quantumWatermark = Math.max(
                            quantumWatermark,
                            uidToLevelMap.get(targetUid) || 0
                        );
                    }

                    // 清理脏位回收池，避免影响下次使用
                    dirtyEntangleKeys.length = 0;
                    // hooks.emit( MeshFlowEventsName.NodeSuccess , {
                    //     path: targetPath,
                    //     calledBy: targetSchema.calledBy,
                    // });

                    SHARED_PAYLOAD.path = targetPath;
                    SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                    hooks.emit(MeshFlowEventsName.NodeSuccess,SHARED_PAYLOAD)

                    // processed.add(targetUid);
                    // processed[targetUid] = 1;
                    flagArray[targetUid] |= NodeStatus.PROCESSED;

                    const directChildren = dependency.GetNextDependency(targetUid);

                    // 3.1 扩充疆域 (AllAffectedPaths)
                    // if ( hasValueChanged || notifyNext) {
                    if ( hasNotifyKeyTriggered || notifyNext) {
                        updateWatermark(targetUid);

                        const allNextOrder = dependency.GetAllNextDependency(targetUid);
                        // allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                        allNextOrder.forEach((uid:number) => {
                            AllAffectedPaths[uid] = 1;
                        });
                    }
                    const currentPathNode = data.GetNodeByUid(targetUid);
                  

                    //  动态屏障判定 (本层有静态风险，或当前已有活跃的预言)
                    const targetLevel = uidToLevelMap.get(targetUid) ?? 0;
                    const isLevelBarrierActive =
                        volatileLevels.has(targetLevel) || currentEntangleArray.length > 0;

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

                            // hooks.emit( MeshFlowEventsName.NodeStagnate , { path: childPath, type: 2 });
                            SHARED_PAYLOAD.path = childPath;
                            SHARED_PAYLOAD.type = 2;
                            hooks.emit(MeshFlowEventsName.NodeStagnate,SHARED_PAYLOAD)
 
                            continue;
                        }

                        
                        // if (processed.has(childUid)) {
                        // if (processed[childUid] === 1) {
                        if(flagArray[childUid] & NodeStatus.PROCESSED) {
                            // hooks.emit( MeshFlowEventsName.NodeIntercept , { path: childPath, type: 2 });

                            SHARED_PAYLOAD.path = childPath;
                            SHARED_PAYLOAD.type = 2;
                            hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)

                            continue;
                        }
                        if (
                            // processingSet.has(childUid) || 
                            // processingSet[childUid]===1 || 
                            (flagArray[childUid] & NodeStatus.PROCESSING)||

                            // readyToRunBuffer.has(childUid)
                            (flagArray[childUid] & NodeStatus.READY) !== 0
                        ) {
                            // hooks.emit( MeshFlowEventsName.NodeIntercept , {
                            //     path: childPath,
                            //     // type: processingSet.has(childUid) ? 3 : 3.1,
                            //     // type: processingSet[childUid] ===1 ? 3 : 3.1,
                            //     type:(flagArray[childUid]&NodeStatus.PROCESSING) ? 3:3.1
                            // });

                            SHARED_PAYLOAD.path = childPath;
                            SHARED_PAYLOAD.type = (flagArray[childUid]&NodeStatus.PROCESSING) ? 3:3.1;
                            hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)

                            continue;
                        }
                         

                        // hasValueChanged
                        const shouldFire = hasNotifyKeyTriggered || notifyNext;

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

                                // if (!resureArea.has(level)) resureArea.set(level, new Set());
                                // const levelSet = resureArea.get(level)!;
                                // if (!levelSet.has(childUid)) {
                                //     levelSet.add(childUid);
                                //     hooks.emit( MeshFlowEventsName.NodeStagnate , { path: childPath, type: 1 });
                                // }
                                levelArray[childUid] = level;
                                if(!(flagArray[childUid] & NodeStatus.RESURE )){
                                    flagArray[childUid] |= NodeStatus.RESURE;
                                    resureQueue[resureCount++] = childUid;
                                    resureActiveCount++;
                                    // hooks.emit( MeshFlowEventsName.NodeStagnate , { path: childPath, type: 1 });
                                    SHARED_PAYLOAD.path = childPath;
                                    SHARED_PAYLOAD.type = 1;
                                    hooks.emit(MeshFlowEventsName.NodeStagnate,SHARED_PAYLOAD)
                                }
                            }
                        }
                    }

                    // 3.3 清理现场 & 尝试点火 (Flush Queue)
                    // processingSet.delete(targetUid);
                    // if(processingSet[targetUid]===1){
                    //    processingSet[targetUid] = 0; 
                    //    processingCount-- ;
                    // }
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

                            // hooks.emit(MeshFlowEventsName.FlowFire , {
                            //     path: targetPath,
                            //     type: 1,
                            //     detail: {
                            //         active: activenums,
                            //         pending: pendingnums,
                            //         // blocked: stagingArea.size,
                            //         blocked:blockednums
                            //     },
                            // });

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
                    // const node = data.GetNodeByPath(targetPath);
                     
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
                hooks.emit(MeshFlowEventsName.NodeError,SHARED_PAYLOAD)
            
                const abortToken = Symbol("abort");
                currentExecutionToken.set(triggerToken, abortToken);

                // 物理清空
                // readyToRunBuffer.clear();
                // stagingArea.clear();

                readyCount = 0;
                readyActiveCount = 0;
                
                stagingCount = 0;
                stagingActiveCount = 0;
                
                resureCount = 0;
                resureActiveCount = 0;
                flagArray.fill(0);

                // processingSet.clear();
                // processingSet.fill(0);

                processingCount = 0;
         
                // ghostBaton.clear();
                ghostBaton.fill(null);

                hooks.callOnError(err);

                // 错误发生后，依然要执行收尾（清理 processingSet 等）
            };
            // --- 5. 核心逻辑：处理单个桶的计算结果 ---
            // 这个函数囊括了原来循环体内的所有逻辑

            // 提取公共的处理结果逻辑
            const handleSingleResult = <K extends keyof NM>(
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
                    dirtyEntangleKeys.push(String(bucketName));
                    // hooks.emit( MeshFlowEventsName.NodeBucketSuccess , {
                    //     path: targetPath,
                    //     key: String(bucketName),
                    //     value: result,
                    //     calledBy: targetSchema.calledBy,
                    // });
                    SHARED_PAYLOAD.path = targetPath;
                    SHARED_PAYLOAD.key = bucketName,
                    SHARED_PAYLOAD.value = result;
                    SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
                    hooks.emit(MeshFlowEventsName.NodeBucketSuccess,SHARED_PAYLOAD)
        
                    if (targetSchema.notifyKeys.size===0 || targetSchema.notifyKeys.has(bucketName)) {
                        hasNotifyKeyTriggered = true;
                    }
                }

                const bucket = data.GetBucket(targetSchema.nodeBucket[bucketName]);
                if (bucket.isForceNotify()) notifyNext = true;

                if (hasNotifyKeyTriggered || notifyNext) {
                    updateWatermark(targetUid);
                }
            };

            // hooks.emit( MeshFlowEventsName.NodeStart , {
            //     path: targetPath,
            //     calledBy: targetSchema.calledBy,
            // });
            SHARED_PAYLOAD.path = targetPath;
            SHARED_PAYLOAD.calledBy = targetSchema.calledBy;
            hooks.emit(MeshFlowEventsName.NodeStart,SHARED_PAYLOAD)

            try {
                // --- 循环遍历开始 ---
                //副作用列表
                const effectsToRun: Array<{ fn: (args: any) => any; args: any[] }> = [];

                for (let bucketName in targetSchema.nodeBucket) {
                    const bucket = data.GetBucket(targetSchema.nodeBucket[bucketName]);

                    effectsToRun.push(...bucket.getSideEffect());

                    // 🛡️ 预言拦截：如果被量子纠缠唤醒，跳过自身推演逻辑！
                    if (isGhostly) {
                        hooks.emit(MeshFlowEventsName.NodeBucketSuccess , {
                            path: targetPath,
                            key: String(bucketName),
                            value: targetSchema.state[bucketName],
                            calledBy: targetSchema.calledBy,
                        });
                        if (bucket.isForceNotify()) notifyNext = true;
                        if ( targetSchema.notifyKeys.size === 0 || targetSchema.notifyKeys.has(bucketName)) {
                            updateWatermark(targetUid);
                        }
                        continue;
                    }
                    
                    // 1. 启动计算
                    const resultOrPromise = bucket.evaluate({
                        affectKey: bucketName,
                        triggerUid: currentTriggerUid,

                        getProxyByUid: (u: number) => data.GetNodeByUid(u).proxy,
                
                        getStateByUid: (u: number) => data.GetNodeByUid(u).state,
                        GetToken: () => curToken,
                    });

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
                        })
                        .catch(handleError);
                } else {
                    // -> 同步路径：极速穿透！
                    // 没有任何异步桶，直接收尾，无需微任务延迟
                    finalizeExecution(effectsToRun);
                    // 返回 void，这在 flushQueue 的 while 循环里意味着可以立即跑下一个
                    return;
                }
            } catch (err) {
                handleError(err);
            }
        };

        const flushQueue = async () => {
            // 1. 令牌检查 (安全熔断)
            
            if (currentExecutionToken.get(triggerToken) !== curToken) {
                isLooping = false;
                return;
            }

            isLooping = true;
            let isFirstFrame = timeScheduler.getIsFirstFrame();
            let yieldCount = 0;
            // 1. 定义名额决策函数
            const getNodeQuota = () => {
                // A. 如果是非贪婪模式，名额给无限（由水位线逻辑自己控制节奏）
                if (!isGreedy) return 30;

                // C. 普通贪婪模式，首帧严苛限流，后续稍微放开
                return isFirstFrame ? 30 : 30;
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
                    const isTimeExceeded = timeScheduler.shouldYield();

                    if (isQuotaExceeded || isTimeExceeded) {
                        // 只有在真的做过计算后，才申请更新 UI
                        if (nodesProcessedInFrame > 0) {
                            yieldCount++;
                            const shouldUpdateUI = isFirstFrame || yieldCount % 2 === 0;
                            if (shouldUpdateUI) {
                                uitrigger.requestUpdate();
                            }
                        }

                        await timeScheduler.yieldToMain();

                        // 醒来后检查令牌
                        if (currentExecutionToken.get(triggerToken) !== curToken) break;

                        // 🔥 关键：睡醒了，重置计数器，开始新的一帧
                        nodesProcessedInFrame = 0;

                        isFirstFrame = timeScheduler.getIsFirstFrame();
                    }

                    if (readyActiveCount > 0 && processingCount < MAX_CONCURRENT_TASKS) {
                        // 🌟 保持原样：快照发车前的长度
                        const originalReadyCount = readyCount;
                        let nextReadyCount = 0; 
                    
                        for (let i = 0; i < originalReadyCount; i++) {
                            const targetUid = readyQueue[i];
                            if ((flagArray[targetUid] & NodeStatus.READY) === 0) continue;
                    
                            // --- 核心修改点 1：名额满了或时间到了的“救火”搬运 ---
                            if (processingCount >= MAX_CONCURRENT_TASKS || nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME || timeScheduler.shouldYield()) {
                                
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
                                break; 
                            }
                    
                            const targetNode = data.GetNodeByUid(targetUid);
                            const targetPath = data.GetPathByUid(targetUid);
                            const targetLevel = uidToLevelMap.get(targetUid) ?? 0;
                            const staticParents = dependency.GetPrevDependency(targetUid);
                            const isMergeNode = staticParents.length > 1;
                            
                            // 🌟 保持原样：完全没动你的 shouldIntercept 变量
                            const shouldIntercept = (!isGreedy || isMergeNode) && targetLevel > currentLevel;
                    
                            if (shouldIntercept) {
                                flagArray[targetUid] &= ~NodeStatus.READY;
                                readyActiveCount--;
                    
                                const pendingParentsCount = staticParents.filter(
                                    // (uid) => AllAffectedPaths[uid] === 1 && processed[uid] === 0
                                    (uid) => AllAffectedPaths[uid] === 1 && (flagArray[uid] & NodeStatus.PROCESSED )===0
                                ).length;
                    
                                resistanceArray[targetUid] = pendingParentsCount || 0;
                                if (!(flagArray[targetUid] & NodeStatus.STAGING)) {
                                    flagArray[targetUid] |= NodeStatus.STAGING;
                                    stagingQueue[stagingCount++] = targetUid;
                                    stagingActiveCount++;
                                }
                    
                                // hooks.emit(MeshFlowEventsName.NodeIntercept, {
                                //     path: targetPath,
                                //     type: pendingParentsCount > 0 ? 4 : 5,
                                //     detail: { targetLevel, currentLevel, pendingParentsCount },
                                // });

                                SHARED_PAYLOAD.path = targetPath;
                                SHARED_PAYLOAD.type = pendingParentsCount > 0 ? 4 : 5;
                                SHARED_DETAIL.targetLevel = targetLevel;
                                SHARED_DETAIL.currentLevel = currentLevel;
                                SHARED_DETAIL.pendingParentsCount = pendingParentsCount;
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
                            
                            // hooks.emit(MeshFlowEventsName.NodeProcessing, {
                            //     path: targetPath,
                            //     calledBy: targetNode.calledBy,
                            // });
                            SHARED_PAYLOAD.path = targetPath;
                            SHARED_PAYLOAD.calledBy =  targetNode.calledBy;
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
                    
                        // --- 核心修改点 3：解除“熄火”的关键点 ---
                        // 🌟 必须放开这个 continue！只要还有人没跑，且发车位没满，就要立刻回到 while 顶部
                        if (readyActiveCount > 0 && processingCount < MAX_CONCURRENT_TASKS) {
                            continue;
                        }
                    }

                    // ==========================================================
                    // 阶段二：贪婪捞取 (Greedy Catch-up)
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
                        // const isFirstFrame = scheduler.getIsFirstFrame();
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
                                const staticParents = dependency.GetPrevDependency(uid);

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
                                    // hooks.emit(MeshFlowEventsName.NodeRelease , { path, type: 4 });
                                    SHARED_PAYLOAD.path = path;
                                    SHARED_PAYLOAD.type = 4;
                                    hooks.emit(MeshFlowEventsName.NodeRelease,SHARED_PAYLOAD)
                                    continue; // 捞起的不进 nextStagingCount
                                }
                                // 汇聚点守卫
                                // if (level > currentLevel && staticParents.length > 1) continue;

                                // stagingArea.delete(uid);
                                // readyToRunBuffer.add(uid);
                                // releasedCount++;
                                // foundGreedy = true;
                                // const path = data.GetPathByUid(uid)
                                // hooks.emit(MeshFlowEventsName.NodeRelease , { path, type: 4 });

                                // if (releasedCount >= NODE_QUOTA_PER_FRAME) break;
                            }
                            stagingQueue[nextStagingCount++] = uid;
                        }
                        stagingCount = nextStagingCount;

                        if (releasedCount > 0) continue;

                        if (foundGreedy) {
                            // 修复点：在 continue 之前，必须再次检查时间片！
                            // 如果已经超时，不能 continue 去跑新任务，必须 break 出去让位
                            if (timeScheduler.shouldYield()) {
                                await timeScheduler.yieldToMain();
                                if (currentExecutionToken.get(triggerToken) !== curToken) break;
                            }
                            continue;
                        }
                    }

                    // ==========================================================
                    // 阶段三：水位推进 (逻辑出口 A)
                    // ==========================================================
                    // if (processingSet.size === 0 && readyToRunBuffer.size === 0) {
                    // if (processingCount === 0 && readyToRunBuffer.size === 0) {
                    if (processingCount === 0 && readyActiveCount === 0) {    
                        // ==========================================================
                        // 量子纠缠处理：在水位提升前集中结算
                        // ==========================================================
                      // 🛑 核心屏障：如果天上还有纠缠任务在飞，拒绝结算！
                        if (turnstile.inFlightCount > 0) {
                            // 直接跳出 while 循环！
                            // 引擎会顺滑地进入下方的 finally 块，触发 waitType = 3，
                            // 然后启动 requestAnimationFrame(monitor) 挂起等待。
                            console.log('break')
                            break; 
                        }
                        if (currentEntangleArray.length > 0) {
                            let hasQuantumReversal = false;
                            let minReversalLevel = currentLevel;

                            // 去重
                            const uniqueHitTargetUids = Array.from(
                                new Set(currentEntangleArray)
                            );
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
                                    // ghostBaton.set(targetUid, changedByGhost);
                                    ghostBaton[targetUid] = changedByGhost;
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
                                    }

                                    // 获取最低影响水位
                                    const targetLevel = uidToLevelMap.get(targetNode.uid) ?? 0;
                                    if (targetLevel < minReversalLevel) {
                                        minReversalLevel = targetLevel;
                                    }

                                    updateWatermark(targetNode.uid);
                                    uitrigger.flushPathSet.add(targetNode.uid);
                                }
                            }

                            if (hasQuantumReversal) {
                                if (minReversalLevel < currentLevel) {
                                    currentLevel = minReversalLevel;
                                }
                                uitrigger.requestUpdate();

                                if(timeScheduler.shouldYield()){
                                    await timeScheduler.yieldToMain();
 
                                    if (currentExecutionToken.get(triggerToken) !== curToken) break;
                                }
                                

                                continue; // 有节点被唤醒，重新开始循环发车，绝不提升水位
                            }
                        }

                        // // 找出最小的待处理层级
                        // const pendingLevels = new Set<number>();
                        // for (const lvl of resureArea.keys()) pendingLevels.add(lvl);
                        // for (const [uid] of stagingArea) {
                        //     const lvl = uidToLevelMap.get(uid) ?? 0;
                        //     if (lvl > currentLevel) pendingLevels.add(lvl);
                        // }

                        // const sortedLevels = Array.from(pendingLevels).sort(
                        //     (a, b) => a - b
                        // );

                        // ==========================================================
                        // 极速优化：寻找最小的待处理层级 (Zero-Allocation 模式)
                        // ==========================================================
                        let nextLevel = Infinity; // 初始设为无限大

                        // 1. 从弱信号区 (resureArea) 找最低水位
                        // for (const lvl of resureArea.keys()) {
                        //     if (lvl < nextLevel) {
                        //         nextLevel = lvl;
                        //     }
                        // }
                        for (let i = 0; i < resureCount; i++) {
                            const uid = resureQueue[i];
                            if ((flagArray[uid] & NodeStatus.RESURE)) {
                                const lvl = levelArray[uid];
                                if (lvl < nextLevel) nextLevel = lvl;
                            }
                        }

                        // 2. 从强信号阻力区 (stagingArea) 找最低水位
                        // for (const [uid] of stagingArea) { // 如果你已经把 stagingArea 改成了纯数组/Set，这里对应修改即可
                        //     const lvl = uidToLevelMap.get(uid) ?? 0;
                        //     // 条件：只有大于当前水位的节点才是合法阻力，且比当前找到的 nextLevel 还要小
                        //     if (lvl > currentLevel && lvl < nextLevel) {
                        //         nextLevel = lvl;
                        //     }
                        // }
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
                            // const nextLevel = sortedLevels[0];
                            // if (nextLevel <= maxAffectedLevel) {
                                currentLevel = nextLevel;

                                // 捞弱信号
                                // const rescueNodes = resureArea.get(nextLevel);
                                // if (rescueNodes) {
                                //     rescueNodes.forEach((p) => readyToRunBuffer.add(p));
                                //     resureArea.delete(nextLevel);
                                // }
                                let nextResureCount = 0;
                                for (let i = 0; i < resureCount; i++) {
                                    const uid = resureQueue[i];
                                    // 如果节点依然有 RESURE 标记
                                    if (flagArray[uid] & NodeStatus.RESURE) {
                                        // 如果恰好是当前水位，捞走！
                                        if (levelArray[uid] === nextLevel) {
                                            flagArray[uid] &= ~NodeStatus.RESURE;
                                            resureActiveCount--;
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
                                // for (const [uid] of stagingArea) {
                                //     if ((uidToLevelMap.get(uid) ?? 0) === nextLevel) {
                                //         const path = data.GetPathByUid(uid);
                                //         stagingArea.delete(uid);
                                //         readyToRunBuffer.add(uid);
                                //         hooks.emit( MeshFlowEventsName.NodeRelease , {
                                //             path,
                                //             type: 3,
                                //             detail: { level: nextLevel },
                                //         });
                                //     }
                                // }
                                let nextStagingCount = 0;
                                for (let i = 0; i < stagingCount; i++) {
                                    const uid = stagingQueue[i];
                                    if (flagArray[uid] & NodeStatus.STAGING) {
                                        const nodeLevel = uidToLevelMap.get(uid) ?? 0;
                                        if (nodeLevel === nextLevel) {
                                            flagArray[uid] &= ~NodeStatus.STAGING;
                                            stagingActiveCount--;
                                            if (!(flagArray[uid] & NodeStatus.READY)) {
                                                flagArray[uid] |= NodeStatus.READY;
                                                readyQueue[readyCount++] = uid;
                                                readyActiveCount++;
                                            }
                                            const path = data.GetPathByUid(uid);
                                            // hooks.emit(MeshFlowEventsName.NodeRelease, { path, type: 3, detail: { level: nextLevel } });
                                            SHARED_PAYLOAD.path = path;
                                            SHARED_PAYLOAD.type = 3;
                                            SHARED_DETAIL.level = nextLevel;
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
                            // resureArea.forEach((set, level) => {
                            //     set.forEach((uid) => {
                            //         // processed.add(uid);
                            //         processed[uid] = 1;
                            //         const path = data.GetPathByUid(uid);
                            //         hooks.emit( MeshFlowEventsName.NodeIntercept , {
                            //             path: path,
                            //             type: 6,
                            //         });
                            //     });
                            // });
                            // resureArea.clear();
                            for (let i = 0; i < resureCount; i++) {
                                const uid = resureQueue[i];
                                if ((flagArray[uid] & NodeStatus.RESURE)) {
                                    // processed[uid] = 1;
                                    flagArray[uid] |= NodeStatus.PROCESSED
                                    const path = data.GetPathByUid(uid);
                                    // hooks.emit( MeshFlowEventsName.NodeIntercept , { path, type: 6 });
                                    SHARED_PAYLOAD.path = path;
                                    SHARED_PAYLOAD.type = 6;
                                    hooks.emit(MeshFlowEventsName.NodeIntercept,SHARED_PAYLOAD)
                                }
                            }
                            resureCount = 0; resureActiveCount = 0;

                            // 2. 清除所有强信号 (StagingArea)
                            // for (const [uid] of stagingArea) {
                            //     // processed.add(uid);
                            //     processed[uid] = 1;
                            //     const path = data.GetPathByUid(uid);
                            //     hooks.emit( MeshFlowEventsName.NodeIntercept , {
                            //         path: path,
                            //         type: 6,
                            //     });
                            // }
                            // stagingArea.clear();
                            for (let i = 0; i < stagingCount; i++) {
                                const uid = stagingQueue[i];
                                if ((flagArray[uid] & NodeStatus.STAGING)) {
                                    // processed[uid] = 1;
                                    flagArray[uid] |= NodeStatus.PROCESSED
                                    const path = data.GetPathByUid(uid);
                                    // hooks.emit( MeshFlowEventsName.NodeIntercept , { path, type: 6 });
                                    SHARED_PAYLOAD.path = path;
                                    SHARED_PAYLOAD.type = 6;
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

                uitrigger.requestUpdate();
 
                
                if (remaining === 0 && asyncRemaining === 0) {
                    if (
                        currentExecutionToken.get(triggerToken) === curToken &&
                        !isFlowFinished
                    ) {
                        
 
                      
                        isFlowFinished = true;
                        // hooks.emit( MeshFlowEventsName.FlowEnd , {
                        //     type: 1,
                        // });

                        SHARED_PAYLOAD.type = 1;
                        hooks.emit(MeshFlowEventsName.FlowEnd,SHARED_PAYLOAD)

                        // uitrigger.requestUpdate();
                        turnstile.resetCounters();
                        // ghostBaton.clear();
                        ghostBaton.fill(null);
                        
                        const endTime = performance.now();
                        quantumWatermark = -1;
                        currentExecutionToken.delete(triggerToken);
                        

                        // hooks.emit(  MeshFlowEventsName.FlowSuccess , {
                        //     token:curToken,
                        //     duration: (endTime - startTime).toFixed(2.1) + "ms",
                        // });
                        SHARED_PAYLOAD.token = curToken;
                        SHARED_PAYLOAD.duration = (endTime - startTime).toFixed(2.1) + "ms";
                        hooks.emit(MeshFlowEventsName.FlowSuccess,SHARED_PAYLOAD)

                        Promise.resolve().then(() => {
                             
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
                                // 1. 如果中途 21 号任务进来了，旧心跳立即物理终止，零浪费
                                if (globalLatestSessionToken !== curToken) return;
                                console.log('monitor',turnstile.inFlightCount)
                                // 2. 双重稳态检查：天上没幽灵 && 地上没未处理的新火种
                                if (turnstile.inFlightCount === 0 ) {
                                    // 账平了！重新调起主引擎收割，并在下一次 finally 中走向 Success
                                    nextMacroTick(()=>{
                                    
                                        if(turnstile.inFlightCount===0){
                                            flushQueue(); 
                                        }else{
                                            requestAnimationFrame(monitor); 
                                        }
                                    })
                                
                                } else {
                                    // 还没平？将下一次检查挂载到下一帧排队
                                    requestAnimationFrame(monitor); 
                                }
                            };
                            
                            // 启动帧循环监听
                            requestAnimationFrame(monitor);
                        }
                    }
                }
            }
        };

        flushQueue();
    };

    return {TaskRunner,CancelTask};
}

export { useMeshTask };
