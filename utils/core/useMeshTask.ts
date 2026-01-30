import { SchemaBucket } from "../bucket";

function useMeshTask<T extends string>(
    dependency: {
        GetAllNextDependency: (p: T) => T[],
        GetAllPrevDependency: (p: T) => T[],
        GetPrevDependency: (p: T) => T[],
        GetNextDependency: (p: T) => T[]
    },
    trace: {
        pushExecution: any;
        popExecution: any;
    },
    data: {
        GetRenderSchemaByPath: (p: T) => any
    },
    trigger: {
        requestUpdate: () => void,
        flushPathSet: Set<string>
    }
) {
    const currentExecutionToken: Map<T, symbol> = new Map();

    const isReachable = (
        trigger: T,
        target: T,
        knownAffected: Set<T>
    ): boolean => {
        if (trigger === target || knownAffected.has(target)) return true;

        const visited = new Set<T>();
        const stack = [target]; // 向上溯源用栈(DFS)或队列(BFS)都可以

        while (stack.length > 0) {
            const curr = stack.pop()!;
            if (visited.has(curr)) continue;
            visited.add(curr);

            const parents = dependency.GetPrevDependency(curr);

            for (const p of parents) {
                // 核心优化点：剪枝
                // 只要任何一个父节点在已知战区，或者就是触发点，直接断定
                if (p === trigger || knownAffected.has(p)) {
                    return true;
                }

                if (!visited.has(p)) {
                    stack.push(p);
                }
            }
        }

        return false;
    }

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

        const processed = new Set<T>();
        const processingSet = new Set<T>();
        const AllAffectedPaths = new Set<T>(
            dependency.GetAllNextDependency(triggerPath)
        );
        processed.add(triggerPath);
        const queueCountMap = new Map<T, number>();
        //悲观队列，如果一个path的直接上游并没有被纳入计算但是这个path本身已经被影响，之前是乐观的直接计算，但是由于镜像依赖问题，
        //导致计算会拿到过期的数据，新数据更新之后没法继续更新了，所以加入悲观队列先挂起，最后再入队
        const stagingArea = new Map<T, number>();

        let lastYieldTime = performance.now();

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
        trace.pushExecution([...Array.from(initialNodes), triggerPath], true);
        // 打印任务启动
        console.log(
            `%c 🚀 任务启动 | Trigger: ${triggerPath} | Token: ${curToken.description}`,
            "color: #67c23a; font-weight: bold;"
        );

        const executorNodeCalculate = async (task: { target: T; trigger: T; isReleased: boolean; }) => {
            // let hasValueChanged = false;
            // let notifyNext = false;
            // const { target: targetPath, trigger: currentTriggerPath } = task;
            // const targetSchema = data.GetRenderSchemaByPath(targetPath);
            // console.log(`%c ✅ 计算完成: ${targetPath}`+"当前值:", targetSchema.defaultValue, "color: #67c23a;");
            const { target: targetPath, trigger: currentTriggerPath } = task;
            try {
               
                let hasValueChanged = false;
                let notifyNext = false;
              
                const targetSchema = data.GetRenderSchemaByPath(targetPath);
                console.log(`%c ✅ 计算完成: ${targetPath}`+"当前值:", targetSchema.defaultValue, "color: #67c23a;");

                for (let bucketName in targetSchema.nodeBucket) {
                    const bucket = targetSchema.nodeBucket[bucketName] as SchemaBucket;

                    // 桶内部会根据自己的 version 进行判断是否真正执行
                    const result = await bucket.evaluate({
                        affectKey: bucketName,
                        triggerPath: currentTriggerPath,
                        GetRenderSchemaByPath: data.GetRenderSchemaByPath,
                        GetValueByPath: (p: T) =>
                            data.GetRenderSchemaByPath(p).defaultValue,
                        isSameToken: () =>
                            currentExecutionToken.get(triggerPath) === curToken,
                    });
                    if (currentExecutionToken.get(triggerPath) !== curToken) {
                        console.log("🚫 令牌过期，丢弃旧任务计算结果");
                        return; // 不要执行 processed.add，不要触发 hasValueChanged
                    }
                    processed.add(targetPath);
                    // processingSet.delete(targetPath);
                    // Options 合法性检查
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
                    }

                    if (bucket.isForceNotify()) {
                        notifyNext = true;
                    }
                    if (hasValueChanged) {
                        trigger.flushPathSet.add(targetPath as any);
                    }
        
                    const directChildren = dependency.GetNextDependency(targetPath);
                    // 1. 如果值变了，扩充疆域（这是为了让更深层的节点能正确进入暂存区）
                    if (hasValueChanged || notifyNext) {
                        const allNextOrder = dependency.GetAllNextDependency(targetPath);
                        allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                    }
        
                    for (const childPath of directChildren) {
                        const isProcessed = processed.has(childPath);
                        const isInQueue = queueCountMap.has(childPath) || processingSet.has(childPath);
                        const isInStaging = stagingArea.has(childPath);
                    
                        // --- 核心判定逻辑 ---
                        // 1. 如果值变了/强制通知：只要下游还没处理完，就必须接力
                        const shouldPropagate = (hasValueChanged || notifyNext) && !isProcessed;
                        
                        // 2. 救赎逻辑：如果它在暂存区（说明之前依赖没好），现在上游算完了，必须给它一次机会
                        const shouldRescue = isInStaging && !isInQueue;
                    
                        // 3. 兜底逻辑：如果它在受影响名单里，但目前既没算完也没入队，说明它掉队了
                        const shouldRefill = AllAffectedPaths.has(childPath) && !isProcessed && !isInQueue;
                    
                        if (shouldPropagate || shouldRescue || shouldRefill) {
                            // 关键：只有当前不在队列/不在执行中，才执行 push
                            if (!isInQueue) {
                                if (isInStaging) stagingArea.delete(childPath);
                    
                                queue.push({
                                    target: childPath,
                                    trigger: targetPath,
                                    isReleased: false,
                                });
                    
                                queueCountMap.set(childPath, (queueCountMap.get(childPath) || 0) + 1);
                                
                                // 必须调用 trace 才能让 UI 看到“转圈”状态
                                trace.pushExecution([childPath]);
                    
                                console.log(`%c 🛰️ 信号接力: ${targetPath} -> ${childPath}`, "color: #00bcd4;");
                            }
                        }
                    }
                }

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
                console.error(`计算路径 ${targetPath} 时出错:`, err);
                
            } finally {
                if (currentExecutionToken.get(triggerPath) === curToken) {
                    processingSet.delete(targetPath);
                    trace.popExecution([targetPath]);
                  
                    // 关键点 2：点火！
                    // 当 A2 算完，它尝试去叫醒可能正在“休眠”的 flushQueue
                    // 由于你有 isLooping 锁，如果 while 还在转，这一句会被 return，不产生副作用
                    // 如果 while 已经退出了，这一句会重新激活循环，去处理 A3, B2 等下游
                    if(!isLooping){
                        flushQueue();
                    }
                   
                }
        
            }

            

        }

        const flushQueue = async () => {
            if (currentExecutionToken.get(triggerPath) !== curToken) {
                isLooping = false; 
                return;
            }
        
            isLooping = true;
            try{
                while (queue.length || stagingArea.size > 0) {
                    //如果不是最新的对于本次起源路径的计算就可以停止扩散了
                    if (currentExecutionToken.get(triggerPath) !== curToken) {
                        console.log("💀 旧任务自毁");
                        return; // 直接退出，不要走 finally 里的 isLooping = false，因为那是旧任务的锁
                    }
                    // 🔴 流量控制：如果正在飞的任务太多了，先憋着
                    if (processingSet.size >= MAX_CONCURRENT_TASKS) {
                        console.log(`⏳ 并发已达上限 (${MAX_CONCURRENT_TASKS})，暂停派发...`);
                        isLooping = false; // 暂时熄火
                        return; // 退出循环，等待任意一个飞着的任务 finally 后来“点火”
                    }
                    //如果队列里面没有任务了去看看悲观区，把悲观区的移入进来，后面可能会修改，因为还要看processingset里面有没有
                    if (queue.length === 0 && stagingArea.size > 0) {
                        // 如果还有人在异步计算，绝对不能全量释放！
                        // 此时我们直接 return（拉闸），等最后那个异步任务算完来点火。
                        if (processingSet.size > 0) {
                            // 🛑 关键：只要还有异步任务在跑，绝不能全量释放暂存区！
                            console.log(`🧊 还有 ${processingSet.size} 个任务在飞，保持拉闸状态...`);
                            console.log("在飞的任务是:", Array.from(processingSet))
                            isLooping = false;
                            return; 
                        }
                        // await Promise.resolve();
                        //  if (currentExecutionToken.get(triggerPath) !== curToken) return;
                        // if (queue.length > 0 || processingSet.size > 0) continue;
                        console.log(
                            `%c 🔓 [全量释放] 暂存区节点已无更新动力，强制回填执行`,
                            "color: #9c27b0;"
                        );
                        for (const [path] of stagingArea) {
                            // 标记这个任务是“赦免”归来的
                            queue.push({
                                target: path,
                                trigger: triggerPath,
                                isReleased: true,
                            } as any);
                            queueCountMap.set(path, 1);
                        }
                        stagingArea.clear(); // 彻底清空，防止死循环
                        continue;
                    }
    
                    const task = queue.shift()!;
                    const { target: targetPath, trigger: currentTriggerPath } = task;
                    const currentCount = queueCountMap.get(targetPath) || 0;
                    if (currentCount <= 1) {
                        queueCountMap.delete(targetPath);
                    } else {
                        queueCountMap.set(targetPath, currentCount - 1);
                    }
    
                    const parents = dependency.GetAllPrevDependency(targetPath);
    
                    // 打印当前出队节点
                    console.log(
                        `%c 📦 出队检查: ${targetPath} (来自: ${currentTriggerPath})`,
                        "color: #409eff;"
                    );
    
                    const directParents = dependency.GetPrevDependency(targetPath);
                    // 【第一步：移交判定】
                    // 如果我发现我有父节点在“视界之外”（在名单里但没进队列），我立刻移交悲观区
                    const isUncertain = directParents.some((p) => {
                        // console.log(`${targetPath}的直接上游` + `${directParents.join(',')}`)
                        // console.log(`检查${targetPath}是否悲观时的正在执行列表:` + `${Array.from(processingSet).join(',')}`)
                        if (processed.has(p)) return false; // 已完成，安全
                        if (queueCountMap.has(p) || processingSet.has(p)) return false; // 正在动，不属于不确定
    
                        if (task.isReleased) {
                            return false;
                        }
    
                        // 关键：如果父节点 p 在本次触发的影响范围内，但现在还没进队列
                        // 说明信号还没传导到 p，那么我现在 (targetPath) 就是抢跑！
                        if (
                            AllAffectedPaths.has(p) ||
                            isReachable(triggerPath, p, AllAffectedPaths)
                        ) {
                            return true;
                        }
                        return false;
                    });
                    //检查上游是否完成，没有的话就是悲观，移入悲观区
                    if (isUncertain) {
    
                        console.log(
                            `%c 📥 [移交暂存] ${targetPath} 依赖的 ${directParents
                                .filter((p) => !processed.has(p))
                                .join(",")} 尚未入队，移交悲观区`,
                            "color: #e91e63;"
                        );
                        stagingArea.set(targetPath, 1);
                        // 注意：这里不需要 push 回 queue，直接 continue，它就在 queue 中消失了，只存在于 stagingArea
                        continue;
                    }
                    //不是悲观的话就要去检查一下是否又父元素正在执行，如果是在正在处理的队列中，还是需要等待，
                    //但是这里也要后期改成直接剔除后重新点火启动while逻辑
                  
                    const isAnyParentNotReady = parents.some((p) => {
                        // 1. 如果父节点正在“飞行中”（正在 await ），绝对不能跑下游
                        if (processingSet.has(p)) return true;

                        // 2. 如果父节点还在队列里排队，还没轮到它算，下游必须等
                        if (queueCountMap.has(p) && queueCountMap.get(p)! > 0) return true;

                        // 3. 【核心】如果这个父节点属于“本次任务受影响”的范围，但它还没进过 processed
                        // 这说明它还没被计算过，下游不能抢跑
                        if (AllAffectedPaths.has(p) && !processed.has(p)) return true;

                        // 其他情况（比如父节点不在受影响范围，或者已经算完且不在处理中），视为 Ready
                        return false;
                    });
    
                    if (isAnyParentNotReady) {
                    
    
                        // 无论 queue 是否为空，都要移入暂存区，不能直接 return
                        console.log(`⏳ [拓扑挂起] ${targetPath} 依赖未就绪，移入暂存等待唤醒`);
                        stagingArea.set(targetPath, 1);
                        
                        // 如果队列空了，确实要熄火，等待正在跑的任务来点火
                        if (queue.length === 0) {
                            console.log('🛑 队列已空，停止当前循环，等待异步任务点火');
                            isLooping = false;
                            return; 
                        }
                        continue;
     
                    }
                    //到这里如果已经处理过的节点就不予计算了，因为拓扑序和悲观等待还有不存在环的原因，节点就应该被计算一次，所以处理过的
                    //节点就肯定是安全的节点，可以不用再重复处理了
                    if (processed.has(targetPath)) {
                        console.log(
                            `%c ⏭️ 跳过已处理: ${targetPath}`,
                            "color: #909399; font-style: italic;"
                        );
                        // 因为这个节点在被 push 进队列时，trace 已经认为它要执行了
                        // 如果跳过它，必须在这里手动把它 pop 掉，否则计数永远不会归零
                        trace.popExecution([targetPath]);
                        continue;
                    }
                    //此时到这里的肯定是可以被处理但是还没被处理的路径，加入正在处理列表
                    processingSet.add(targetPath);
    
                    if ((targetPath as string).includes('c14')) {
                        
                        const deps = dependency.GetAllPrevDependency(targetPath);
                        console.log(`c14 依赖状态:`, deps.map(d => ({ path: d, done: processed.has(d) })));
                    }
                    executorNodeCalculate(task);
    
                }
            }finally{
                isLooping = false;
                
            }
            
        }

         flushQueue();

    }

    return  TaskRunner ;
}


export {useMeshTask}