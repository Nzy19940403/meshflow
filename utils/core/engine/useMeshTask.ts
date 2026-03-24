import { createScheduler, nextMacroTick } from "../utils/util";
import {
    MeshPath,
    MeshEmit,
    MeshFlowTaskNode,
    TriggerCause,
} from "../types/types";
import { SchemaBucket } from "./bucket";

function useMeshTask<P extends MeshPath, NM>(
    config: {
        useGreedy: boolean;
    },
    dependency: {
        GetAllNextDependency: (p: P) => P[];
        GetAllPrevDependency: (p: P) => P[];
        GetPrevDependency: (p: P) => P[];
        GetNextDependency: (p: P) => P[];
        GetDependencyOrder: () => P[][];
        GetPathToLevelMap: () => Map<P, number>;
    },
    data: {
        GetNodeByPath: (p: P) => MeshFlowTaskNode<P, any, NM>;
        GetBucket:(bucketId:number)=>SchemaBucket<P>
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
        flushPathSet: Set<P>;
    },
    timeScheduler: ReturnType<typeof createScheduler>
) {
    const currentExecutionToken: Map<P, symbol> = new Map();

    const isGreedy = config.useGreedy;

    // const scheduler = createScheduler();
    let globalLatestSessionToken: symbol | null = null;

   

    //运行调用入口
    const TaskRunner = async (triggerPath: P | null, initialNodes: P[]) => {
        //最大并发数
        const MAX_CONCURRENT_TASKS = 40;

        const curToken = Symbol("token");
        const triggerToken = triggerPath || ("__NOTIFY_ALL__" as unknown as P);
 
        currentExecutionToken.set(triggerToken, curToken);
        globalLatestSessionToken = curToken;

     
        
        let isLooping = false; // 状态锁：标志 while 循环是否在运行

        //scheduler重置
        timeScheduler.reset();

        // const changedPaths = new Set<P>() //所有产生变化的或者是设置notifyNext的路径
        const processed = new Set<P>();
        const processingSet = new Set<P>();
        const AllAffectedPaths = new Set<P>();
        // dependency.GetAllNextDependency(triggerPath)
        // AllAffectedPaths.add(triggerPath);

  
       

        initialNodes.forEach((node) => {
            AllAffectedPaths.add(node);
            dependency
                .GetAllNextDependency(node)
                .forEach((child) => AllAffectedPaths.add(child));
        });

        //等待执行区,直接上游发生变化了会把节点加入这里
        const stagingArea = new Map<P, number>();
        // 等待捕捞区,上游没有变但是不好直接扔所以把这个先扔在这里等待捕捞
        const resureArea = new Map<number, Set<P>>();

        // 🌟 幽灵接力棒：暂存 resolveGhosts 真正修改了哪些 Key，交给 executor 使用，用完即焚
        const ghostBaton = new Map<P, string[]>();

        // ==========================================================
        // 🌌 预言弹药库：只在阶段三集中引爆
        // ==========================================================
        const currentEntangleArray: P[] = [];
        const turnstile = data.Turnstile;



        // ==========================================================
        // 🌟 2. 捞取火种 
        // ==========================================================
        // if (turnstile && turnstile.consumeBatchHits) {
        //     const batchHits = turnstile.consumeBatchHits();
        //     // 直接推入纠缠数组，让引擎在第一次循环时就处理它们
        //     currentEntangleArray.push(...batchHits);
        // }
        // currentEntangleArray.forEach(path => {
        //     if (!AllAffectedPaths.has(path)) {
        //         AllAffectedPaths.add(path);
        //         dependency.GetAllNextDependency(path).forEach(child => AllAffectedPaths.add(child));
        //     }
        // });


        // 🌟 终极上帝开关：不仅要看 Turnstile 存不存在，还要看它里面有没有真实注册的高危层级！
        // 如果当前拓扑完全没有注册过 useEntangle，那么 volatileLevels.size 就是 0
        const IS_ENTANGLEMENT_ENABLED = turnstile.volatileLevels.size > 0;

        const hasObserver = IS_ENTANGLEMENT_ENABLED
            ? turnstile.hasObserver
            : () => false;
        const emitGhosts = IS_ENTANGLEMENT_ENABLED
            ? turnstile.receiveGhosts
            : () => [];
        const resolveGhosts = IS_ENTANGLEMENT_ENABLED
            ? turnstile.resolveGhosts
            : () => [];
        const getTriggerKeys = IS_ENTANGLEMENT_ENABLED
            ? turnstile.getTriggerKeys
            : () => [];
         
        // 🌟 核心优化：直接拿取在 useEntangle 注册时就计算好的高危层级
        const volatileLevels: Set<number> = turnstile?.volatileLevels || new Set();

        // 量子水位线（震荡天花板）
        let quantumWatermark = -1;

        // ==========================================================
        // 1. 基础水位线与队列准备
        // ==========================================================
        const readyToRunBuffer = new Set<P>();

        // 获取初始水位线（触发点所在层级）
        const pathToLevelMap = dependency.GetPathToLevelMap();

        // const triggerLevel = pathToLevelMap.get(triggerPath) ?? 0;
        let currentLevel = 0;
        let maxAffectedLevel = 0;
        const updateWatermark = (path: P) => {
            const descendants = dependency.GetAllNextDependency(path);
            descendants.forEach((p) => {
                const level = pathToLevelMap.get(p) || 0;
                if (level > maxAffectedLevel) {
                    maxAffectedLevel = level;
                }
            });
        };
        // ==========================================================
        // 🚀 阶段 0：源力探针 (Prime Mover Prophecy)
        // ==========================================================

        // // const nodesToCheck = triggerPath ? [triggerPath] : initialNodes;
        // const primeMovers = new Set<P>(); // 记录哪些是成功发射了预言的节点
        // // 🌟 修复点：无论是不是 triggerPath，首发阵容必须全部推高全局水位线
        // // 这样可以保护后续由 initialNodes 带起来的下游（如 Node 8）不被意外截杀
        // // if(IS_ENTANGLEMENT_ENABLED){
        // //     nodesToCheck.forEach((p) => updateWatermark(p));
        // // }


        // // 2. 🌟 只有明确的外部触发源 (triggerPath)，才有资格跳过排队，直接发射预言！
        // if (triggerPath) {
        //     if (hasObserver(triggerPath)) {
        //         const nodeObj = data.GetNodeByPath(triggerPath);
        //         const registeredKeys = getTriggerKeys(triggerPath);

        //         if (registeredKeys.length > 0) {
        //             let hitTargets = emitGhosts(nodeObj, registeredKeys);

        //             // 异步嗅探：如果 emitGhosts 返回了 Promise，就等它落地
        //             if (hitTargets instanceof Promise) {
        //                 hitTargets = await hitTargets;
        //             }

        //             if (hitTargets && hitTargets.length > 0) {
        //                 currentEntangleArray.push(...hitTargets);
        //                 quantumWatermark = Math.max(
        //                     quantumWatermark,
        //                     pathToLevelMap.get(triggerPath) || 0
        //                 );
        //                 uitrigger.flushPathSet.add(triggerPath as any);
        //             }
        //         }
        //     }

        //     // 因为 triggerPath 的值是外部改的，所以不需要引擎去算它了，直接算作“已处理”
        //     processed.add(triggerPath);
        //     primeMovers.add(triggerPath);

        //     hooks.emit("node:start", { path: triggerPath, calledBy: 0 });
        //     hooks.emit("node:success", { path: triggerPath, calledBy: 0 });
        // }

        // if (triggerPath) {
        //     currentLevel = pathToLevelMap.get(triggerPath) ?? 0;
        //     updateWatermark(triggerPath);
        //     processed.add(triggerPath);
        // } else {
        //     initialNodes.forEach((p) => updateWatermark(p));
        // }

        // // ==========================================================
        // // 组装发车队列 (只过滤掉刚才发射过预言的神明节点)
        // // ==========================================================
        // const isQuantumAwakenedAtStart = currentEntangleArray.length > 0;

        // initialNodes.forEach((p) => {
        //     if (!primeMovers.has(p)) {
        //         if (isQuantumAwakenedAtStart) {
        //             // 🛡️ 预言已出，凡人退避！直接送去挂起区，等待未来水位推进时再唤醒
        //             const level = pathToLevelMap.get(p) ?? 0;
        //             if (!resureArea.has(level)) resureArea.set(level, new Set());
        //             resureArea.get(level)!.add(p);

        //             // 补充一条日志，让你在控制台清楚地看到它是怎么在门口被按住的
        //             hooks.emit("node:stagnate", { path: p, type: 2 });
        //         } else {
        //             // 正常平行宇宙，准许进入发车队列
        //             readyToRunBuffer.add(p);
        //         }
        //     }
        // });

       // ==========================================================
        // 🚀 阶段 0：源力探针 (Prime Mover Prophecy)
        // ==========================================================

        const primeMovers = new Set<P>();

        // 1. 🌟 处理外部触发源 (God Node)
        if (triggerPath) {
            processed.add(triggerPath);
            primeMovers.add(triggerPath);
            updateWatermark(triggerPath);
            uitrigger.flushPathSet.add(triggerPath as any);
            // hooks.emit("node:start", { path: triggerPath, calledBy: 0 });
            // hooks.emit("node:success", { path: triggerPath, calledBy: 0 });
        }

        // 🌟 核心：seedsOfChaos 用于发射预言，它必须包含 triggerPath
        const seedsOfChaos = triggerPath ? [triggerPath] : initialNodes;

        if(timeScheduler.shouldYield()){
            uitrigger.requestUpdate();
            await timeScheduler.yieldToMain();
        }
        

        // 2. 🌟 并发嗅探：发射预言
        const prophecyPromises = seedsOfChaos.map(async (seed) => {
            
            if (hasObserver(seed)) {
                const nodeObj = data.GetNodeByPath(seed);
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
                const seedLevel = pathToLevelMap.get(seed) || 0;
                quantumWatermark = Math.max(quantumWatermark, seedLevel);
            }
        });

        
        if (currentEntangleArray.length > 0 || seedsOfChaos.length > 1) {
            uitrigger.requestUpdate();
            await timeScheduler.yieldToMain();
  
            if (currentExecutionToken.get(triggerToken) !== curToken) return;
        }

        // 3. 🚨 致命修复区：必须把正常的下游节点 (initialNodes) 送入队列！
        const isQuantumAwakenedAtStart = currentEntangleArray.length > 0;

        initialNodes.forEach((p) => {
            if (!primeMovers.has(p)) {
                if (isQuantumAwakenedAtStart) {
                    // 🛡️ 预言已出，正常节点先挂起，等水位推进
                    const level = pathToLevelMap.get(p) ?? 0;
                    if (!resureArea.has(level)) resureArea.set(level, new Set());
                    resureArea.get(level)!.add(p);
                    hooks.emit("node:stagnate", { path: p, type: 2 });
                } else {
                    // 正常宇宙，准许进入发车队列
                    readyToRunBuffer.add(p);
                    updateWatermark(p); // 确保它们推高水位线
                }
            }
        });

        // 4. 🌟 锁定起始推演水位
        if (triggerPath) {
            currentLevel = pathToLevelMap.get(triggerPath) ?? 0;
        } else {
            currentLevel = Math.min(...initialNodes.map(p => pathToLevelMap.get(p) ?? 0));
        }

        const startTime = performance.now();
        hooks.emit("flow:start", { path: triggerToken , token:curToken });

        //调用开始钩子
        hooks.callOnStart({
            path: triggerToken,
        });

        let isFlowFinished = false;

        //背压参数
        const BACKPRESSURE_LIMIT = 30;

        const executorNodeCalculate = (task: { target: P; trigger: P | null }) => {
            const { target: targetPath, trigger: currentTriggerPath } = task;
        
            let hasValueChanged = false;  // 仅负责：决定是否触发 uitrigger.flushPathSet
            let hasNotifyKeyTriggered = false; // 🌟 负责：判断是否推高水位和通知下游

            let notifyNext = false;

            const targetSchema = data.GetNodeByPath(targetPath);

            // 记录进入时的状态，用于在纠缠震荡状态时传播给下游
            const originalCause = targetSchema.calledBy as unknown as TriggerCause;

            // 🌟 性能核心：这是本节点生命周期内唯一的“脏位收集器”
            const dirtyEntangleKeys: string[] = [];

            // 收集所有的异步 Promise
            const pendingPromises: Promise<void>[] = [];

            // ==========================================================
            // 🛡️ 幽灵装甲 (Ghost Armor)
            // ==========================================================
            let isGhostly = false;
            
            if (targetSchema.calledBy === TriggerCause.INVERSION) {
                isGhostly = true;
                // targetSchema.calledBy = 0 ; // 卸下装甲，归还自由身，上面以及记录了这个节点是怎么被复活的，所以现在calledBy没有继续以1存在的必要
                hasValueChanged = true; // 强制宣告变更，保证触发下游
                uitrigger.flushPathSet.add(targetPath as any);

                // 🌟 提取接力棒：把刚才 resolveGhosts 修改的 Key 拿过来！
                const incomingEntangleKeys = ghostBaton.get(targetPath);
                if (incomingEntangleKeys) {
                    dirtyEntangleKeys.push(...incomingEntangleKeys);
                    ghostBaton.delete(targetPath); // 物理清空，释放内存
                }
            }

            // 这个函数只负责：减阻力 -> 判断归零 -> 入队
            //reasontype -> 1:上游 ${targetPath} 值变了 2: 当上游值没有变但是下游节点已经在stagingArea的时候`上游 ${targetPath} 完成(穿透)`
            const tryActivateChild = (child: P, reasonType: number) => {
                // if((targetPath as any).includes('Renew2')){
                //     debugger
                // }
                const childLevel = pathToLevelMap.get(child) ?? 0;

                // 🌟 核心判断：当前这个子节点，是不是处于“震荡辐射区”？
                const isInRepercussionZone =
                    (originalCause === TriggerCause.INVERSION ||
                        originalCause === TriggerCause.REPERCUSSION) 
                        && childLevel <= quantumWatermark;

                // 💥 行为 1：复活老兵（只针对在 processed 里的节点）
                if (isInRepercussionZone && processed.has(child)) {
                    processed.delete(child); // 抹除本轮 Flow 的记忆
                 
                    // 🚨 注意：这里不要写 childNode.calledBy = 2！我们统一在入队的时候发工牌！
                    hooks.emit("node:revive", { path: child, triggerPath: targetPath });
                }

                let newResistance = 0;
                // 1. 如果已经处理过或正在处理，直接忽略
                if (
                    processed.has(child) ||
                    processingSet.has(child) ||
                    readyToRunBuffer.has(child)
                ) {
                    // 这里可以 emit 一个 intercept，但对于性能优化可以省略
                    return;
                }

                // 2. 阻力计算策略：惰性初始化 vs 递减
                if (!stagingArea.has(child)) {
                    if (
                        childLevel > currentLevel &&
                        stagingArea.size > BACKPRESSURE_LIMIT
                    ) {
                        if (!resureArea.has(childLevel))
                            resureArea.set(childLevel, new Set());
                        resureArea.get(childLevel)!.add(child);

                        hooks.emit("node:intercept", {
                            path: child,
                            type: 7, // 自定义类型：背压拦截
                            // detail: { stagingSize: stagingArea.size }
                        });
                        return;
                    }
                    // 🌟 Case A: 第一次被触碰 (Lazy Init)
                    // 我们不查 AllAffectedPaths，我们查“还有几个爸爸没死？”
                    const parents = dependency.GetPrevDependency(child);

                    let pendingCount = 0;
                    for (const p of parents) {
                        // 如果爸爸已经在已完成名单里，它就不是阻力
                        if (processed.has(p)) continue;

                        const pLevel = pathToLevelMap.get(p) ?? 0;

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
                    // 🌟 Case B: 之前已经进过暂存区，直接递减
                    const currentResistance = stagingArea.get(child)!;
                    newResistance = currentResistance - 1;
                }

                if (newResistance <= 0) {
                    // 检查忙碌状态
                    const isAlreadyInReadyBuffer = readyToRunBuffer.has(child);
                    const isAlreadyRunning = processingSet.has(child);
                    // const isAlreadyInQueue = queueCountMap.has(child);
                    // const isAlreadyRunning = processingSet.has(child);

                    if (isAlreadyInReadyBuffer || isAlreadyRunning) {
                        
                        hooks.emit("node:intercept", {
                            path: child,
                            // reason: `节点 ${child} 正忙 (Q:${isAlreadyInQueue}, R:${isAlreadyRunning})`,
                            type: isAlreadyRunning ? 3 : 3.1,
                        });
                        return;
                    }

                    // 入队操作
                    stagingArea.delete(child);

                    // 🌟 修正：正常拓扑逻辑激活，赋予 0 的标记
                    const childNode = data.GetNodeByPath(child);

                    // 💥 行为 2：颁发工牌（动能传承，针对所有准备入队的节点）
                    if (isInRepercussionZone) {
                        childNode.calledBy = TriggerCause.REPERCUSSION; // 新老兵都带电！
                    } else {
                        childNode.calledBy = TriggerCause.CAUSALITY; // 正常流恢复 0
                        // if (childNode.calledBy !== TriggerCause.REPERCUSSION) {
                        //     childNode.calledBy = TriggerCause.CAUSALITY; // 正常流恢复 0
                        // }
                    }

                    //加入准备跑的集合,用来做batch
                    readyToRunBuffer.add(child);

                    hooks.emit("node:release", {
                        path: child,
                        type: reasonType,
                        detail: { path: targetPath },
                    });
                } else {
                    // 更新阻力
                    stagingArea.set(child, newResistance);
                    // 注意：这里不用 emit pending，因为只有首次加入时才 emit
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
                            // 🌟 精准记录副作用导致的属性变动
                            if (!Object.is(targetSchema.state[key], result[key])) {
                                targetSchema.state[key] = result[key];
                                dirtyEntangleKeys.push(key); 
                                hasValueChanged = true;

                                // 🌟 新增：副作用里的 key 也受 notifyKeys 检查！
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

                if (hasValueChanged) uitrigger.flushPathSet.add(targetPath as any);

                const finishPropagation = (hitTargets: P[] = []) => {
                    if (currentExecutionToken.get(triggerToken) !== curToken) return;
                     
                    if (hitTargets && hitTargets.length > 0) {
                        currentEntangleArray.push(...hitTargets);
                        quantumWatermark = Math.max(
                            quantumWatermark,
                            pathToLevelMap.get(targetPath) || 0
                        );
                    }

                    // 🗑️ 清理脏位回收池，避免影响下次使用
                    dirtyEntangleKeys.length = 0;
                    hooks.emit("node:success", {
                        path: targetPath,
                        calledBy: targetSchema.calledBy,
                    });
                    processed.add(targetPath);

                    const directChildren = dependency.GetNextDependency(targetPath);

                    // 3.1 扩充疆域 (AllAffectedPaths)
                    // if ( hasValueChanged || notifyNext) {
                    if ( hasNotifyKeyTriggered || notifyNext) {
                        updateWatermark(targetPath);

                        const allNextOrder = dependency.GetAllNextDependency(targetPath);
                        allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                    }
                    const currentPathNode = data.GetNodeByPath(targetPath);
                    // const isRepercussion = currentPathNode.calledBy !== 0;

                    //  动态屏障判定 (本层有静态风险，或当前已有活跃的预言)
                    const targetLevel = pathToLevelMap.get(targetPath) ?? 0;
                    const isLevelBarrierActive =
                        volatileLevels.has(targetLevel) || currentEntangleArray.length > 0;

                    // 3.2 激活下游 (Try Activate Children)
                    for (const child of directChildren) {
                        const childLevel = pathToLevelMap.get(child) ?? 0;

                        // 🛡️ 屏障拦截：本层有预言风险且孩子是下游，则绝对禁止穿透，直接强制挂起为平民
                        if (isLevelBarrierActive && childLevel >= targetLevel) {
                            if (!resureArea.has(childLevel))
                                resureArea.set(childLevel, new Set());
                            resureArea.get(childLevel)!.add(child);
                            hooks.emit("node:stagnate", { path: child, type: 2 });

                            // 👇👇👇 必须加在这里！在 continue 之前，给挂起区的节点发复活工牌！ 👇👇👇
                            // if (isRepercussion) {
                            //     const childNode = data.GetNodeByPath(child);
                            //     childNode.calledBy = TriggerCause.REPERCUSSION;  
                            //     processed.delete(child);
                            // }

                            continue;
                        }

                        // if (!isRepercussion) {
                            if (processed.has(child)) {
                                hooks.emit("node:intercept", { path: child, type: 2 });
                                continue;
                            }
                            if (processingSet.has(child) || readyToRunBuffer.has(child)) {
                                hooks.emit("node:intercept", {
                                    path: child,
                                    type: processingSet.has(child) ? 3 : 3.1,
                                });
                                continue;
                            }
                        // }

                        // hasValueChanged
                        const shouldFire = hasNotifyKeyTriggered || notifyNext;

                        if (shouldFire) {
                            // 强影响逻辑

                            tryActivateChild(child, 1);
                        } else {
                            // 弱影响逻辑
                            if (stagingArea.has(child)) {
                                tryActivateChild(child, 2);
                            } else {
                                // 原地待命逻辑
                                const level = pathToLevelMap.get(child)!;
                                if (!resureArea.has(level)) resureArea.set(level, new Set());
                                const levelSet = resureArea.get(level)!;
                                if (!levelSet.has(child)) {
                                    levelSet.add(child);
                                    hooks.emit("node:stagnate", { path: child, type: 1 });
                                }
                            }
                        }
                    }

                    // 3.3 清理现场 & 尝试点火 (Flush Queue)
                    processingSet.delete(targetPath);

                    currentPathNode.calledBy = TriggerCause.CAUSALITY;

                    // --- 4. 调度逻辑与 UI 点火 (嵌入在这里) ---
                    const scheduleNext =  () => {
                        // 4.3 重启引擎 (Flush Queue)
                        if (!isLooping) {
                            isLooping = true;
                            const activenums = processingSet.size;
                            const pendingnums = readyToRunBuffer.size;

                            hooks.emit("flow:fire", {
                                path: targetPath,
                                type: 1,
                                detail: {
                                    active: activenums,
                                    pending: pendingnums,
                                    blocked: stagingArea.size,
                                },
                            });

                            flushQueue();
                        }
                    };

                    // 执行调度
                    // 如果上面没有 await (即没有切片)，这里是同步执行的
                    scheduleNext();
                };

                // ==========================================================
                // 🌟 修改点：支持异步嗅探的 emit
                // ==========================================================
               
                if (hasObserver(targetPath) && dirtyEntangleKeys.length > 0) {
                    const node = data.GetNodeByPath(targetPath);
                     
                    const hitTargetsOrPromise = emitGhosts(node, dirtyEntangleKeys);
                     
                    // 判断是否为 Promise
                    if (
                        hitTargetsOrPromise instanceof Promise ||
                        (hitTargetsOrPromise &&
                            typeof hitTargetsOrPromise.then === "function")
                    ) {
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
                
                hooks.emit("node:error", { path: targetPath, error: err });
            
                const abortToken = Symbol("abort");
                currentExecutionToken.set(triggerToken, abortToken);

                // 物理清空
                readyToRunBuffer.clear();
                stagingArea.clear();
                processingSet.clear();
         
                ghostBaton.clear();

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
                    // 🌟 精准记录桶产生的属性变动
                    dirtyEntangleKeys.push(String(bucketName));
                    hooks.emit("node:bucket:success", {
                        path: targetPath,
                        key: String(bucketName),
                        value: result,
                        calledBy: targetSchema.calledBy,
                    });
        
                    if (targetSchema.notifyKeys.size===0 || targetSchema.notifyKeys.has(bucketName)) {
                        hasNotifyKeyTriggered = true;
                    }
                }

                const bucket = data.GetBucket(targetSchema.nodeBucket[bucketName]);
                if (bucket.isForceNotify()) notifyNext = true;

                if (hasNotifyKeyTriggered || notifyNext) {
                    updateWatermark(targetPath);
                }
            };

            hooks.emit("node:start", {
                path: targetPath,
                calledBy: targetSchema.calledBy,
            });

            try {
                // --- 循环遍历开始 ---
                //副作用列表
                const effectsToRun: Array<{ fn: (args: any) => any; args: any[] }> = [];

                for (let bucketName in targetSchema.nodeBucket) {
                    const bucket = data.GetBucket(targetSchema.nodeBucket[bucketName]);

                    effectsToRun.push(...bucket.getSideEffect());

                    // 🛡️ 预言拦截：如果被量子纠缠唤醒，跳过自身推演逻辑！
                    if (isGhostly) {
                        hooks.emit("node:bucket:success", {
                            path: targetPath,
                            key: String(bucketName),
                            value: targetSchema.state[bucketName],
                            calledBy: targetSchema.calledBy,
                        });
                        if (bucket.isForceNotify()) notifyNext = true;
                        if ( targetSchema.notifyKeys.size === 0 || targetSchema.notifyKeys.has(bucketName)) {
                            updateWatermark(targetPath);
                        }
                        continue;
                    }
                    
                    // 1. 启动计算
                    const resultOrPromise = bucket.evaluate({
                        affectKey: bucketName,
                        triggerPath: currentTriggerPath,

                        GetRenderSchemaByPath: (p: P) => data.GetNodeByPath(p).proxy,
                        // GetValueByPath: (p: P) => data.GetNodeByPath(p).state,
                        getStateByPath: (p: P) => data.GetNodeByPath(p).state,
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
                if (!isGreedy) return Infinity;

                // C. 普通贪婪模式，首帧严苛限流，后续稍微放开
                return isFirstFrame ? 30 : Infinity;
            };

            // 🔥 新增：帧内计数器
            let nodesProcessedInFrame = 0;
            // 🔥 新增：硬指标，一帧最多只算 10 个 (你可以根据实际测试调整为 20 或 50)
            const NODE_QUOTA_PER_FRAME = getNodeQuota();

            try {
                while (true) {
                    // 🛑 令牌检查
                    if (currentExecutionToken.get(triggerToken) !== curToken) break;
                 
                    // ==========================================================
                    // 🔥 修改点 1：双重检查 (时间到了 OR 数量够了 -> 都要休息)
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

                    if (
                        readyToRunBuffer.size > 0 &&
                        processingSet.size < MAX_CONCURRENT_TASKS
                    ) {
                        // 💡 关键：使用 for...of 遍历 Set 实现批量同步分发
                        for (const targetPath of readyToRunBuffer) {
                            if (processingSet.size >= MAX_CONCURRENT_TASKS) break;

                            // 🔥 修改点 2：在发车前，先看这一帧的名额用完没
                            if (nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME) {
                                break; // 名额满了，跳出 for 循环，回到 while 顶部去 yield
                            }

                            const targetLevel = pathToLevelMap.get(targetPath) ?? 0;
                            const staticParents = dependency.GetPrevDependency(targetPath);
                            const isMergeNode = staticParents.length > 1;
                            const shouldIntercept =
                                (!isGreedy || isMergeNode) && targetLevel > currentLevel;

                            // 🛑 水位/汇聚点拦截
                            if (shouldIntercept) {
                                readyToRunBuffer.delete(targetPath);

                                const pendingParentsCount = staticParents.filter(
                                    (p) => AllAffectedPaths.has(p) && !processed.has(p)
                                ).length;

                                stagingArea.set(targetPath, pendingParentsCount || 0);
                                hooks.emit("node:intercept", {
                                    path: targetPath,
                                    type: pendingParentsCount > 0 ? 4 : 5,
                                    detail: { targetLevel, currentLevel, pendingParentsCount },
                                });
                                continue;
                            }

                            // ✅ 通过安检，准备发车
                            readyToRunBuffer.delete(targetPath);
                            processingSet.add(targetPath);
                            const targetNode = data.GetNodeByPath(targetPath);
                            hooks.emit("node:processing", {
                                path: targetPath,
                                calledBy: targetNode.calledBy,
                            });
                            
                            // 🔥 核心优化：同步调用，不 await！
                            // 这会让循环立刻进入下一个，瞬间填满 20 个并发位
                            executorNodeCalculate({
                                target: targetPath,
                                trigger: triggerPath,
                                // isReleased: true
                            });

                            // 🔥 修改点 3：增加计数
                            nodesProcessedInFrame++;

                            // 🔥 修改点 4：微操检查
                            // 如果刚算完这个，发现名额满了或者时间到了，立刻停
                            if (
                                nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME ||
                                timeScheduler.shouldYield()
                            ) {
                                break;
                            }
                        }

                        // 如果是因为名额满了 break 出来的，这里 continue 回到顶部去 yield
                        // if (nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME || scheduler.shouldYield()) {
                        //     continue;
                        // }
                        // 如果发了一波车后 buffer 还有货，或者是被 yield 打断的，
                        // continue 回到顶部再次检查 yield，而不是直接进贪婪捕捞
                        if (readyToRunBuffer.size > 0) continue;
                    }

                    // ==========================================================
                    // 阶段二：贪婪捞取 (Greedy Catch-up)
                    // ==========================================================
                    if (
                        nodesProcessedInFrame < NODE_QUOTA_PER_FRAME &&
                        isGreedy &&
                        stagingArea.size > 0 &&
                        processingSet.size < MAX_CONCURRENT_TASKS
                    ) {
                        let foundGreedy = false;
                        let releasedCount = 0;
                        // const isFirstFrame = scheduler.getIsFirstFrame();
                        // const releaseQuota = isFirstFrame ? 5 : 15;

                        for (const [path, resistance] of stagingArea) {
                            if (resistance <= 0) {
                                const level = pathToLevelMap.get(path) ?? 0;
                                const staticParents = dependency.GetPrevDependency(path);

                                // 汇聚点守卫
                                if (level > currentLevel && staticParents.length > 1) continue;

                                stagingArea.delete(path);
                                readyToRunBuffer.add(path);
                                releasedCount++;
                                foundGreedy = true;
                                hooks.emit("node:release", { path, type: 4 });

                                if (releasedCount >= NODE_QUOTA_PER_FRAME) break;
                            }
                        }
                        if (releasedCount > 0) continue;

                        if (foundGreedy) {
                            // 🚨 修复点：在 continue 之前，必须再次检查时间片！
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
                    if (processingSet.size === 0 && readyToRunBuffer.size === 0) {
                        // ==========================================================
                        // 🌌 量子纠缠处理：在水位提升前集中结算
                        // ==========================================================
                      
                        if (currentEntangleArray.length > 0) {
                            let hasQuantumReversal = false;
                            let minReversalLevel = currentLevel;

                            // 去重
                            const uniqueHitTargets = Array.from(
                                new Set(currentEntangleArray)
                            );
                            currentEntangleArray.length = 0;   
                            
                            for (const targetPath of uniqueHitTargets) {
                                const targetNode = data.GetNodeByPath(targetPath);

                                //  resolveGhosts 现返回被修改的具体 Key 数组
                                const changedByGhost = resolveGhosts(targetNode);
                            
                                if (changedByGhost && changedByGhost.length > 0) {
                                    hasQuantumReversal = true;

                                    // 🌟 核心标记：打上量子唤醒烙印
                                    targetNode.calledBy = TriggerCause.INVERSION;

                                    // 必须把坍缩修改的 key 塞进接力棒，等它进入 executor 时才能拿出来！
                                    ghostBaton.set(targetPath, changedByGhost);
                                    //  只抹除目标节点自己的记忆！
                                    // 绝对不要去扫荡 GetAllNextDependency！把唤醒下游的任务交给 calledBy 动能传导！
                                    processed.delete(targetPath);

                                    // 从暂存区拉回起跑线
                                    stagingArea.delete(targetPath);
                                    readyToRunBuffer.add(targetPath);
                                     

                                    // 获取最低影响水位
                                    const targetLevel = pathToLevelMap.get(targetPath) ?? 0;
                                    if (targetLevel < minReversalLevel) {
                                        minReversalLevel = targetLevel;
                                    }

                                    updateWatermark(targetPath);
                                    uitrigger.flushPathSet.add(targetPath);
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

                        // 找出最小的待处理层级
                        const pendingLevels = new Set<number>();
                        for (const lvl of resureArea.keys()) pendingLevels.add(lvl);
                        for (const [path] of stagingArea) {
                            const lvl = pathToLevelMap.get(path) ?? 0;
                            if (lvl > currentLevel) pendingLevels.add(lvl);
                        }

                        const sortedLevels = Array.from(pendingLevels).sort(
                            (a, b) => a - b
                        );

                        const nextLevel = sortedLevels[0];

                        if (sortedLevels.length > 0 && nextLevel <= maxAffectedLevel) {
                            const nextLevel = sortedLevels[0];
                            if (nextLevel <= maxAffectedLevel) {
                                currentLevel = nextLevel;

                                // 捞弱信号
                                const rescueNodes = resureArea.get(nextLevel);
                                if (rescueNodes) {
                                    rescueNodes.forEach((p) => readyToRunBuffer.add(p));
                                    resureArea.delete(nextLevel);
                                }

                                // 捞被水位拦截的强信号
                                for (const [path] of stagingArea) {
                                    if ((pathToLevelMap.get(path) ?? 0) === nextLevel) {
                                        stagingArea.delete(path);
                                        readyToRunBuffer.add(path);
                                        hooks.emit("node:release", {
                                            path,
                                            type: 3,
                                            detail: { level: nextLevel },
                                        });
                                    }
                                }
                                continue; // 推进水位后，重新循环发车
                            }
                        } else {
                            resureArea.forEach((set, level) => {
                                set.forEach((p) => {
                                    processed.add(p);
                                    hooks.emit("node:intercept", {
                                        path: p,
                                        type: 6,
                                    });
                                });
                            });
                            resureArea.clear();

                            // 2. 清除所有强信号 (StagingArea)
                            for (const [path] of stagingArea) {
                                processed.add(path);
                                hooks.emit("node:intercept", {
                                    path: path,
                                    type: 6,
                                });
                            }
                            stagingArea.clear();

                            // 3. 彻底退出 while 循环，进入 finally 结算 flow:success
                            break;
                        }
                    }

                    // ==========================================================
                    // 阶段四：判定是否进入物理等待 (逻辑出口 B)
                    // ==========================================================
                    if (
                        readyToRunBuffer.size > 0 &&
                        processingSet.size >= MAX_CONCURRENT_TASKS
                    ) {
                        // 这种情况叫“并发限制等待”
                        hooks.emit("flow:wait", {
                            type: 2,
                        });
                    }

                    // 实在没活了，或者正在等异步任务返回
                    break;
                }
            } finally {
                isLooping = false;
                // 最终结算检查
                const remaining =
                    processingSet.size + stagingArea.size + readyToRunBuffer.size;
                // 🌟 从 Turnstile 获取当前是否有正在飞行的异步纠缠
                const asyncRemaining = turnstile.inFlightCount || 0;

                const isGlobalValid = globalLatestSessionToken === curToken;
                
           
                // 👇👇👇 核心修复：死前必须发送遗言 👇👇👇
                if (!isGlobalValid) {
                    // 告诉 Logger：“我被挤掉了，把我的 token 销毁吧，别等我了”
                    hooks.emit("flow:abort", { token: curToken });
                    return;
                }

                uitrigger.requestUpdate();
 
                
                if (remaining === 0 && asyncRemaining === 0) {
                    if (
                        currentExecutionToken.get(triggerToken) === curToken &&
                        !isFlowFinished
                    ) {
                        
 
                      
                        isFlowFinished = true;
                        hooks.emit("flow:end", {
                            type: 1,
                        });
                        // uitrigger.requestUpdate();
                        turnstile.resetCounters();
                        ghostBaton.clear();
                        
                        const endTime = performance.now();
                        quantumWatermark = -1;
                        currentExecutionToken.delete(triggerToken);
                        

                        hooks.emit("flow:success", {
                            token:curToken,
                            duration: (endTime - startTime).toFixed(2.1) + "ms",
                        });
                        

                        Promise.resolve().then(() => {
                             
                            hooks.callOnSuccess();
                        });
                    } 
                } else {
                    const waitType = remaining === 0 && asyncRemaining > 0 ? 3 : 1;
                   
                    hooks.emit("flow:wait", {
                        type: waitType,
                        detail: {
                            nums: processingSet.size,
                            asyncNums: asyncRemaining, // 把纠缠数传给 logger
                        },
                    });
                    if(asyncRemaining>0){

                 

                        const monitor = () => {
                            // 1. 如果中途 21 号任务进来了，旧心跳立即物理终止，零浪费
                            if (globalLatestSessionToken !== curToken) return;
        
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
        };

        flushQueue();
    };

    return TaskRunner;
}

export { useMeshTask };
