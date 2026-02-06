import { MeshEmit } from "../plugins/usePlugin";
import { SchemaBucket } from "./bucket";

function useMeshTask<T extends string>(
    config:{
        useGreedy:boolean
    },
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

    const isGreedy = config.useGreedy;
    
    //运行调用入口
    const TaskRunner = (
        triggerPath: T,
        initialNodes: T[]
    ) => {
        //最大并发数
        const MAX_CONCURRENT_TASKS = 20;

        console.log(isGreedy)
         
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

        // const queueCountMap = new Map<T, number>();
         //等待执行区,直接上游发生变化了会把节点加入这里
        const stagingArea = new Map<T, number>();
        // 等待捕捞区,上游没有变但是不好直接扔所以把这个先扔在这里等待捕捞
        const resureArea = new Map<number,Set<T>>();

        let lastYieldTime = performance.now();

        // 🔥 优化 1：零阻力缓冲区 (Set 保证唯一性)
        const readyToRunBuffer = new Set<T>();

        // 🔥 优化 2：预计算汇聚点和静态层级（避免在循环中高频调用函数）
        const mergeNodeSet = new Set<T>();
 
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
        initialNodes.forEach((p) => {
            readyToRunBuffer.add(p);
        });

        processed.add(triggerPath);
        
   
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

      

        const executorNodeCalculate = async (task: { target: T; trigger: T;  }) => {
 
            // 这个函数只负责：减阻力 -> 判断归零 -> 入队
            //reasontype -> 1:上游 ${targetPath} 值变了 2: 当上游值没有变但是下游节点已经在stagingArea的时候`上游 ${targetPath} 完成(穿透)`
            const tryActivateChild = (child: T, reasonType: number) => {
                const currentResistance = stagingArea.get(child) ?? 0;
                const newResistance = Math.max(0, currentResistance - 1);

                if (newResistance <= 0) {
                    // 检查忙碌状态
                    const isAlreadyInReadyBuffer = readyToRunBuffer.has(child);
                    const isAlreadyRunning = processingSet.has(child);
                    // const isAlreadyInQueue = queueCountMap.has(child);
                    // const isAlreadyRunning = processingSet.has(child);

                    if (isAlreadyInReadyBuffer || isAlreadyRunning) {
                        
                        hooks.emit('node:intercept', { 
                            path: child, 
                            // reason: `节点 ${child} 正忙 (Q:${isAlreadyInQueue}, R:${isAlreadyRunning})`, 
                            type: isAlreadyRunning?3:3.1 
                        });
                        return;
                    }

                    // 入队操作
                    stagingArea.delete(child);

                    //加入准备跑的集合,用来做batch
                    readyToRunBuffer.add(child);

                    // queue.push({ target: child, trigger: targetPath, isReleased: true });
                    // queueCountMap.set(child, 1);
                    
                    hooks.emit('node:release', { path: child, type:reasonType ,detail:{path:targetPath} });
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
                    const p = bucket.evaluate({
                        affectKey: bucketName,
                        triggerPath: currentTriggerPath,
                        // targetPath:targetPath,
                        GetRenderSchemaByPath: data.GetRenderSchemaByPath,
                        GetValueByPath: (p: T) => data.GetRenderSchemaByPath(p).defaultValue,
                        GetToken: () => curToken

                    });
                    let result:any = p;
                    if(p instanceof Promise){
                       
                        result = await p;
                    } 

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

                        if (processingSet.has(child) || readyToRunBuffer.has(child)) {
                            // 这里可以选择 silent 跳过，或者打印一个 intercept
                            // 关键是：绝对不要操作 stagingArea/rescueArea
                             
                            hooks.emit('node:intercept', { 
                                path: child, 
                                // reason: `节点正忙 (P:${processingSet.has(child)}/Q:${queueCountMap.has(child)})，忽略本次重复信号`, 
                                type: processingSet.has(child)?3:3.1
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
                                !readyToRunBuffer.has(child) &&
                                !processingSet.has(child)
                            ) {
                                const effectParentsCount = dependency.GetPrevDependency(child)
                                    .filter(p => AllAffectedPaths.has(p)).length;
                                stagingArea.set(child, effectParentsCount);
                                hooks.emit('node:pending',{path:child})
                            }

                            tryActivateChild(child, 1);

                 
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
                                if (!levelSet.has(child) && !processed.has(child) && !readyToRunBuffer.has(child)) {
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
                // queue.length = 0; 
                readyToRunBuffer.clear();
                stagingArea.clear();
                processingSet.clear(); // 强制清空正在处理的集合
                // changedPaths.delete(targetPath);//标记路径为没有变化
                
                // trace.markError(targetPath)

                hooks.callOnError(err)
            } finally {
               
                if (currentExecutionToken.get(triggerPath) === curToken) {
                 
                    
                processingSet.delete(targetPath);
                    const activenums = processingSet.size;
                    const pendingnums = readyToRunBuffer.size
                    
                    // 关键点 2：点火！
                    // 当 A2 算完，它尝试去叫醒可能正在“休眠”的 flushQueue
                    // 由于你有 isLooping 锁，如果 while 还在转，这一句会被 return，不产生副作用
                    // 如果 while 已经退出了，这一句会重新激活循环，去处理 A3, B2 等下游
                    
                    if (!isLooping ) {
                         
                      
                        // const remaining = processingSet.size + stagingArea.size + readyToRunBuffer.size;
                        // const fireReason = remaining > 0 
                        //     ? `[${targetPath}] 归航，剩余 ${remaining} 个任务在途，系统保持待机。`
                        //     : `[${targetPath}] 最终归航！所有任务已清空，重启调度检查收尾。`;
                        
                        hooks.emit(
                            'flow:fire',
                            {
                                path:targetPath,
                                type:1,
                                // reason:fireReason
                                detail:{
                                    active: activenums,    
                                    pending:pendingnums,
                                    blocked: stagingArea.size,  
                                }
                            }
                        );
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

                    if (performance.now() - lastYieldTime > 16) {
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        lastYieldTime = performance.now();
                        if (currentExecutionToken.get(triggerPath) !== curToken) break;
                    }
                     
                    if (readyToRunBuffer.size > 0 && processingSet.size < MAX_CONCURRENT_TASKS) {
                
                        // 💡 关键：使用 for...of 遍历 Set 实现批量同步分发
                        for (const targetPath of readyToRunBuffer) {
                            if (processingSet.size >= MAX_CONCURRENT_TASKS) break;
        
                            const targetLevel = pathToLevelMap.get(targetPath) ?? 0;
                            const staticParents = dependency.GetPrevDependency(targetPath);
                            const isMergeNode = staticParents.length > 1;
                            const shouldIntercept = (!isGreedy || isMergeNode) && (targetLevel > currentLevel);
        
                            // 🛑 水位/汇聚点拦截
                            if (shouldIntercept) {
                                readyToRunBuffer.delete(targetPath);
                                
                                const pendingParentsCount = staticParents.filter(p => 
                                    AllAffectedPaths.has(p) && !processed.has(p)
                                ).length;
        
                                stagingArea.set(targetPath, pendingParentsCount || 0);
                                hooks.emit('node:intercept', {
                                    path: targetPath,
                                    type: pendingParentsCount > 0 ? 4 : 5,
                                    detail: { targetLevel, currentLevel, pendingParentsCount }
                                });
                                continue; 
                            }
        
                            // ✅ 通过安检，准备发车
                            readyToRunBuffer.delete(targetPath);
                            processingSet.add(targetPath);
                            hooks.emit('node:processing', { path: targetPath });
        
                            // 🔥 核心优化：同步调用，不 await！
                            // 这会让循环立刻进入下一个，瞬间填满 20 个并发位
                            executorNodeCalculate({ 
                                target: targetPath, 
                                trigger: triggerPath, 
                                // isReleased: true 
                            });
                        }
                        
                        // 批量发完一波后，重新循环检查是否有新产生的 ready 节点
                        continue; 
                    }
        
                    // ==========================================================
                    // 阶段二：贪婪捞取 (Greedy Catch-up) 
                    // ==========================================================
                    if (isGreedy && stagingArea.size > 0 && processingSet.size < MAX_CONCURRENT_TASKS) {
                        let foundGreedy = false;
                        for (const [path, resistance] of stagingArea) {
                            if (resistance <= 0) {
                                const level = pathToLevelMap.get(path) ?? 0;
                                const staticParents = dependency.GetPrevDependency(path);
                                
                                // 汇聚点守卫
                                if (level > currentLevel && staticParents.length > 1) continue;
        
                                stagingArea.delete(path);
                                readyToRunBuffer.add(path);
                                foundGreedy = true;
                                hooks.emit('node:release', { path, type: 4 });
                            }
                        }
                        if (foundGreedy) continue; // 捞到了就回顶部批量发车
                    }
        
                    // ==========================================================
                    // 阶段三：水位推进 (逻辑出口 A)
                    // ==========================================================
                    if (processingSet.size === 0 && readyToRunBuffer.size === 0) {
                        // 找出最小的待处理层级
                        const pendingLevels = new Set<number>();
                        for (const lvl of resureArea.keys()) pendingLevels.add(lvl);
                        for (const [path] of stagingArea) {
                            const lvl = pathToLevelMap.get(path) ?? 0;
                            if (lvl > currentLevel) pendingLevels.add(lvl);
                        }
        
                        const sortedLevels = Array.from(pendingLevels).sort((a, b) => a - b);

                        const nextLevel = sortedLevels[0];

                        if (sortedLevels.length > 0 && nextLevel <= maxAffectedLevel) {
                            const nextLevel = sortedLevels[0];
                            if (nextLevel <= maxAffectedLevel) {
                                currentLevel = nextLevel;
                                
                                // 捞弱信号
                                const rescueNodes = resureArea.get(nextLevel);
                                if (rescueNodes) {
                                    rescueNodes.forEach(p => readyToRunBuffer.add(p));
                                    resureArea.delete(nextLevel);
                                }
        
                                // 捞被水位拦截的强信号
                                for (const [path] of stagingArea) {
                                    if ((pathToLevelMap.get(path) ?? 0) === nextLevel) {
                                        stagingArea.delete(path);
                                        readyToRunBuffer.add(path);
                                        hooks.emit('node:release', { path, type: 3, detail: { level: nextLevel } });
                                    }
                                }
                                continue; // 推进水位后，重新循环发车
                            }
                        }else{
                            resureArea.forEach((set, level) => {
                                set.forEach(p => {
                                    processed.add(p);
                                    hooks.emit('node:intercept', { 
                                        path: p, 
                                        type: 6, 
                                  
                                    });
                                });
                            });
                            resureArea.clear();
                    
                            // 2. 清除所有强信号 (StagingArea)
                            for (const [path] of stagingArea) {
                                processed.add(path);
                                hooks.emit('node:intercept', { 
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
                    if (readyToRunBuffer.size > 0 && processingSet.size >= MAX_CONCURRENT_TASKS) {
                        // 这种情况叫“并发限制等待”
                        hooks.emit('flow:wait', { 
                            type: 2, 
                        });
                    }
                    // else if (processingSet.size > 0 && readyToRunBuffer.size === 0) {
                    //     // 缓冲区空了，但还有 20 个异步任务在飞，正式进入挂起状态
                    //     hooks.emit('flow:wait', { 
                    //         type: 1, 
                    //         detail: { nums: processingSet.size } 
                    //     });
                    // }
        
                    // 实在没活了，或者正在等异步任务返回
                    break;
                }
            } finally {
                isLooping = false;
                // 最终结算检查
                const remaining = processingSet.size + stagingArea.size + readyToRunBuffer.size;
                if (remaining === 0) {
                    if (currentExecutionToken.get(triggerPath) === curToken) {
                        hooks.emit(
                            'flow:end',
                            {
                                type:1
                            }
                        );
                        const endTime = performance.now();
                        hooks.emit('flow:success',{duration:(endTime-startTime).toFixed(2)+'ms'})
                        Promise.resolve().then(() => {hooks.callOnSuccess();});
                    }
                }else{
                    hooks.emit('flow:wait', { 
                        type: 1, 
                        detail: { nums: processingSet.size } 
                    });
                }
            }
        };

        flushQueue();

    }

    return TaskRunner;
}


export { useMeshTask }