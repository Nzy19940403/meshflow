import { createConsola } from "consola";
import { MeshFlowEventsName, MeshEvents, MeshPath } from "@meshflow/core";

type LoggerEventName = keyof MeshEvents;

const locales: any = {
    zh: {
        tags: {
            engineStart: '⚡ MeshFlow 异步响应引擎启动',
            processing: '🛰️ [Processing]',
            start: '🚀 CAUSAL',      
            revive: '📜 RESOLVE',    
            ripple: '💥 RIPPLE',     
            success: '✅ OK',
            update: '📝 UPDATE',
            error: '❌ ERR',
            release: '🌊 [Release]',
            intercept: '🛑 [Intercept]',
            stagnate: '🧊 [Stagnate]',
            wait: '💤 PEND',
            entag: '🌀 ENTAG',
            limit: '🛑 LIMIT',
            fire: '🔥 [Fire]',
            end: '🛑 [End]',
            flowSuccess: '🎉 [Flow Success] 耗时:',
            flowAbortTitle: '🛑 [并发脉冲合并/中止]',
            abortCount: (count: number) => `(${count} 条冲突链路)`,
            abortItem: '⊘ 静默',
            external: '⚡ EXTERNAL',
            quantum: '🌌 QUANTUM',
        },
        reports: {
            nodesTrace: (count: number) => `📦 [Mesh Trace] 节点执行序列 (共 ${count} 步)`,
            causalMutations: (count: number) => `📝 [DAG Flow] 常规拓扑属性变更 (${count}条)`, 
            entangleMutations: (count: number) => `🌀 [Entangle Flow] 纠缠状态属性变更 (${count}条)`, 
            security: (total: number) => `🛡️ [Engine Defense] 拦截与调度核心审计 (${total}条)`,
            scheduler: (count: number) => `⏱️ [Scheduler Trace] 引擎运转记录 (${count}条)`,
            entangle: (count: number) => `🌀 [Logic Clamping] 触发了 ${count} 次强制熔断`,
            hotspotsTitle: ()=>'🔥 熔断靶心节点 (Top 5 受害者):',
            hotspotItem: (time: any, ratio: any) => `耗时: ${time}ms (约占流汇总时间的 ${ratio}%)`,
            streamTitle: '📝 详细解析流水:',
            barrierMatrix: '➔ Barrier Matrix (拦截防线):',
            microTasks: '➔ Scheduler Micro-tasks (微任务流):',
            hotspotTableTarget: '节点 (Target)',
            hotspotTableCount: '触发强制熔断次数',
            revivedBy: (path: string, trigger: string) => `${path} 被 ${trigger} 唤醒`,
            entangleBlocked: (obs: string, tar: string) => `🚫 [Blocked] 链路死循环/逻辑阻断: ${obs} ➔ ${tar}`,
            entangleWarn: (path: string, type: string) => type === 'no_keys' 
                ? `⚠️ [Config Error] 缺失触发键: ${path}`
                : `⚠️ [Level Error] 节点未分配层级: ${path}`
        },
        // 🌟 核心修改 1：全部改为接收 (detail, triggerPath) 两个参数
        release: { 
            1: (d: any, tPath: any) => `来源 [${tPath || '未知'}] 变更`, 
            2: (d: any, tPath: any) => `来源 [${tPath || '未知'}] 响应完成`, 
            3: (d: any, tPath: any) => `水位推进至 L${d?.level}，释放节点`, 
            4: (d: any, tPath: any) => `贪婪模式强制推进 ↤ (源: [${tPath || '未知'}])` 
        },
        intercept: { 
            1: (d: any, tPath: any) => '令牌失效', 
            2: (d: any, tPath: any) => '状态已定型', 
            3: (d: any, tPath: any) => '节点忙 (Processing)，忽略触发', 
            3.1: (d: any, tPath: any) => '已在队列中 (Ready)，忽略触发', 
            4: (d: any, tPath: any) => `等待上游解析 (L${d?.targetLevel}>L${d?.currentLevel})`, 
            5: (d: any, tPath: any) => `屏障拦截挂起 (L${d?.currentLevel} ➔ L${d?.targetLevel})`, 
            6: (d: any, tPath: any) => `无影响，链路收敛`, 
            7: (d: any, tPath: any) => `背压保护拦截` 
        },
        stagnate: { 
            1: (d: any, tPath: any) => '静默挂起入弱信号区', 
            2: (d: any, tPath: any) => `屏障激活，禁止渗透` 
        },
        flowWait: { 1: () => `系统等待节点定型...`, 2: () => `并发上限，暂停分发`, 3: (d: any) => `等待 ${d?.asyncNums || 0} 个邻里效应收敛...` },
        flowFire: { 1: (d: any) => `调度反馈: ${d?.active} 活跃, ${d?.pending} 缓冲, ${d?.blocked} 挂起.` },
        flowEnd: { 1: () => `流结束，系统回归静默状态。` },
        timeline: {
            transStep: (path: string) => `事务接力 ➔ [${path}]`,
            transProgress: (time: string) => `子任务收敛 (净耗时: ${time}ms) ➔ 移交接力棒`,
            transLog: (time: string) => `[🔗 TRANSACTION] 异步履约成功 (${time}ms), 发车.`,
            epochChange: '系统进行量子迭代，重算不稳定链路',
            epochTree: (epoch: number) => `▽ EPOCH ${epoch} 演化阵列`,
            cacheHit: (key: string) => `⚡ 缓存命中 ➔ [${key}]`,
            triggerEval: (key: string) => `🔥 触发重算 ➔ [${key}]`,
            cause0: '上游变更触发自然点火',
            cause1: '接收反向对账提案',
            cause2: '顺向推导连锁余波',
            cause3: '天神下凡：外部强行注入状态',
            label0: 'CAUSAL (顺向推导)',
            label1: 'RESOLVE (量子预言)',
            label2: 'RIPPLE (连锁余波)',
            label3: 'EXTERNAL (第一推动)',
            success: '计算完成，提交稳态',
            revive: '被神谕强制唤醒',
            deadlock: (obs: string, tar: string) => `死循环链: [${obs}] ➔ [${tar}], 强制熔断`,
            emitProphecy: (target: string, keys: string) => `🌌 发射量子预言 ➔ 靶心: [${target}] (触发键: ${keys})`,
            phaseEval: '[E 执行]',
            phaseProp: '[P 提案]',
            phaseRpl:  '[R 余波]',
            phaseSrc:  '[S 源头]',
            phaseDone: '[F 结算]',
            phaseSch:  '[Q 调度]'
        },
        diff: {
            init: (val: string) => `✨ [初始化] ➔ ${val}`,
            refOnly: (count: number) => `⚠️ [纯引用变化] 实质内容未变 (共 ${count} 键)`,
            add: '+新增',
            del: '-删除',
            mod: '~修改',
            obj: (oldC: number, newC: number, details: string) => `[对象微调] (${oldC}keys➔${newC}keys) | ${details}`,
            mut: (oldV: string, newV: string) => `[变更] ${oldV} ➔ ${newV}`,
            keep: (val: string) => `[~维持] ${val}`
        },
        tables: {
            epoch: 'Epoch (纪元)',
            node: 'Node (节点)',
            key: 'Key (属性)',
            diff: 'Value Diff (状态位移)',
            cause: 'Cause (触发/因果)',
            valExt: '🌍 EXTERNAL (首推)',
            valCau: '🚀 CAUSAL (顺流)',
            valRes: '📜 RESOLVE (预言)',
            valRip: '💥 RIPPLE (余波)',
            evtClamp: 'Clamping (强制熔断)',
            colObs: 'Observer (观察者)',
            colTar: 'Target (靶心)'
        }
    },
    en: {
        tags: {
            engineStart: '⚡ MeshFlow Asynchronous Reactive Engine Started',
            processing: '🛰️ [Processing]',
            start: '🚀 CAUSAL',      
            revive: '📜 RESOLVE',    
            ripple: '💥 RIPPLE',     
            success: '✅ OK',
            update: '📝 UPDATE',
            error: '❌ ERR',
            release: '🌊 [Release]',
            intercept: '🛑 [Intercept]',
            stagnate: '🧊 [Stagnate]',
            wait: '💤 PEND',
            entag: '🌀 ENTAG',
            limit: '🛑 LIMIT',
            fire: '🔥 [Fire]',
            end: '🛑 [End]',
            flowSuccess: '🎉 [Flow Success] Duration:',
            flowAbortTitle: '🛑 [Concurrent Pulse Merged/Aborted]',
            abortCount: (count: number) => `(${count} conflicting paths)`,
            abortItem: '⊘ Silent',
            external: '⚡ EXTERNAL',
            quantum: '🌌 QUANTUM',
        },
        reports: {
            nodesTrace: (count: number) => `📦 [Mesh Trace] Topology Execution Sequence (${count} steps)`,
            causalMutations: (count: number) => `📝 [DAG Flow] Standard Causal Mutations (${count} entries)`, 
            entangleMutations: (count: number) => `🌀 [Entangle Flow] Quantum State Mutations (${count} entries)`, 
            security: (total: number) => `🛡️ [Engine Defense] Interception & Scheduling Audits (${total} entries)`,
            scheduler: (count: number) => `⏱️ [Scheduler Trace] Engine execution logs (${count} entries)`,
            entangle: (count: number) => `🌀 [Logic Clamping] Triggered ${count} forced clampings`,
            hotspotsTitle: ()=>'🔥 Clamping Hotspots (Top 5 Affected Nodes):',
            hotspotItem: (time: any, ratio: any) => `Duration: ${time}ms (~${ratio}% of total flow)`,
            streamTitle: '📝 Detailed Parsing Stream:',
            barrierMatrix: '➔ Barrier Matrix:',
            microTasks: '➔ Scheduler Micro-tasks:',
            hotspotTableTarget: 'Node (Target)',
            hotspotTableCount: 'Forced Clamping Count',
            revivedBy: (path: string, trigger: string) => `${path} revived by ${trigger}`,
            entangleBlocked: (obs: string, tar: string) => `🚫 [Blocked] Cyclic Deadlock / Logical Interception: ${obs} ➔ ${tar}`,
            entangleWarn: (path: string, type: string) => type === 'no_keys' 
                ? `⚠️ [Config Error] Missing trigger keys: ${path}`
                : `⚠️ [Level Error] Node level unassigned: ${path}`
        },
        // 🌟 核心修改 2：英文对齐参数
        release: { 
            1: (d: any, tPath: any) => `Source [${tPath || 'unknown'}] mutated`, 
            2: (d: any, tPath: any) => `Source [${tPath || 'unknown'}] response finalized`, 
            3: (d: any, tPath: any) => `Watermark advanced to L${d?.level}, releasing node`, 
            4: (d: any, tPath: any) => `Greedy mode forced advancement (Source: [${tPath}])` 
        },
        intercept: { 
            1: (d: any, tPath: any) => 'Token invalidated', 
            2: (d: any, tPath: any) => 'State finalized', 
            3: (d: any, tPath: any) => 'Node busy (Processing), ignoring trigger', 
            3.1: (d: any, tPath: any) => 'Already in queue (Ready), ignoring trigger', 
            4: (d: any, tPath: any) => `Awaiting upstream resolution (L${d?.targetLevel} > L${d?.currentLevel})`, 
            5: (d: any, tPath: any) => `Barrier interception suspended (L${d?.currentLevel} ➔ L${d?.targetLevel})`, 
            6: (d: any, tPath: any) => `No impact, path converged`, 
            7: (d: any, tPath: any) => `Backpressure protection intercept` 
        },
        stagnate: { 
            1: (d: any, tPath: any) => 'Silently suspended into weak signal zone', 
            2: (d: any, tPath: any) => `Barrier activated, penetration forbidden` 
        },
        flowWait: { 1: () => `System waiting for node finalization...`, 2: () => `Concurrency limit reached, suspending distribution`, 3: (d: any) => `Waiting for ${d?.asyncNums || 0} neighborhood effects to converge...` },
        flowFire: { 1: (d: any) => `Scheduler feedback: ${d?.active} active, ${d?.pending} pending, ${d?.blocked} blocked.` },
        flowEnd: { 1: () => `Flow ended, system returned to silent state.` },
        timeline: {
            transStep: (path: string) => `Transaction Relay ➔ [${path}]`,
            transProgress: (time: string) => `Sub-task Converged (Net time: ${time}ms) ➔ Relay Handover`,
            transLog: (time: string) => `[🔗 TRANSACTION] Async fulfillment success (${time}ms), dispatching.`,
            epochChange: 'System quantum iteration, recalculating unstable links',
            epochTree: (epoch: number) => `▽ EPOCH ${epoch} Evolution Array`,
            cacheHit: (key: string) => `⚡ Cache hit ➔ [${key}]`,
            triggerEval: (key: string) => `🔥 Triggered eval ➔ [${key}]`,
            cause0: 'Upstream mutation triggered natural ignition',
            cause1: 'Received reverse reconciliation proposal',
            cause2: 'Forward derivation chain ripple',
            cause3: 'Deus ex machina: External forced state injection',
            label0: 'CAUSAL',
            label1: 'RESOLVE',
            label2: 'RIPPLE',
            label3: 'EXTERNAL',
            success: 'Computation complete, steady state committed',
            revive: 'Forced awakening by Oracle',
            deadlock: (obs: string, tar: string) => `Deadlock chain: [${obs}] ➔ [${tar}], forced clamping`,
            emitProphecy: (target: string, keys: string) => `🌌 Emitting Quantum Prophecy ➔ Target: [${target}] (via: ${keys})`,
            phaseEval: '[E EVAL]',
            phaseProp: '[P PROP]',
            phaseRpl:  '[R RPL]',
            phaseSrc:  '[S SRC]',
            phaseDone: '[F DONE]',
            phaseSch:  '[Q SCHD]'
        },
        diff: {
            init: (val: string) => `✨ [Init] ➔ ${val}`,
            refOnly: (count: number) => `⚠️ [Ref Only] No substantive change (${count} keys)`,
            add: '+Add',
            del: '-Del',
            mod: '~Mod',
            obj: (oldC: number, newC: number, details: string) => `[Obj Tweak] (${oldC}keys➔${newC}keys) | ${details}`,
            mut: (oldV: string, newV: string) => `[Mutation] ${oldV} ➔ ${newV}`,
            keep: (val: string) => `[~Kept] ${val}`
        },
        tables: {
            epoch: 'Epoch',
            node: 'Node',
            key: 'Key',
            diff: 'Value Diff',
            cause: 'Cause',
            valExt: '🌍 EXTERNAL (Initial)',
            valCau: '🚀 CAUSAL (Downstream)',
            valRes: '📜 RESOLVE (Prophecy)',
            valRip: '💥 RIPPLE (Ripple)',
            evtClamp: 'Clamping',
            colObs: 'Observer',
            colTar: 'Target'
        }
    }
};

export interface LoggerOptions {
    locale?: 'zh' | 'en';
    foldFilter?: (path: MeshPath, calledBy: number) => boolean;
    focusPaths?: MeshPath | MeshPath[]; 
    ignorePaths?: MeshPath | MeshPath[]; 
    onLog?: (instruction: any) => void;
}

const logger = createConsola({ level: 3 });

const getBadgeArgs = (label: string, text: MeshPath, color: string, bgColor: string, dimText = false) => {
    return [
        `%c ${label} %c ${text as string} `, 
        `background: ${color}; color: #ffffff; border-radius: 4px 0 0 4px; padding: 3px 6px; font-weight: bold; font-size: 11px;`,
        `background: ${bgColor}; color: ${dimText ? '#909399' : color}; border-radius: 0 4px 4px 0; padding: 3px 6px; border: 1px solid ${color}; border-left: none; font-size: 11px; font-weight: bold;`
    ];
};

const printBadge = (label: string, text: MeshPath, color: string, bgColor: string, dimText = false) => {
    console.log(...getBadgeArgs(label, text, color, bgColor, dimText));
};

// 🌟 全局持久化缓存：用于做数据 Diff 对比
const globalStateCache = new Map<string, any>();

// 安全获取高精度时间戳
const getNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

const useLogger = (options: LoggerOptions = {}) => {
    const lang = options.locale || 'zh';
    const t = locales[lang] || locales['zh'];
    const shouldFold = options.foldFilter || ((path, calledBy) => calledBy !== 0);

    const focusTargets = options.focusPaths ? (Array.isArray(options.focusPaths) ? options.focusPaths : [options.focusPaths]) : [];
    const isFocusMode = focusTargets.length > 0;

    const ignoreTargets = options.ignorePaths ? (Array.isArray(options.ignorePaths) ? options.ignorePaths : [options.ignorePaths]) : [];

    // 🌟 修复 1：让 isNodeRelevant 变聪明，支持检查多个目标（比如靶心 targetPath）
    const isNodeRelevant = (...paths: (MeshPath | undefined | null)[]): boolean => {
        if (!isFocusMode) return true; 
        return paths.some(p => p && focusTargets.includes(p));
    };

    const apply = (api: any) => {
        let sessionSecurityLogs: any[] = [];
        let sessionNodeTrace: any[] = []; 
        let sessionCausalMutations: any[] = []; 
        let sessionEntangleMutations: any[] = []; 
        
        let sessionSchedulerLogs: string[] = []; 
        let sessionEntangleLogs: any[] = []; 
        let lastWaitStamp = ''; 

        let nodeStartTimes = new Map<string, number>();
        let nodeDurations = new Map<string, number>();

        let masterTimeline: any[][] = [];
        let currentEpoch = 0;

        let isFlowGroupActive = false; 
        const activeTokens = new Set<symbol>();
        const tokenToPath = new Map<symbol, MeshPath>(); 
        let abortedPaths: MeshPath[] = []; 
        let finalDurationStr = '';
        let flowRealStartTime = 0;
        let closeTimer: any = null; 

        let isCurrentFlowIgnored = false;
        let hasFocusNodeLogs = false;
        let currentFlowGroupInfo: { title: string, style: string } | null = null;

        let isTransactionActive = false; 

        const emitTrace = (action: string, path?: MeshPath, triggerPath?: MeshPath, targetPath?: MeshPath) => {
            if (!options.onLog || !path) return;
            if (isCurrentFlowIgnored) return;
            // 🌟 修复 2：只要 source、trigger、target 中有一个在监控列表，就放行指令！
            if (!isNodeRelevant(path, triggerPath, targetPath)) return; 
            
            const fromStr = triggerPath ? ` 来源:[${triggerPath as string}]` : '';
            const targetStr = targetPath ? ` 靶心:[${targetPath as string}]` : '';
        
            options.onLog(`[CMD] [${action}] [${path as string}]${fromStr}${targetStr}`);
        };

        const pushTimeline = (phase: string, icon: string, label: string, color: string, path: string, desc: string, triggerSource?: string) => {
            hasFocusNodeLogs = true;
            const sourceStr = triggerSource ? `   ↤ (源: ${triggerSource})` : '';
            masterTimeline.push([
                `%c E${currentEpoch} %c ${phase} %c ${icon} [${label}] %c [${path}] %c ${desc}%c${sourceStr}`,
                `background: #333; color: #fff; border-radius: 3px; padding: 1px 4px; font-size: 10px; margin-right: 4px;`,
                `background: #606266; color: #fff; border-radius: 3px; padding: 1px 4px; font-size: 10px; margin-right: 4px;`,
                `background: ${color}; color: #fff; border-radius: 3px; padding: 1px 4px; font-size: 10px; font-weight: bold; margin-right: 4px;`,
                `color: #58b9ff; font-weight: bold;`,
                `color: #dcdfe6;`,
                `color: #909399; font-style: italic;`
            ]);
        };

        const on = <K extends LoggerEventName>(event: K, cb: (data: MeshEvents[K]) => void) => { api.on(event, cb); };

        on(MeshFlowEventsName.FlowStart, ({ path, token }) => {
            isCurrentFlowIgnored = ignoreTargets.includes(path as string);
            
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            activeTokens.add(token);
            tokenToPath.set(token, path);

            if (isTransactionActive) {
                if (isFocusMode) {
                    masterTimeline.push([
                        `%c 🔗 TRANSACTION STEP %c ${t.timeline.transStep(path as string)}`,
                        `background: #00bcd4; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;`,
                        `color: #00bcd4; font-weight: bold; font-style: italic;`
                    ]);
                }
                return;
            }

            if (isFlowGroupActive) return; 
            isFlowGroupActive = true;
            flowRealStartTime = getNow(); 

            sessionSecurityLogs = []; sessionNodeTrace = []; 
            sessionCausalMutations = []; sessionEntangleMutations = [];
            sessionSchedulerLogs = []; sessionEntangleLogs = []; 
            abortedPaths = [];
            nodeStartTimes.clear(); nodeDurations.clear(); 

            lastWaitStamp = ''; finalDurationStr = ''; 
            masterTimeline = []; currentEpoch = 0;
            hasFocusNodeLogs = false;
            
            currentFlowGroupInfo = {
                title: isFocusMode ? `%c🎯 [FOCUS MODE] 监控链路: ${focusTargets.join(', ')}` : `%c${t.tags.engineStart} ↤ 起源: [${path as string}]`,
                style: isFocusMode ? "color: #b3e19d; font-weight: bold; font-size: 13px; background: #1a2b3c; padding: 2px 5px;" : "color: #909399; font-weight: bold; font-size: 12px;"
            };
        });

        on(MeshFlowEventsName.TransactionProgress, ({ fromToken, toToken, duration }: any) => {
            isTransactionActive = true; 
            if (activeTokens.has(fromToken)) activeTokens.delete(fromToken);

            const timeStr = Number(duration).toFixed(2);
            if (isFocusMode) {
                masterTimeline.push([
                    `%c 🔗 PROGRESS %c ${t.timeline.transProgress(timeStr)}`,
                    `background: #00bcd4; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;`,
                    `color: #00bcd4; font-weight: bold; font-style: italic;`
                ]);
            } else {
                sessionSchedulerLogs.push(t.timeline.transLog(timeStr));
            }
        });

        const tryCloseGroup = () => {
            if (activeTokens.size > 0 || !isFlowGroupActive) return;

            if (isCurrentFlowIgnored) {
                isFlowGroupActive = false; currentFlowGroupInfo = null; finalDurationStr = ''; tokenToPath.clear(); return;
            }

            let hasContent = (isFocusMode && hasFocusNodeLogs) || (!isFocusMode && (sessionNodeTrace.length > 0 || sessionCausalMutations.length > 0 || sessionEntangleMutations.length > 0 || sessionEntangleLogs.length > 0 || sessionSecurityLogs.length > 0 || sessionSchedulerLogs.length > 0)) || abortedPaths.length > 0;
             
            if (hasContent && currentFlowGroupInfo) {
                console.groupCollapsed(currentFlowGroupInfo.title, currentFlowGroupInfo.style);

                if (abortedPaths.length > 0) {
                    console.groupCollapsed(`%c${t.tags.flowAbortTitle} %c${t.tags.abortCount(abortedPaths.length)}`, "color: #F56C6C; font-weight: bold; font-size: 11px;", "color: #909399; font-style: normal;");
                    abortedPaths.forEach(p => console.log(`%c ${t.tags.abortItem} %c ${p as string} `, "color: #F56C6C; font-size: 10px;", "color: #909399;"));
                    console.groupEnd();
                }

                if (isFocusMode) {
                    masterTimeline.forEach(args => console.log(...args));
                } else {
                    if (sessionNodeTrace.length > 0) {
                        console.groupCollapsed(`%c${t.reports.nodesTrace(sessionNodeTrace.length)}`, "color: #00bcd4; font-weight: bold; font-size: 11px;");
                        let currentEpochForTree = -1;
                        sessionNodeTrace.forEach((trace: any, index: number) => {
                             if (trace.epoch !== currentEpochForTree) {
                                 console.log(`%c${t.timeline.epochTree(trace.epoch)}`, 'color: #909399; font-weight: bold; margin-top: 4px; border-bottom: 1px dotted #333;');
                                 currentEpochForTree = trace.epoch;
                             }
                             const isLast = index === sessionNodeTrace.length - 1 || sessionNodeTrace[index+1].epoch !== trace.epoch;
                             const prefix = isLast ? ' └─' : ' ├─';
                             console.log(`%c${prefix} ${trace.icon} [${trace.path}] %c${trace.causeLabel}`,
                                 'color: #dcdfe6; font-size: 11px;', 'color: #8e44ad; font-size: 10px; font-style: italic;');
                        });
                        console.groupEnd();
                    }

                    if (sessionCausalMutations.length > 0) {
                        console.groupCollapsed(`%c${t.reports.causalMutations(sessionCausalMutations.length)}`, "color: #67c23a; font-weight: bold; font-size: 11px;");
                        console.table(sessionCausalMutations); 
                        console.groupEnd();
                    }

                    if (sessionEntangleMutations.length > 0) {
                        console.groupCollapsed(`%c${t.reports.entangleMutations(sessionEntangleMutations.length)}`, "color: #8e44ad; font-weight: bold; font-size: 11px;");
                        console.table(sessionEntangleMutations); 
                        console.groupEnd();
                    }
                    
                    if (sessionEntangleLogs.length > 0) {
                        console.groupCollapsed(`%c${t.reports.entangle(sessionEntangleLogs.length)}`, "color: #F56C6C; font-weight: bold; font-style: italic; font-size: 11px;");
                        console.table(sessionEntangleLogs); 
                        console.groupEnd();
                    }

                    const totalDefenseItems = sessionSecurityLogs.length + sessionSchedulerLogs.length;
                    if (totalDefenseItems > 0) {
                        console.groupCollapsed(`%c${t.reports.security(totalDefenseItems)}`, "color: #909399; font-style: italic; font-size: 11px;");
                        if (sessionSecurityLogs.length > 0) {
                            console.log(`%c${t.reports.barrierMatrix}`, "color: #e6a23c; font-weight: bold; font-size: 10px;");
                            console.table(sessionSecurityLogs);
                        }
                        if (sessionSchedulerLogs.length > 0) {
                            console.log(`%c${t.reports.microTasks}`, "color: #909399; font-weight: bold; font-size: 10px;");
                            sessionSchedulerLogs.forEach(log => console.log(`  ${log}`));
                        }
                        console.groupEnd();
                    }
                }

                console.log(''); 
                
                if (!isFocusMode) {
                    const totalFlowTime = getNow() - flowRealStartTime;
                    const hotNodes = Array.from(nodeDurations.entries())
                        .filter(([_, time]) => time > 3)
                        .sort((a, b) => b[1] - a[1]);

                    if (hotNodes.length > 0) {
                        console.groupCollapsed(`%c${t.reports.hotspotsTitle(hotNodes.length)}`, "color: #F56C6C; font-weight: bold; font-size: 11px; border-bottom: 1px solid #F56C6C;");
                        hotNodes.forEach(([p, time], index) => {
                            const ratio = ((time / totalFlowTime) * 100).toFixed(1);
                            console.log(`%c ${index + 1}. [${p}] %c ${t.reports.hotspotItem(time.toFixed(2), ratio)}`, "color: #E6A23C; font-weight: bold;", "color: #909399;");
                        });
                        console.groupEnd();
                    }
                }

                if (finalDurationStr) logger.success(`${t.tags.flowSuccess} ${finalDurationStr}`);
                
                console.groupEnd(); 
            }

            isFlowGroupActive = false; currentFlowGroupInfo = null; finalDurationStr = ''; tokenToPath.clear();
        };

        const returnToken = (token: symbol, isSyncClose: boolean = false) => {
            if (!activeTokens.has(token)) return;
            activeTokens.delete(token);
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            if (isSyncClose) tryCloseGroup(); else closeTimer = setTimeout(tryCloseGroup, 10);
        };

        on(MeshFlowEventsName.FlowSuccess, ({ duration, token }) => {
            finalDurationStr = `${Number(duration).toFixed(2)}ms`; 
            isTransactionActive = false; 
            returnToken(token, true);
        });

        on(MeshFlowEventsName.FlowAbort, ({ token }) => {
            abortedPaths.push(tokenToPath.get(token) || 'unknown'); 
            isTransactionActive = false; 
            returnToken(token);
        });

        on(MeshFlowEventsName.NodeError, ({ path, error }) => {
            if (isCurrentFlowIgnored) return;
            if (isFlowGroupActive && currentFlowGroupInfo) console.groupCollapsed(currentFlowGroupInfo.title, currentFlowGroupInfo.style); 
            activeTokens.clear(); isTransactionActive = false; 
            printBadge(t.tags.error, path, '#F56C6C', '#3d1d1d', false);
            console.error(error);
            if (isFlowGroupActive && currentFlowGroupInfo) console.groupEnd();
            isFlowGroupActive = false;
        });

        on(MeshFlowEventsName.EntangleEpochChange, () => {
            if (isCurrentFlowIgnored) return;
            currentEpoch++;
            
            // 🌟 修复 3：向 VueFlow 明确发出跨越纪元的指令！
            if (options.onLog) {
                options.onLog(`[CMD] [EPOCH] [${currentEpoch}]`);
            }

            if (isFocusMode) {
                masterTimeline.push([
                    `%c 🌀 EPOCH ${currentEpoch} %c ${t.timeline.epochChange} `,
                    `background: #8e44ad; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;`,
                    `color: #8e44ad; font-weight: bold; font-style: italic;`
                ]);
            }
        });

        on(MeshFlowEventsName.NodeProcessing, (data) => {
            const { path, key } = data as any;
            const isCache = (data as any).isCache; 
            
            if (isCurrentFlowIgnored || !isFocusMode) return;
            
            // 🌟 修复 4：把 emitTrace 关进笼子里！没有真实 key 的无头扫描绝不通知 VueFlow！
            if (key && isNodeRelevant(path)) {
                emitTrace(isCache ? 'TASK_CACHE' : 'TASK_EVAL', path);
                
                if (isCache) pushTimeline(t.timeline.phaseEval, '💾', 'TASK_CACHE', '#909399', path as string, t.timeline.cacheHit(key));
                else pushTimeline(t.timeline.phaseEval, '⚙️', 'TASK_EVAL', '#E6A23C', path as string, t.timeline.triggerEval(key));
            }
        });

        on(MeshFlowEventsName.NodeStart, ({ path, calledBy }) => {
            if (isCurrentFlowIgnored) return;

            nodeStartTimes.set(path as string, getNow());

            const cause = calledBy ?? 0;
            const causeConfigs: Record<number, any> = {
                0: { phase: t.timeline.phaseEval, icon: '🚀', label: 'CAUSAL',  color: '#1a2b3c', desc: t.timeline.cause0 },
                1: { phase: t.timeline.phaseProp, icon: '📜', label: 'RESOLVE', color: '#8e44ad', desc: t.timeline.cause1 },
                2: { phase: t.timeline.phaseRpl, icon: '💥', label: 'RIPPLE',  color: '#e67e22', desc: t.timeline.cause2 },
                3: { phase: t.timeline.phaseSrc, icon: '🌍', label: 'EXTERNAL', color: '#f39c12', desc: t.timeline.cause3 }
            };
            
            const config = causeConfigs[cause] || causeConfigs[0];

            emitTrace(config.label, path);

            if (isFocusMode && isNodeRelevant(path)) {
                pushTimeline(config.phase, config.icon, config.label, config.color, path as string, config.desc);
            } 
        });

        on(MeshFlowEventsName.NodeBucketSuccess, ({ path, key, value, calledBy }) => {
            if (isCurrentFlowIgnored) return;
            
            const formatVal = (v: any) => (v !== null && typeof v === 'object') ? `{... ${Object.keys(v).length} keys}` : String(v);
            const cacheKey = `${String(path)}.${key}`;
            const oldVal = globalStateCache.get(cacheKey);
            const newValDisplay = formatVal(value);
            
            let diffDisplay = '';
            let isRealMutated = oldVal !== value; 

            if (oldVal === undefined) {
                diffDisplay = t.diff.init(newValDisplay);
                isRealMutated = true;
            } else if (oldVal !== value) {
                if (oldVal !== null && typeof oldVal === 'object' && value !== null && typeof value === 'object') {
                    const oldKeys = Object.keys(oldVal);
                    const newKeys = Object.keys(value);
                    
                    const added: string[] = [];
                    const deleted: string[] = [];
                    const updated: string[] = [];

                    const allKeys = new Set([...oldKeys, ...newKeys]);
                    for (const k of allKeys) {
                        if (!(k in oldVal)) added.push(k);
                        else if (!(k in value)) deleted.push(k);
                        else if (oldVal[k] !== value[k]) updated.push(k);
                    }

                    if (added.length === 0 && deleted.length === 0 && updated.length === 0) {
                        diffDisplay = t.diff.refOnly(oldKeys.length);
                        isRealMutated = false; 
                    } else {
                        const details: string[] = [];
                        if (added.length) details.push(`${t.diff.add}[${added.slice(0, 2).join(',')}${added.length > 2 ? '..' : ''}]`);
                        if (deleted.length) details.push(`${t.diff.del}[${deleted.slice(0, 2).join(',')}${deleted.length > 2 ? '..' : ''}]`);
                        if (updated.length) details.push(`${t.diff.mod}[${updated.slice(0, 2).join(',')}${updated.length > 2 ? '..' : ''}]`);
                        
                        diffDisplay = t.diff.obj(oldKeys.length, newKeys.length, details.join(' '));
                        isRealMutated = true;
                    }
                } else {
                    diffDisplay = t.diff.mut(formatVal(oldVal), newValDisplay);
                }
            } else {
                diffDisplay = t.diff.keep(newValDisplay);
            }
            
            globalStateCache.set(cacheKey, value);
            if (isRealMutated) {
                emitTrace('UPDATE', path);
            }
            if (isFocusMode) {
                if (isNodeRelevant(path)) {
                    hasFocusNodeLogs = true;
                    const valueColorStyle = isRealMutated ? "color: #a6e22e; font-weight: bold" : "color: #909399";
                    masterTimeline.push([`      %c└─ %c[${path as string}] %c${key} %c➔ %c${diffDisplay}`, "color: #4a4a4a", "color: #58b9ff", "color: #e0e0e0; font-weight: bold", "color: #909399", valueColorStyle]);
                }
            } else {
                if (shouldFold(path, calledBy)) return; 
                
                const cause = calledBy ?? 0;
                const record = {
                    [t.tables.epoch]: `E${currentEpoch}`,
                    [t.tables.node]: path as string,
                    [t.tables.key]: key,
                    [t.tables.diff]: diffDisplay
                };
                
                if (cause === 0 || cause === 3) {
                    sessionCausalMutations.push({ 
                        ...record, 
                        [t.tables.cause]: cause === 3 ? t.tables.valExt : t.tables.valCau 
                    });
                } else {
                    sessionEntangleMutations.push({ 
                        ...record, 
                        [t.tables.cause]: cause === 1 ? t.tables.valRes : t.tables.valRip 
                    });
                }
            }
        });

        on(MeshFlowEventsName.NodeSuccess, ({ path, calledBy }) => {
            if (isCurrentFlowIgnored) return; // 🌟 修复 5：把拦截判定放在 emitTrace 之前！下面同理！
            emitTrace('OK', path);
            
            const start = nodeStartTimes.get(path as string);
            if (start) {
                const duration = getNow() - start;
                nodeDurations.set(path as string, (nodeDurations.get(path as string) || 0) + duration);
            }

            const cause = calledBy ?? 0;
            const icons: Record<number, string> = { 0: '🚀', 1: '📜', 2: '💥', 3: '🌍' };
            const labels: Record<number, string> = { 
                0: t.timeline.label0, 
                1: t.timeline.label1, 
                2: t.timeline.label2,
                3: t.timeline.label3 
            };

            if (isFocusMode) {
                if (isNodeRelevant(path)) pushTimeline(t.timeline.phaseDone, '✅', 'OK', '#1e3323', path as string, t.timeline.success);
            } else {
                if (shouldFold(path, calledBy)) return; 
                sessionNodeTrace.push({
                    epoch: currentEpoch,
                    path: path as string,
                    icon: icons[cause] || '⚙️',
                    causeLabel: labels[cause] || t.timeline.label0
                });
            }
        });

        // @ts-ignore
        on(MeshFlowEventsName.NodeRelease, ({ path, type, detail, triggerPath }) => {
            if (isCurrentFlowIgnored) return;
            emitTrace('RELEASE', path, triggerPath as MeshPath);
            
            const msg = t.release[type](detail, triggerPath); 
            if (isFocusMode && isNodeRelevant(path, triggerPath as MeshPath)) 
                pushTimeline(t.timeline.phaseSch, '🌊', 'RELEASE', '#409EFF', path as string, msg, triggerPath as string);
            else if (!isFocusMode) 
                sessionSecurityLogs.push({ 'Action': '🌊 Release', 'Target Node': path, 'Trigger Mode': msg });
        });

        on(MeshFlowEventsName.NodeRevive, ({ path, triggerPath }) => {
            if (isCurrentFlowIgnored) return;
            emitTrace('RESOLVE', path, triggerPath);

            if (isFocusMode && isNodeRelevant(path, triggerPath)) pushTimeline(t.timeline.phaseSch, '✨', 'REVIVE', '#8e44ad', path as string, t.timeline.revive, triggerPath as string);
            else if (!isFocusMode) sessionSecurityLogs.push({ 'Action': '✨ Revive', 'Target Node': path, 'Trigger Mode': t.reports.revivedBy(path as string, triggerPath as string) });
        });

        // @ts-ignore
        on(MeshFlowEventsName.NodeIntercept, ({ path, type, detail, triggerPath }) => {
            if (isCurrentFlowIgnored) return;
            emitTrace('BLOCK', path, triggerPath as MeshPath);
            
            const msg = t.intercept[type](detail, triggerPath);
            if (isFocusMode && isNodeRelevant(path, triggerPath as MeshPath)) 
                pushTimeline(t.timeline.phaseSch, '🛑', 'BLOCK', '#F56C6C', path as string, msg, triggerPath as string);
            else if (!isFocusMode) 
                sessionSecurityLogs.push({ 'Action': '🛑 Intercept', 'Target Node': path, 'Trigger Mode': msg });
        });

        // @ts-ignore
        on(MeshFlowEventsName.NodeStagnate, ({ path, type, triggerPath }) => {
            if (isCurrentFlowIgnored) return;
            emitTrace('STAGNATE', path, triggerPath as MeshPath);
            
            const msg = t.stagnate[type](null, triggerPath);
            if (isFocusMode && isNodeRelevant(path, triggerPath as MeshPath)) 
                pushTimeline(t.timeline.phaseSch, '🧊', 'STAGNATE', '#909399', path as string, msg, triggerPath as string);
            else if (!isFocusMode) 
                sessionSecurityLogs.push({ 'Action': '🧊 Stagnate', 'Target Node': path, 'Trigger Mode': msg });
        });

        on(MeshFlowEventsName.FlowWait, ({ type, detail }) => {
            if (isCurrentFlowIgnored || isFocusMode) return; 
            const currentStamp = `${type}-${detail?.asyncNums || detail?.nums || 0}`;
            if (lastWaitStamp === currentStamp) return; 
            lastWaitStamp = currentStamp;
            const styles = { 1: { label: t.tags.wait, color: '#E6A23C' }, 2: { label: t.tags.limit, color: '#F56C6C' }, 3: { label: t.tags.entag, color: '#00bcd4' } };
            const s = styles[type as keyof typeof styles] || styles[1];
            sessionSchedulerLogs.push(`[${s.label}] ${(t.flowWait as any)[type](detail)}`);
        });

        on(MeshFlowEventsName.FlowFire, ({ path, type, detail }) => {
            if (!isCurrentFlowIgnored && !isFocusMode) sessionSchedulerLogs.push(`${t.tags.fire} ${path as string} ${(t.flowFire as any)[type](detail)}`);
        });

        on(MeshFlowEventsName.FlowEnd, ({ type }) => { 
            if (!isCurrentFlowIgnored && !isFocusMode) sessionSchedulerLogs.push(`${t.tags.end} ${(t.flowEnd as any)[type]()}`); 
        });

        on(MeshFlowEventsName.EntangleWarn, (d) => { 
            if (isCurrentFlowIgnored || (isFocusMode && !isNodeRelevant(d.path))) return;
            if (!isFocusMode) sessionEntangleLogs.push({ event: 'Config Warn', path: d.path, detail: t.reports.entangleWarn(d.path, d.type) }); 
            logger.warn(t.reports.entangleWarn(d.path, d.type)); 
        });

        on(MeshFlowEventsName.EntangleBlocked, (d) => { 
            if (isCurrentFlowIgnored) return;
            emitTrace('BLOCK', d.observer as MeshPath, undefined, d.target as MeshPath);
            if (isFocusMode) {
                if (isNodeRelevant(d.observer, d.target)) {
                    hasFocusNodeLogs = true;
                    masterTimeline.push([
                        `%c 🚫 DEADLOCK %c ${t.timeline.deadlock(d.observer, d.target)}`,
                        `background: #F56C6C; color: #fff; padding: 2px 4px; font-weight: bold; border-radius: 3px;`,
                        `color: #F56C6C; font-weight: bold; text-decoration: underline;`
                    ]);
                }
            } else {
                sessionEntangleLogs.push({ 
                    [t.tables.evtClamp]: 'Clamping', 
                    [t.tables.colObs]: d.observer, 
                    [t.tables.colTar]: d.target, 
                    'Detail': t.reports.entangleBlocked(d.observer, d.target), 
                    'Depth': d.count 
                }); 
            }
        });

        on(MeshFlowEventsName.EntangleEmitCalled, ({ observer, target, via }) => {
            if (isCurrentFlowIgnored) return;

            emitTrace('PROPHECY', observer as MeshPath, undefined, target as MeshPath);

            const keysStr = Array.isArray(via) ? via.join(',') : String(via);
            const msg = t.timeline.emitProphecy(target as string, keysStr);

            if (isFocusMode && isNodeRelevant(observer as MeshPath)) {
                pushTimeline(
                    t.timeline.phaseProp, 
                    '📡', 
                    'PROPHECY', 
                    '#e84393', 
                    observer as string, 
                    msg
                );
            } else if (!isFocusMode) {
                sessionSchedulerLogs.push(`[📡 PROPHECY] [${observer as string}] ${msg}`);
            }
        });
    };

    return { apply }
};

export { useLogger };