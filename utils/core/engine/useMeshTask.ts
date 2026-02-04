import { MeshEmit } from "../plugins/usePlugin";
import { SchemaBucket } from "./bucket";

function useMeshTask<T extends string>(
    dependency: {
        GetAllNextDependency: (p: T) => T[],
        GetAllPrevDependency: (p: T) => T[],
        GetPrevDependency: (p: T) => T[],
        GetNextDependency: (p: T) => T[],
        GetDependencyOrder: () => T[][],
        GetPathToLevelMap: () => Map<T, number>
    },
    data: {
        GetRenderSchemaByPath: (p: T) => any
    },
    hooks:{
        callOnError:any,
        callOnSuccess:any,
        callOnStart:any,
        emit:MeshEmit
    },
    trigger: {
        requestUpdate: () => void,
        flushPathSet: Set<T>
    }
) {
    const currentExecutionToken: Map<T, symbol> = new Map();

 
    //运行调用入口
    const TaskRunner = (
        triggerPath: T,
        initialNodes: T[]
    ) => {
        //最大并发数
        const MAX_CONCURRENT_TASKS = 20;


        const curToken = Symbol("token");

        currentExecutionToken.set(triggerPath, curToken);

        let isLooping = false; // 状态锁：标志 while 循环是否在运行

        // const changedPaths = new Set<T>() //所有产生变化的或者是设置notifyNext的路径
        const processed = new Set<T>();
        const processingSet = new Set<T>();
        const AllAffectedPaths = new Set<T>(
            dependency.GetAllNextDependency(triggerPath)
        );
        AllAffectedPaths.add(triggerPath);
        // changedPaths.add(triggerPath);

        const queueCountMap = new Map<T, number>();
        //悲观队列，如果一个path的直接上游并没有被纳入计算但是这个path本身已经被影响，之前是乐观的直接计算，但是由于镜像依赖问题，
        //导致计算会拿到过期的数据，新数据更新之后没法继续更新了，所以加入悲观队列先挂起，最后再入队
        // 💡打算改造 悲观区：存储 path -> 剩余阻力值 (pendingParentsCount)
        const stagingArea = new Map<T, number>();

        const resureArea = new Map<number,Set<T>>();

        let lastYieldTime = performance.now();

 
        // 获取初始水位线（触发点所在层级）
        const pathToLevelMap = dependency.GetPathToLevelMap();
        const triggerLevel = pathToLevelMap.get(triggerPath) ?? 0;
        let currentLevel = triggerLevel;
        let maxAffectedLevel = 0;
        const updateWatermark = (path: T) => {
            const descendants = dependency.GetAllNextDependency(path);
            descendants.forEach(p => {
                const level = pathToLevelMap.get(p) || 0;
                if (level > maxAffectedLevel) {
                    maxAffectedLevel = level;
                }
            });
        };
        updateWatermark(triggerPath);

        // AllAffectedPaths.forEach(path => {
        //     if (path === triggerPath) return;
        //     if (initialNodes.includes(path)) return;

        //     const directParents = dependency.GetPrevDependency(path);
        //     const effectParentsCount = directParents.filter(p => AllAffectedPaths.has(p)).length;
        //     if (effectParentsCount > 0) {
        //         stagingArea.set(path, effectParentsCount);
        //     }
        // })
        processed.add(triggerPath);
        
        // AllAffectedPaths.forEach(path => {
        //     maxAffectedLevel = Math.max(maxAffectedLevel, pathToLevelMap.get(path) || 0);
        // });

        const queue: Array<{
            target: T;
            trigger: T;
            isReleased: boolean;
        }> = Array.from(initialNodes).map((p) => {
            queueCountMap.set(p, (queueCountMap.get(p) || 0) + 1); // 记账
            return {
                target: p,
                trigger: triggerPath,
                isReleased: false,
            };
        });
        // trace.pushExecution([...Array.from(initialNodes), triggerPath], true);
        const startTime = performance.now();
        hooks.emit('flow:start',{path:triggerPath})
        // 打印任务启动
        // console.log(
        //     `%c 🚀 任务启动 | Trigger: ${triggerPath} | Token: ${curToken.description}`,
        //     "color: #67c23a; font-weight: bold;"
        // );
        //调用开始钩子
        hooks.callOnStart({
            path:triggerPath,
        });

    

        const executorNodeCalculate = async (task: { target: T; trigger: T; isReleased: boolean; }) => {
 
            // 这个函数只负责：减阻力 -> 判断归零 -> 入队
            //reasontype -> 1:上游 ${targetPath} 值变了 2:`上游 ${targetPath} 完成(穿透)`
            const tryActivateChild = (child: T, reasonType: number) => {
                const currentResistance = stagingArea.get(child) ?? 0;
                const newResistance = Math.max(0, currentResistance - 1);

                if (newResistance <= 0) {
                    // 检查忙碌状态
                    const isAlreadyInQueue = queueCountMap.has(child);
                    const isAlreadyRunning = processingSet.has(child);

                    if (isAlreadyInQueue || isAlreadyRunning) {
                        hooks.emit('node:intercept', { 
                            path: child, 
                            // reason: `节点 ${child} 正忙 (Q:${isAlreadyInQueue}, R:${isAlreadyRunning})`, 
                            type: 3 
                        });
                        return;
                    }

                    // 入队操作
                    stagingArea.delete(child);
                    queue.push({ target: child, trigger: targetPath, isReleased: true });
                    queueCountMap.set(child, 1);
                    
                    hooks.emit('node:release', { path: child, type:reasonType ,detail:{targetPath} });
                } else {
                    // 更新阻力
                    stagingArea.set(child, newResistance);
                    // 注意：这里不用 emit pending，因为只有首次加入时才 emit
                }
            };

            const { target: targetPath, trigger: currentTriggerPath } = task;

            try {
                if (currentExecutionToken.get(triggerPath) !== curToken) return;
                // trace.pushExecution([targetPath]);
                let hasValueChanged = false;
                let notifyNext = false;
                const targetSchema = data.GetRenderSchemaByPath(targetPath);
                
               
                hooks.emit('node:start', { 
                    path:targetPath, 
                });
                for (let bucketName in targetSchema.nodeBucket) {
                    const bucket = targetSchema.nodeBucket[bucketName] as SchemaBucket<T>;

                    // 桶内部会根据自己的 version 进行判断是否真正执行
                    const result = await bucket.evaluate({
                        affectKey: bucketName,
                        triggerPath: currentTriggerPath,
                        // targetPath:targetPath,
                        GetRenderSchemaByPath: data.GetRenderSchemaByPath,
                        GetValueByPath: (p: T) => data.GetRenderSchemaByPath(p).defaultValue,
                        GetToken: () => curToken

                    });

                    if (currentExecutionToken.get(triggerPath) !== curToken) {
                        hooks.emit(
                            'node:intercept',
                            {
                                path:targetPath,
                                // reason:`令牌过期，丢弃${targetPath}旧任务计算结果`,
                                type:1
                            }
                        )
                         
                        // console.log(`🚫 令牌过期，丢弃${targetPath}旧任务计算结果`);
                        return; // 不要执行 processed.add，不要触发 hasValueChanged
                    }

                    // Options 合法性检查hooks.emit
                    if (bucketName === "options") {
                        const isLegal = result.some(
                            (item: any) => item.value == targetSchema.defaultValue
                        );
                        if (!isLegal) {
                            targetSchema["defaultValue"] = undefined;
                            hasValueChanged = true;
                        }
                    }

                    // 数据更新检查
                    if (result !== targetSchema[bucketName]) {
                        targetSchema[bucketName] = result;
                        hasValueChanged = true;
                        //桶计算赋值成功打印
                        hooks.emit('node:bucket:success',{
                            path:targetPath,
                            key:bucketName,
                            value:result
                        })
                    }
  
                    if (bucket.isForceNotify()) {
                        notifyNext = true;
                    }
                    if (hasValueChanged) {
                        trigger.flushPathSet.add(targetPath as any);
                    }
                    // processed.add(targetPath);
                    const directChildren = dependency.GetNextDependency(targetPath);
                    // 1. 如果值变了，扩充疆域（这是为了让更深层的节点能正确进入暂存区）
                    if (hasValueChanged || notifyNext) {
                        const allNextOrder = dependency.GetAllNextDependency(targetPath);
                        allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                        // changedPaths.add(targetPath); // 统计所有以及变化的节点路径

                        if(bucketName==='defaultValue'){
                            
                            updateWatermark(targetPath);
                            
                        } 
                        
                    }
                   
                    for (const child of directChildren) {
                        if (processed.has(child)) {
                            hooks.emit(
                                'node:intercept',
                                {
                                    path:child,
                                    // reason:` 下游 ${child} 已由其他路径处理`,
                                    type:2
                                }
                            )
                            // console.log(`🧊 [拦截] 下游 ${child} 已由其他路径处理`);
                            continue; 
                        };

                        if (processingSet.has(child) || queueCountMap.has(child)) {
                            // 这里可以选择 silent 跳过，或者打印一个 intercept
                            // 关键是：绝对不要操作 stagingArea/rescueArea
                            hooks.emit('node:intercept', { 
                                path: child, 
                                // reason: `节点正忙 (P:${processingSet.has(child)}/Q:${queueCountMap.has(child)})，忽略本次重复信号`, 
                                type: 3 
                            });
                            continue; 
                        }
      
                        const shouldFire = hasValueChanged || notifyNext 
                        // || dependency.GetAllPrevDependency(child).some(p => changedPaths.has(p));

                        // 2. 关键分歧点：看当前节点是否产生了“影响力”
                        if (shouldFire) { 
                            // --- 【强影响】下游必须进入悲观区并尝试救赎 ---
                          
                            // 如果孩子不在悲观区，先送进去并计算它在波及名单内的阻力
                            if (
                                !stagingArea.has(child) && 
                                !processed.has(child) && 
                                !queueCountMap.has(child) &&
                                !processingSet.has(child)
                            ) {
                                const effectParentsCount = dependency.GetPrevDependency(child)
                                    .filter(p => AllAffectedPaths.has(p)).length;
                                stagingArea.set(child, effectParentsCount);
                                hooks.emit('node:pending',{path:child})
                            }

                            tryActivateChild(child, 1);

                            // // 尝试减阻力
                            // const currentResistance = stagingArea.get(child) ?? 0;
                            // const newResistance = Math.max(0, currentResistance - 1);

                            // if (newResistance <= 0) {

                            //     // 1. 检查是否已在队列中排队 (Waiting)
                            //     const isAlreadyInQueue = queueCountMap.has(child);
                                
                            //     // 2. 检查是否正在计算中 (Running)
                            //     // 注意：如果它正在跑，说明它拿到的可能是旧的上游值，
                            //     // 但因为你的 totalPrice 已经算完了，当前正在跑的任务在执行 store.get(totalPrice) 时，
                            //     // 其实能拿到最新值，所以理论上也不需要再次入队。
                            //     const isAlreadyRunning = processingSet.has(child);

                            //     if (isAlreadyInQueue || isAlreadyRunning) {
                            //         hooks.emit('node:intercept', { 
                            //             path: child, 
                            //             reason: `节点 ${child} 已在调度链路中 (Queue:${isAlreadyInQueue}, Running:${isAlreadyRunning})，跳过重复点火`,
                            //             type:3 
                            //         });
                            //         // 既然已经在排队或执行了，就不再重复执行 queue.push
                            //         continue; 
                            //     }
                            //     stagingArea.delete(child);
                            //     queue.push({ target: child, trigger: targetPath, isReleased: true });
                            //     queueCountMap.set(child, 1);
                              
                            //     // trace.pushExecution([child]);
                            //     hooks.emit('node:release',{path:child,reason:  ` 上游${targetPath} 值变了`})
                            //     // console.log(`🔥 [强拉动] ${targetPath} 值变了，释放下游: ${child}`);
                            // } else {

                       
                            //     stagingArea.set(child, newResistance);
                            //     hooks.emit('node:pending',{path:child})
                            // }
                        } else {
                            if (stagingArea.has(child)){
                                tryActivateChild(child, 2);
                            }else{
                                // --- 【弱影响】值没变，下游不入悲观区，不减阻力 ---
                                // 它们现在只是 AllAffectedPaths 里的一个“标记”，
                                // 等待 flushQueue 的水位线步进或者其他变动的路径来捞它们
                                // console.log(`🧊 [弱关联] ${targetPath} 值未变，${child} 仅更新疆域，原地待命`);
                                // hooks.emit('node:stagnate',{path:child,reason:` 上游${targetPath} 值未变`})

                                const level = pathToLevelMap.get(child)!;
            
                                if (!resureArea.has(level)) {
                                    resureArea.set(level, new Set());
                                }
                                
                                const levelSet = resureArea.get(level)!;
                                if (!levelSet.has(child) && !processed.has(child) && !queueCountMap.has(child)) {
                                    levelSet.add(child);
                                    hooks.emit('node:stagnate', { path: child,type:1 });
                                }
                            }
                            

                        }
                    }

                }

                hooks.emit('node:success',{path:targetPath});
                processed.add(targetPath);
                
 
                if (performance.now() - lastYieldTime > 16) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                    lastYieldTime = performance.now();
                    // 切片回来后再检查一次 token，防止在渲染期间有新任务抢占
                    if (currentExecutionToken.get(triggerPath) !== curToken) return;
                }
                if (currentExecutionToken.get(triggerPath) === curToken) {
                    trigger.requestUpdate();
                }
            } catch (err) {
                // console.error(`计算路径 ${targetPath} 时出错:`, err);

                hooks.emit('node:error',{
                    path:targetPath,
                    error:err
                })

                const abortToken = Symbol("abort");
                currentExecutionToken.set(triggerPath, abortToken);
          
                // 2. 物理清空任务队列，让 flushQueue 的 while 循环立刻失去动力
                queue.length = 0; 
                stagingArea.clear();
                processingSet.clear(); // 强制清空正在处理的集合
                // changedPaths.delete(targetPath);//标记路径为没有变化
                
                // trace.markError(targetPath)

                hooks.callOnError(err)
            } finally {
                if (currentExecutionToken.get(triggerPath) === curToken) {
                 
                    processingSet.delete(targetPath);
                
             
               
                    // 关键点 2：点火！
                    // 当 A2 算完，它尝试去叫醒可能正在“休眠”的 flushQueue
                    // 由于你有 isLooping 锁，如果 while 还在转，这一句会被 return，不产生副作用
                    // 如果 while 已经退出了，这一句会重新激活循环，去处理 A3, B2 等下游
                    if (!isLooping ) {
                        
 
                        const remaining = processingSet.size||stagingArea.size||queueCountMap.size;
                        // const fireReason = remaining > 0 
                        //     ? `[${targetPath}] 归航，剩余 ${remaining} 个任务在途，系统保持待机。`
                        //     : `[${targetPath}] 最终归航！所有任务已清空，重启调度检查收尾。`;

                        hooks.emit(
                            'flow:fire',
                            {
                                path:targetPath,
                                type:remaining > 0?1:2,
                                // reason:fireReason
                                detail:{
                                    remaining
                                }
                            }
                        )
                        flushQueue();
                    }

                }

            }



        }
 
 
        const flushQueue = async () => {
            // 1. 令牌检查 (安全熔断)
            if (currentExecutionToken.get(triggerPath) !== curToken) {
                isLooping = false;
                return;
            }
        
            isLooping = true;
        
            try {
                while (true) {
                    // 🛑 令牌检查
                    if (currentExecutionToken.get(triggerPath) !== curToken) break;
        
                    // ==========================================================
                    // 阶段一：消费队列 (Active Queue)
                    // ==========================================================
                    if (queue.length > 0) {
                        // A. 并发控制
                        if (processingSet.size >= MAX_CONCURRENT_TASKS) {
                            isLooping = false;
                            return; 
                        }
        
                        // --- 🔥 核心改动：预读任务，进行水位安检 ---
                        const task = queue[0]; // 先看一眼，不取出来
                        const { target: targetPath } = task;
                        const targetLevel = pathToLevelMap.get(targetPath) ?? 0;
        
                        // 🛑 水位拦截逻辑
                        // 如果当前任务层级 > 当前水位，说明它是“抢跑”的跨层级任务（例如 c3）
                        // 必须把它拦截下来，退回 stagingArea 等待同层级的 b2 跑完
                        if (targetLevel > currentLevel) {
                            // 1. 真正出队
                            queue.shift();
                            
                            // 2. 修正队列计数
                            const currentCount = queueCountMap.get(targetPath) || 0;
                            if (currentCount <= 1) queueCountMap.delete(targetPath);
                            else queueCountMap.set(targetPath, currentCount - 1);
        
                            // 3. 只有当它不在暂存区时，才进行“回炉重造”
                            // (防止重复添加导致阻力计算错误)
                            if (!stagingArea.has(targetPath)) {
                                // 计算它在本次受灾范围内的真实入度（阻力）
                                // 比如 c3 依赖 a1, b2。此时 a1 跑完了，b2 没跑。
                                // effectParentsCount 会算出来是 2 (如果 a1, b2 都在 AllAffectedPaths 里)
                                // 但因为 a1 已经跑完了（processed），我们需要一个机制来减去已完成的阻力吗？
                                // 💡 不用复杂化！直接扔进 stagingArea，设为最大阻力。
                                // 等 b2 跑完 release 时减 1。
                                // 那 a1 的那 1 点阻力怎么办？
                                // 这是一个关键点：因为 a1 已经跑完了，它不会再触发 release 了。
                                // 所以这里初始化的阻力，必须扣除掉“已完成的上游”！
                                
                                const directParents = dependency.GetPrevDependency(targetPath);
                                const pendingParentsCount = directParents.filter(p => 
                                    AllAffectedPaths.has(p) && !processed.has(p) // 只计算还没跑完的上游！
                                ).length;
        
                                if (pendingParentsCount > 0) {
                                    stagingArea.set(targetPath, pendingParentsCount);
                                    hooks.emit('node:intercept', {
                                        path: targetPath,
                                        // reason: `层级过高(L${targetLevel}>L${currentLevel})，退回暂存区等待上游(余${pendingParentsCount})`,
                                        type: 4,
                                        detail:{
                                            targetLevel,
                                            currentLevel,
                                            pendingParentsCount
                                        }
                                    });
                                } else {
                                    // 极端情况：所有上游其实都跑完了？那说明水位线滞后了，或者可以直接跑
                                    // 这种情况下放行，或者暂时挂起等水位推进
                                    // 为了安全，如果层级真的高，还是先挂起，等阶段四推水位捞回来
                                    stagingArea.set(targetPath, 0); 
                                }
                            }
                            // 拦截后，直接处理队列下一个，或者重新循环
                            continue;
                        }
        
                        // --- 任务合法，正式出队执行 ---
                        queue.shift(); // 刚才只是 peek，现在 shift
                        
                        // 记账逻辑 (保持不变)
                        const currentCount = queueCountMap.get(targetPath) || 0;
                        if (currentCount <= 1) queueCountMap.delete(targetPath);
                        else queueCountMap.set(targetPath, currentCount - 1);
        
                        // 防重入 (保持不变)
                        if (processed.has(targetPath)) {
                            hooks.emit('node:intercept', { path: targetPath, type: 2 });
                            continue;
                        }
        
                        processingSet.add(targetPath);
                        hooks.emit('node:processing', { path: targetPath });
                        executorNodeCalculate(task);
                        continue;
                    }
        
                    // ==========================================================
                    // 阶段二：熄火判定 (保持不变)
                    // ==========================================================
                    if (processingSet.size > 0) {
                        hooks.emit('flow:wait', {  type:1, detail:{ nums:processingSet.size}});
                        isLooping = false;
                        return;
                    }
        
                    // ==========================================================
                    // 阶段三：入度等待判定 (保持不变)
                    // ==========================================================
                    if (stagingArea.size > 0 && processingSet.size > 0) {
                         return;
                    }
        
                    // ==========================================================
                    // 阶段四：水位推进与打捞 (Level Advancement) - 🔥 核心改动
                    // ==========================================================
                    // 走到这里，说明 Queue 空了，Processing 空了。
                    // 此时 stagingArea 里可能躺着刚才被拦截的 c3 (Level 3)，
                    // resureArea 里可能有挂起的弱信号节点。
                    
                    // 1. 扫描所有待处理区域的最小层级 (合并 Staging 和 Rescue)
                    const pendingLevels = new Set<number>();
                    for (const lvl of resureArea.keys()) pendingLevels.add(lvl);
                    
                    // 也要看 StagingArea 里的层级！
                    for (const [path] of stagingArea) {
                        const lvl = pathToLevelMap.get(path) ?? 0;
                        // 只关注大于当前水位的，因为小于等于的理应已经处理或正在处理
                        if (lvl > currentLevel) pendingLevels.add(lvl);
                    }
        
                    const sortedLevels = Array.from(pendingLevels).sort((a, b) => a - b);
        
                    if (sortedLevels.length === 0) {
                        // 真的没事干了，stagingArea 剩余的可能是死锁或无需处理的
                        break; 
                    }
        
                    const nextLevel = sortedLevels[0];
        
                    // 2. 检查水位准入
                    if (nextLevel <= maxAffectedLevel) {
                        // 🌊 推进水位！
                        currentLevel = nextLevel;
        
                        // --- A. 捞 RescueArea (弱信号) ---
                        if (resureArea.has(nextLevel)) {
                            const candidates = resureArea.get(nextLevel)!;
                            candidates.forEach(path => {
                                queue.push({ target: path, trigger: triggerPath, isReleased: true });
                                queueCountMap.set(path, (queueCountMap.get(path) || 0) + 1);
                            });
                            resureArea.delete(nextLevel);
                        }
        
                        // --- B. 捞 StagingArea (刚才被拦截的强信号) ---
                        // 找出所有处于 nextLevel 的 staging 节点
                        const stagingCandidates: T[] = [];
                        for (const [path, resistance] of stagingArea) {
                            if ((pathToLevelMap.get(path) ?? 0) === nextLevel) {
                                // 只有阻力归零的才能捞？
                                // 不！如果它是被“水位拦截”进去的，说明它的上游可能已经跑完了，
                                // 或者它需要再次进 Queue 去接受 executor 的检查。
                                // 这里最简单的策略是：只要水位到了，就把它扔回 Queue。
                                // executor 会再次计算它的阻力，如果阻力未清，会再次把它放回 staging。
                                stagingCandidates.push(path);
                            }
                        }
        
                        stagingCandidates.forEach(path => {
                            stagingArea.delete(path); // 先移除
                            queue.push({ target: path, trigger: triggerPath, isReleased: true });
                            queueCountMap.set(path, (queueCountMap.get(path) || 0) + 1);
                            hooks.emit('node:release', { path, type:3, detail:{level:nextLevel}});
                        });
        
                        continue; // 回到 while 顶部处理 queue
                    } else {
                        // 截断逻辑...
                        resureArea.forEach(set => set.forEach(p => processed.add(p))); // 标记为处理过
                        resureArea.clear();
                        break;
                    }
                }
            } finally {
                isLooping = false;
                // 最终结算检查

                // 只有当所有区域都空了，才算真的结束
                if (queue.length === 0 && processingSet.size === 0 && resureArea.size === 0) {
                    if (currentExecutionToken.get(triggerPath) === curToken) {
                        const endTime = performance.now();
                        hooks.emit('flow:success',{duration:(endTime-startTime).toFixed(2)+'ms'})
                        Promise.resolve().then(() => {hooks.callOnSuccess();});
                    }
                }
            }
        };

        flushQueue();

    }

    return TaskRunner;
}


export { useMeshTask }