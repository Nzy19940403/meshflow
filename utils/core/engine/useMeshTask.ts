 
// import { SchemaBucket } from "./bucket";
import {createScheduler} from '../utils/util'
import {  MeshPath,MeshEmit } from "./useEngineManager"
function useMeshTask<P extends MeshPath>(
    config:{
        useGreedy:boolean
    },
    dependency: {
        GetAllNextDependency: (p: P) => P[],
        GetAllPrevDependency: (p: P) => P[],
        GetPrevDependency: (p: P) => P[],
        GetNextDependency: (p: P) => P[],
        GetDependencyOrder: () => P[][],
        GetPathToLevelMap: () => Map<P, number>
    },
    data: {
        GetNodeByPath: (p: P) => any
    },
    hooks:{
        callOnError:any,
        callOnSuccess:any,
        callOnStart:any,
        emit:MeshEmit
    },
    uitrigger: {
        requestUpdate: () => void,
        flushPathSet: Set<P>
    }
) {
    const currentExecutionToken: Map<P, symbol> = new Map();

    const isGreedy = config.useGreedy;
    
    const scheduler = createScheduler();

    //运行调用入口
    const TaskRunner = async (
        triggerPath: P,
        initialNodes: P[]
    ) => {
        //最大并发数
        const MAX_CONCURRENT_TASKS = 5;

        const curToken = Symbol("token");

        currentExecutionToken.set(triggerPath, curToken);

        let isLooping = false; // 状态锁：标志 while 循环是否在运行

        //scheduler重置
        scheduler.reset();

        // const changedPaths = new Set<P>() //所有产生变化的或者是设置notifyNext的路径
        const processed = new Set<P>();
        const processingSet = new Set<P>();
        const AllAffectedPaths = new Set<P>(
            dependency.GetAllNextDependency(triggerPath)
        );
        AllAffectedPaths.add(triggerPath);
        // changedPaths.add(triggerPath);

        // const queueCountMap = new Map<P, number>();
         //等待执行区,直接上游发生变化了会把节点加入这里
        const stagingArea = new Map<P, number>();
        // 等待捕捞区,上游没有变但是不好直接扔所以把这个先扔在这里等待捕捞
        const resureArea = new Map<number,Set<P>>();

        // let lastYieldTime = performance.now();

        // 🔥 优化 1：零阻力缓冲区 (Set 保证唯一性)
        const readyToRunBuffer = new Set<P>();

        // // 🔥 优化 2：预计算汇聚点和静态层级（避免在循环中高频调用函数）
        // const mergeNodeSet = new Set<P>();
 
        // 获取初始水位线（触发点所在层级）
        const pathToLevelMap = dependency.GetPathToLevelMap();
        const triggerLevel = pathToLevelMap.get(triggerPath) ?? 0;
        let currentLevel = triggerLevel;
        let maxAffectedLevel = 0;
        const updateWatermark = (path: P) => {
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
 
        //调用开始钩子
        hooks.callOnStart({
            path:triggerPath,
        }); 

        let isFlowFinished = false;

        //背压参数
        const BACKPRESSURE_LIMIT = 30;  
      

        const executorNodeCalculate =  (task: { target: P; trigger: P;  }) => {
            const { target: targetPath, trigger: currentTriggerPath } = task;
            let hasValueChanged = false;
            let notifyNext = false;
            const targetSchema = data.GetNodeByPath(targetPath);

            // 收集所有的异步 Promise
            const pendingPromises: Promise<void>[] = [];
            // 这个函数只负责：减阻力 -> 判断归零 -> 入队
            //reasontype -> 1:上游 ${targetPath} 值变了 2: 当上游值没有变但是下游节点已经在stagingArea的时候`上游 ${targetPath} 完成(穿透)`
            const tryActivateChild = (child: P, reasonType: number) => {
                // 1. 如果已经处理过或正在处理，直接忽略
                if (processed.has(child) || processingSet.has(child) || readyToRunBuffer.has(child)) {
                    // 这里可以 emit 一个 intercept，但对于性能优化可以省略
                    return;
                }
                let newResistance = 0;
                const childLevel = pathToLevelMap.get(child) ?? 0;
                // 2. 阻力计算策略：惰性初始化 vs 递减
                if (!stagingArea.has(child)) {
                   
                    if (childLevel > currentLevel && stagingArea.size > BACKPRESSURE_LIMIT) {
                        if (!resureArea.has(childLevel)) resureArea.set(childLevel, new Set());
                        resureArea.get(childLevel)!.add(child);

                      
                        
                        hooks.emit('node:intercept', { 
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

            // --- 3. 提取公共逻辑：收尾工作 (对应原来的 finally 块) ---
            // 无论是同步跑完，还是异步 catch/then 跑完，最后都必须走这里
            const finalizeExecution = (effects:Array<{fn:(args:any[])=>any,args:Array<string>}>=[]) => {
                // 再次检查令牌（防止异步期间被废弃）
                if (currentExecutionToken.get(triggerPath) !== curToken) return;
                
                // 此时所有的 Bucket 都算完了（同步的已更新，异步的已 await）
                // 开始处理下游激活逻辑 (Dependency Propagation)
                

                if(effects.length){
                    let result:any = {};
                    for (let effect of effects) {
               
                
                        const argsObj = (effect.args || []).reduce((acc: any, key: string) => {
                            acc[key] = targetSchema[key];
                            return acc;
                        }, {});
                
              
                        try {
                            const patch = effect.fn(argsObj);
                            
                            // 如果副作用返回了有效的对象，合并到总补丁中
                            if (patch && typeof patch === 'object') {
                                Object.assign(result, patch);
                            }
                        } catch (e) {
                            console.warn(e);
                        }
                    }
                    for(let key in result){
                        targetSchema[key] = result[key]
                    }
                    //如果有副作用，不管怎么样都算值变更
                    hasValueChanged = true;
                }
                 
                if (hasValueChanged) uitrigger.flushPathSet.add(targetPath as any);

                hooks.emit('node:success', { path: targetPath });
                processed.add(targetPath);

                const directChildren = dependency.GetNextDependency(targetPath);

                // 3.1 扩充疆域 (AllAffectedPaths)
                if (hasValueChanged || notifyNext) {
                    const allNextOrder = dependency.GetAllNextDependency(targetPath);
                    allNextOrder.forEach((p: any) => AllAffectedPaths.add(p));
                    // if (hasValueChanged||notifyNext) updateWatermark(targetPath); 
                }

                // 3.2 激活下游 (Try Activate Children)
                for (const child of directChildren) {
                    if (processed.has(child)) {
                        hooks.emit('node:intercept', { path: child, type: 2 });
                        continue;
                    }
                    if (processingSet.has(child) || readyToRunBuffer.has(child)) {
                        hooks.emit('node:intercept', { path: child, type: processingSet.has(child) ? 3 : 3.1 });
                        continue;
                    }

                    const shouldFire = hasValueChanged || notifyNext;

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
                                hooks.emit('node:stagnate', { path: child, type: 1 });
                            }
                        }
                    }
                }

                // 3.3 清理现场 & 尝试点火 (Flush Queue)
                processingSet.delete(targetPath);

                // --- 4. 调度逻辑与 UI 点火 (嵌入在这里) ---
                const scheduleNext = async () => {
          
                    // 4.3 重启引擎 (Flush Queue)
                    if (!isLooping) {
                        const activenums = processingSet.size;
                        const pendingnums = readyToRunBuffer.size;
                        
                        hooks.emit('flow:fire', {
                            path: targetPath,
                            type: 1,
                            detail: { active: activenums, pending: pendingnums, blocked: stagingArea.size }
                        });
                        
                        flushQueue();
                    }
                };

                // 执行调度
                // 如果上面没有 await (即没有切片)，这里是同步执行的
                scheduleNext();
          
            };

            // --- 4. 提取公共逻辑：错误处理 (对应原来的 catch 块) ---
            const handleError =  (err: any) => {
                hooks.emit('node:error', { path: targetPath, error: err });

                const abortToken = Symbol("abort");
                currentExecutionToken.set(triggerPath, abortToken);

                // 物理清空
                readyToRunBuffer.clear();
                stagingArea.clear();
                processingSet.clear();
                
                hooks.callOnError(err);
                
                // 错误发生后，依然要执行收尾（清理 processingSet 等）
                  
            };
            // --- 5. 核心逻辑：处理单个桶的计算结果 ---
            // 这个函数囊括了原来循环体内的所有逻辑
            // let hasValueChanged = false;
            // let notifyNext = false;
            // const targetSchema = data.GetRenderSchemaByPath(targetPath);

            // // 收集所有的异步 Promise
            // const pendingPromises: Promise<void>[] = [];

            // 提取公共的处理结果逻辑
            const handleSingleResult = (result: any, bucketName: string) => {
                let isValueChanged = false;
                //这部分应该交给副作用处理
 
                // 值更新检查
                if (result !== targetSchema[bucketName]) {
                    targetSchema[bucketName] = result;
                    hasValueChanged = true;
                    hooks.emit('node:bucket:success', { path: targetPath, key: bucketName, value: result });
                    if (bucketName === 'value') {
                        isValueChanged = true;
                    }
                }
                
                const bucket = targetSchema.nodeBucket[bucketName];
                if (bucket.isForceNotify()) notifyNext = true;
                // if (hasValueChanged) trigger.flushPathSet.add(targetPath as any);
                if(isValueChanged||notifyNext){
                    updateWatermark(targetPath)
                }
            };

            hooks.emit('node:start', { path: targetPath });
            
            try {
                // --- 循环遍历开始 ---
                //副作用列表
                const effectsToRun:Array<{fn:()=>any,args:Array<string>}> = [];
                for (let bucketName in targetSchema.nodeBucket) {
                    const bucket = targetSchema.nodeBucket[bucketName];
                    effectsToRun.push(...bucket.getSideEffect());
                    // 1. 启动计算
                    const resultOrPromise = bucket.evaluate({
                        affectKey: bucketName,
                        triggerPath: currentTriggerPath,
                        GetRenderSchemaByPath: data.GetNodeByPath,
                        GetValueByPath: (p: P) => data.GetNodeByPath(p).value,
                        GetToken: () => curToken
                    });
        
                    // 2. 嗅探结果类型
                    if (resultOrPromise instanceof Promise) {
                        // -> 异步：存起来，别 await，继续下一个循环
                        const promise = resultOrPromise.then((res: any) => {
                            // 异步回来后，依然要检查令牌
                            
                            if (currentExecutionToken.get(triggerPath) !== curToken) return;
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

   


        }
 
 
        const flushQueue = async () => {
            // 1. 令牌检查 (安全熔断)
            
            if (currentExecutionToken.get(triggerPath) !== curToken) {
                isLooping = false;
                return;
            }
        
            isLooping = true;
            let isFirstFrame = scheduler.getIsFirstFrame();
            let yieldCount = 0;
            // 1. 定义名额决策函数
            const getNodeQuota = () => {
                // A. 如果是非贪婪模式，名额给无限（由水位线逻辑自己控制节奏）
                if (!isGreedy) return Infinity; 
                
                // B. 如果是性能模式（贪婪模式下），名额给大一些，比如一帧跑 100 个
                // if (isPerformanceMode) return 100; 

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
                    if (currentExecutionToken.get(triggerPath) !== curToken) break;
                    
                    // ==========================================================
                    // 🔥 修改点 1：双重检查 (时间到了 OR 数量够了 -> 都要休息)
                    // ==========================================================
                    
                    const isQuotaExceeded = nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME;
                    const isTimeExceeded = scheduler.shouldYield();
                 
                    if (isQuotaExceeded || isTimeExceeded) {
                        // 只有在真的做过计算后，才申请更新 UI
                        if (nodesProcessedInFrame > 0 ) {
                            yieldCount++;
                            const shouldUpdateUI = isFirstFrame || (yieldCount % 2 === 0);
                            if(shouldUpdateUI){
                                uitrigger.requestUpdate();
                            }
                            
                        }

                        await scheduler.yieldToMain();
                        
                        // 醒来后检查令牌
                        if (currentExecutionToken.get(triggerPath) !== curToken) break;
                        
                        // 🔥 关键：睡醒了，重置计数器，开始新的一帧
                        nodesProcessedInFrame = 0;

                        isFirstFrame = scheduler.getIsFirstFrame()
                    }

                    if (readyToRunBuffer.size > 0 && processingSet.size < MAX_CONCURRENT_TASKS) {
                
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
                            
                            // 🔥 修改点 3：增加计数
                            nodesProcessedInFrame++;

                            // 🔥 修改点 4：微操检查
                            // 如果刚算完这个，发现名额满了或者时间到了，立刻停
                            if (nodesProcessedInFrame >= NODE_QUOTA_PER_FRAME || scheduler.shouldYield()) {
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
                    if (nodesProcessedInFrame < NODE_QUOTA_PER_FRAME && isGreedy && stagingArea.size > 0 && processingSet.size < MAX_CONCURRENT_TASKS) {
                        
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
                                hooks.emit('node:release', { path, type: 4 });

                                if (releasedCount >= NODE_QUOTA_PER_FRAME) break;
                            }
                        };
                        if (releasedCount > 0) continue;

                        if (foundGreedy) {
                            // 🚨 修复点：在 continue 之前，必须再次检查时间片！
                            // 如果已经超时，不能 continue 去跑新任务，必须 break 出去让位
                            if (scheduler.shouldYield()) {
                                await scheduler.yieldToMain();
                                if (currentExecutionToken.get(triggerPath) !== curToken) break;
                            }
                            continue; 
                        }
                    

                        
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
                    if (currentExecutionToken.get(triggerPath) === curToken && !isFlowFinished)  {
                        isFlowFinished = true;
                        hooks.emit(
                            'flow:end',
                            {
                                type:1
                            }
                        );
                        uitrigger.requestUpdate();
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