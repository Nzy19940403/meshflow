import { SchemaBucket } from "../bucket";

function useMeshTask<T extends string>(
    dependency: {
        GetAllNextDependency: (p: T) => T[],
        GetAllPrevDependency: (p: T) => T[],
        GetPrevDependency: (p: T) => T[],
        GetNextDependency: (p: T) => T[],
        GetDependencyOrder: () => T[][],
        GetPathToLevelMap: () => Map<T, number>
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
        AllAffectedPaths.add(triggerPath)

        const queueCountMap = new Map<T, number>();
        //悲观队列，如果一个path的直接上游并没有被纳入计算但是这个path本身已经被影响，之前是乐观的直接计算，但是由于镜像依赖问题，
        //导致计算会拿到过期的数据，新数据更新之后没法继续更新了，所以加入悲观队列先挂起，最后再入队
        // 💡打算改造 悲观区：存储 path -> 剩余阻力值 (pendingParentsCount)
        const stagingArea = new Map<T, number>();

        let lastYieldTime = performance.now();

        // 获取初始水位线（触发点所在层级）
        const pathToLevelMap = dependency.GetPathToLevelMap();
        const triggerLevel = pathToLevelMap.get(triggerPath) ?? 0;
        let currentLevel = triggerLevel;

        AllAffectedPaths.forEach(path => {
            if (path === triggerPath) return;
            if (initialNodes.includes(path)) return;

            const directParents = dependency.GetPrevDependency(path);
            const effectParentsCount = directParents.filter(p => AllAffectedPaths.has(p)).length;
            if (effectParentsCount > 0) {
                stagingArea.set(path, effectParentsCount);
            }
        })
        processed.add(triggerPath);


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

            const { target: targetPath, trigger: currentTriggerPath } = task;

            try {
                if (currentExecutionToken.get(triggerPath) !== curToken) return;
              
                let hasValueChanged = false;
                let notifyNext = false;
                const targetSchema = data.GetRenderSchemaByPath(targetPath);
                console.log(`%c ✅ 计算完成: ${targetPath}` + "当前值:", targetSchema.defaultValue, "color: #67c23a;");

                for (let bucketName in targetSchema.nodeBucket) {
                    const bucket = targetSchema.nodeBucket[bucketName] as SchemaBucket;

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

                        console.log(`🚫 令牌过期，丢弃${targetPath}旧任务计算结果`);
                        return; // 不要执行 processed.add，不要触发 hasValueChanged
                    }

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
                    // if (currentExecutionToken.get(triggerPath) !== curToken) {

                    //     console.log(`🚫 令牌过期，丢弃${targetPath}旧任务计算结果`);
                    //     return; // 不要执行 processed.add，不要触发 hasValueChanged
                    // }
                    if (bucket.isForceNotify()) {
                        notifyNext = true;
                    }
                    if (hasValueChanged) {
                        trigger.flushPathSet.add(targetPath as any);
                    }
                    processed.add(targetPath);
                    const directChildren = dependency.GetNextDependency(targetPath);
                    // 1. 如果值变了，扩充疆域（这是为了让更深层的节点能正确进入暂存区）
                    if (hasValueChanged || notifyNext) {
                        const allNextOrder = dependency.GetAllNextDependency(targetPath);
                        allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                    }
                    for (const child of directChildren) {
                        if (processed.has(child)) {
                            console.log(`🧊 [拦截] 下游 ${child} 已由其他路径处理`);
                            continue; 
                        }
                        // 2. 关键分歧点：看当前节点是否产生了“影响力”
                        if (hasValueChanged || notifyNext) {
                            // --- 【强影响】下游必须进入悲观区并尝试救赎 ---

                            // 如果孩子不在悲观区，先送进去并计算它在波及名单内的阻力
                            if (!stagingArea.has(child) && !processed.has(child) && !queueCountMap.has(child)) {
                                const effectParentsCount = dependency.GetPrevDependency(child)
                                    .filter(p => AllAffectedPaths.has(p)).length;
                                stagingArea.set(child, effectParentsCount);
                            }

                            // 尝试减阻力
                            const currentResistance = stagingArea.get(child) ?? 0;
                            const newResistance = Math.max(0, currentResistance - 1);

                            if (newResistance <= 0) {
                                stagingArea.delete(child);
                                queue.push({ target: child, trigger: targetPath, isReleased: true });
                                queueCountMap.set(child, 1);
                              
                                trace.pushExecution([child]);
                                console.log(`🔥 [强拉动] ${targetPath} 值变了，释放下游: ${child}`);
                            } else {
                                stagingArea.set(child, newResistance);
                            }
                        } else {
                            // --- 【弱影响】值没变，下游不入悲观区，不减阻力 ---
                            // 它们现在只是 AllAffectedPaths 里的一个“标记”，
                            // 等待 flushQueue 的水位线步进或者其他变动的路径来捞它们
                            console.log(`🧊 [弱关联] ${targetPath} 值未变，${child} 仅更新疆域，原地待命`);
                        }
                    }

                }

                // processed.add(targetPath);
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
                    console.log(`[释放Processing] - ${targetPath} | 剩余Size: ${processingSet.size - 1}`);
                    processingSet.delete(targetPath);
                    trace.popExecution([targetPath]);

                    // 关键点 2：点火！
                    // 当 A2 算完，它尝试去叫醒可能正在“休眠”的 flushQueue
                    // 由于你有 isLooping 锁，如果 while 还在转，这一句会被 return，不产生副作用
                    // 如果 while 已经退出了，这一句会重新激活循环，去处理 A3, B2 等下游
                    if (!isLooping) {
                        // console.log(`[点火] 🔥 异步任务回执，重启扫描: ${targetPath}`);
                        flushQueue();
                    }

                }

            }



        }

        const flushQueue = async () => {
            // 1. 令牌与状态锁检查
            if (currentExecutionToken.get(triggerPath) !== curToken) {
                isLooping = false;
                return;
            }

            isLooping = true;

            try {
                // --- 核心控制循环 ---
                // 准入条件：队列有任务 OR 悲观区有待释放的任务
                while (queue.length > 0 || stagingArea.size > 0) {
                    if (currentExecutionToken.get(triggerPath) !== curToken) break;


                     

                    // --- 情况 1：优先消费队列 ---
                    if (queue.length > 0) {

                        // 并发上限检查
                        if (processingSet.size >= MAX_CONCURRENT_TASKS) {
                            isLooping = false;
                            return; // 熄火，等待点火
                        }

                        const task = queue.shift()!;
                        const { target: targetPath } = task;

                        if (processed.has(targetPath)) {
                            console.warn(`[拦截] 🛡️ 拒绝重入: ${targetPath} | 原因: 已计算完成`);
                            // trace.popExecution([targetPath]);
                            continue;
                        }

                        console.log(`[调度] 📥 出队: ${targetPath} | 来源: ${task.isReleased ? '救赎/拉动' : '初始'} | 剩余: ${queue.length}`);
                        // 记账逻辑


                        const currentCount = queueCountMap.get(targetPath) || 0;
                        if (currentCount <= 1) queueCountMap.delete(targetPath);
                        else queueCountMap.set(targetPath, currentCount - 1);

                       

                        // 检查水位线准入
                        const pLevel = pathToLevelMap.get(targetPath) ?? 0;
                        if (pLevel > currentLevel + 1 && !task.isReleased) {
                            console.log(`[强制拦截] ${targetPath} 层级太深(${pLevel})，当前水位(${currentLevel})，移入悲观区`);
                            stagingArea.set(targetPath, 1); // 重新入悲观区确权
                            continue;
                        }

                        processingSet.add(targetPath);
                        console.log(`[锁定Processing] + ${targetPath} | 当前Size: ${processingSet.size} | 成员: ${Array.from(processingSet).join(',')}`);
                        // currentLevel = Math.max(currentLevel, pLevel);
                        
                     
                        trace.pushExecution([targetPath]);
                        executorNodeCalculate(task); // 异步启动
                        continue; // 只要队列还有，就一直跑
                    }

                    // --- 情况 2：队列空了，检查是否满足“熄火等待”条件 ---
                    // 💡 严格熄火规定：队列干了，但还有异步任务在飞，必须立刻退出
                    if (processingSet.size > 0) {
                        console.log(`[熄火拦截] 队列空但有任务在飞 | 正在飞: ${Array.from(processingSet).join(',')} | 拦截水位线推进`);
                        isLooping = false;
                        return; // 流程真正熄火，靠 finally 里的点火唤醒
                    }

                    // --- 情况 3：系统全静默（Queue空且Processing空），扫描悲观区救赎 ---
                    if (stagingArea.size > 0) {
                        console.log(`%c ⚡ 系统静默，扫描悲观区... 层级: ${currentLevel}`, "color: #9c27b0;");

                        let liberated = false; // 标志位：本轮是否成功救出任务
                        const toRelease: T[] = [];

                        // 1. 扫描悲观区，寻找可以释放的节点
                        for (const [path] of stagingArea) {
                            const directParents = dependency.GetPrevDependency(path);
                            const isBlocked = directParents.some(p => {
                                if (processed.has(p)) return false; // 已完成，不阻塞
                                if (processingSet.has(p) || queueCountMap.has(p)) return true; // 正在跑或在队里，阻塞
                                if (AllAffectedPaths.has(p)) return true; // 在波及名单但还没跑，阻塞

                                const pLevel = pathToLevelMap.get(p) ?? 0;
                                return pLevel > currentLevel; // 父节点层级比当前水位高，阻塞
                            });

                            if (!isBlocked) toRelease.push(path);
                        }

                        // 2. 执行救赎
                        if (toRelease.length > 0) {
                            toRelease.forEach(p => {
                                stagingArea.delete(p);
                                queue.push({ target: p, trigger: triggerPath, isReleased: true });
                                queueCountMap.set(p, 1);
                                trace.pushExecution([p]);
                            });
                            liberated = true; // 成功救人
                            console.log(`🚀 [精准救赎] 释放节点: ${toRelease.join(',')}`);
                        }

                        // 3. 💡 核心逻辑：根据救赎结果决定下一步
                        if (liberated) {
                            // 既然救到了人，说明当前水位线还有活干
                            // 直接 continue 回到 while 顶部去消费 queue，不许推水位线
                            continue;
                        } else {
                            // --- 走到这里，说明【当前水位线下】已经捞不到任何任务了 ---

                            // 检查是否还有活跃的上游依赖（那些在名单里但还没跑完的）
                            const hasPendingActiveDeps = Array.from(stagingArea.keys()).some(path => {
                                const parents = dependency.GetPrevDependency(path);
                                return parents.some(p => AllAffectedPaths.has(p) && !processed.has(p));
                            });

                            if (hasPendingActiveDeps) {
                                // 如果还有 B2 这种任务在名单里没进 processed，说明还在等点火
                                // 此时必须强制熄火，严禁推水位线！
                                console.log(`⏳ 尚有活跃依赖 未完成，水位线锁定在 ${currentLevel}`);
                                isLooping = false;
                                return;
                            }
                            // console.log(`[水位] 📈 推进至 Level ${currentLevel + 1} | 理由: 当前层级无待处理任务`);
                            // 只有【彻底没救到人】且【没有活跃依赖】时，才允许推水位线
                            currentLevel++;
                            console.log(`📈 水位线推移至: ${currentLevel}`);

                            if (currentLevel > 2000) {
                                break;
                            }
                            // 水位线变了，continue 回去，下一轮 while 会用新水位重新扫描悲观区
                            continue;
                        }
                    }
                }
            } finally {
                isLooping = false;
                console.log(`[熄火] 💤 全场静默，等待异步任务降落...`);
            }
        };

        flushQueue();

    }

    return TaskRunner;
}


export { useMeshTask }