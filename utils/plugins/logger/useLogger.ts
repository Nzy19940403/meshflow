import { createConsola } from "consola";

import { MeshFlowEventsName,MeshEvents,MeshPath } from "@meshflow/core";
 

 

type LoggerEventName = keyof MeshEvents
 

const locales: any = {
    zh: {
        tags: {
            engineStart: '⚡ MeshFlow 异步响应引擎启动...',
            processing: '🛰️ [Processing]',
            start: '🚀 START',
            success: '✅ OK',
            update: '📝 UPDATE',
            error: '❌ ERR',
            release: '🌊 [Release]',
            intercept: '🛑 [Intercept]',
            stagnate: '🧊 [Stagnate]',
            revive: '🧟 [Revive]',
            wait: '💤 PEND',
            entag: '🌀 ENTAG',
            limit: '🛑 LIMIT',
            fire: '🔥 [Fire]',
            end: '🛑 [End]',
            flowSuccess: '🎉 [Flow Success] 耗时:',
            flowAbortTitle: '🛑 [并发合并与中止脉冲]',
            abortCount: (count: number) => `(${count} 条冲突链路)`,
            abortItem: '⊘ 静默',
        },
        reports: {
            nodesTrace: (count: number) => `📦 [Computation Trace] 系统通过 ${count} 次计算达成稳态 (点击展开流水)`,
            operations: (count: number) => `🛠️ [Operations Log] 节点操作流水 (${count}条)`, // 🌟 新增的操作流水集合名
            security: (total: number) => `🛡️ [Engine Defense] 拦截与调度指令 (${total}条)`,
            scheduler: (count: number) => `⏱️ [Scheduler Trace] 引擎运转记录 (${count}条)`,
            entangle: (count: number) => `🌀 [Logic Clamping] 触发了 ${count} 次强制熔断`,
            barrierTitle: '⏳ [Async Barrier] 异步屏障激活，系统正在进行状态解析与演化...',
            barrierStatus: '🔄 异步任务正在排队落地，请稍候...',
            hotspotsTitle: '🔥 熔断靶心节点 (Top 5 受害者):',
            streamTitle: '📝 详细解析流水:',
            hotspotTableTarget: '节点 (Target)',
            hotspotTableCount: '触发强制熔断次数',
            revivedBy: (path: string, trigger: string) => `${path} 被 ${trigger} 唤醒`,
            entangleBlocked: (obs: string, tar: string) => `🚫 [Blocked] 链路死循环/逻辑阻断: ${obs} ➔ ${tar}`,
            entangleWarn: (path: string, type: string) => type === 'no_keys' 
                ? `⚠️ [Config Error] 缺失触发键: ${path}`
                : `⚠️ [Level Error] 节点未分配层级: ${path}`
        },
        release: { 1: (d: any) => `来源 ${d.path} 变更`, 2: (d: any) => `来源 ${d.path} 响应完成`, 3: (d: any) => `水位推进至 L${d.level}，释放后续节点`, 4: (d: any) => `贪婪模式推进 ${d.path}` },
        intercept: { 1: () => '令牌失效', 2: () => '状态已定型', 3: () => '节点忙，忽略重复触发', 3.1: () => '已在队列中', 4: (d: any) => `等待上游解析 (L${d.targetLevel}>L${d.currentLevel})`, 5: (d: any) => `屏障拦截挂起 (L${d.currentLevel} ➔ L${d.targetLevel})`, 6: () => `链路收敛`, 7: () => `背压保护拦截` },
        stagnate: { 1: () => '静默挂起', 2: () => `屏障激活，禁止渗透 ➔` },
        flowWait: { 1: () => `系统等待节点定型...`, 2: () => `并发上限，暂停分发`, 3: (d: any) => `等待 ${d?.asyncNums || 0} 个邻里效应收敛...` },
        flowFire: { 1: (d: any) => `调度反馈: ${d.active} 活跃, ${d.pending} 缓冲, ${d.blocked} 挂起.` },
        flowEnd: { 1: () => `流结束，系统回归静默状态。` }
    },
    en: {
        tags: {
            engineStart: '⚡ MeshFlow Async Engine Started...',
            processing: '🛰️ [Processing]',
            start: '🚀 START',
            success: '✅ OK',
            update: '📝 UPDATE',
            error: '❌ ERR',
            release: '🌊 [Release]',
            intercept: '🛑 [Intercept]',
            stagnate: '🧊 [Stagnate]',
            revive: '🧟 [Revive]',
            wait: '💤 PEND',
            entag: '🌀 ENTAG',
            limit: '🛑 LIMIT',
            fire: '🔥 [Fire]',
            end: '🛑 [End]',
            flowSuccess: '🎉 [Flow Success] Duration:',
            flowAbortTitle: '🛑 [Aborted & Merged Pulses]',
            abortCount: (count: number) => `(${count} conflicted links)`,
            abortItem: '⊘ Silent',
        },
        reports: {
            nodesTrace: (count: number) => `📦 [Computation Trace] System stabilized via ${count} calc paths.`,
            operations: (count: number) => `🛠️ [Operations Log] Node operations (${count} items)`,
            security: (total: number) => `🛡️ [Engine Defense] Intercepts & schedules (${total} items).`,
            scheduler: (count: number) => `⏱️ [Scheduler Trace] Engine commands (${count} items).`,
            entangle: (count: number) => `🌀 [Logic Clamping] Triggered ${count} forced clampings.`,
            barrierTitle: '⏳ [Async Barrier] Barrier active, system is resolving states...',
            barrierStatus: '🔄 Async tasks are resolving, please wait...',
            hotspotsTitle: '🔥 Clamping Hotspots (Top 5):',
            streamTitle: '📝 Detailed Resolution Stream:',
            hotspotTableTarget: 'Node (Target)',
            hotspotTableCount: 'Clamping Count',
            revivedBy: (path: string, trigger: string) => `${path} revived by ${trigger}`,
            entangleBlocked: (obs: string, tar: string) => `🚫 [Blocked] Logic loop blocked: ${obs} ➔ ${tar}`,
            entangleWarn: (path: string, type: string) => type === 'no_keys' 
                ? `⚠️ [Config Error] Missing triggerKeys: ${path}` 
                : `⚠️ [Level Error] Node has no level: ${path}`
        },
        release: { 1: (d: any) => `Upstream ${d.path} changed`, 2: (d: any) => `Upstream ${d.path} resolved`, 3: (d: any) => `Watermark advanced to L${d.level}`, 4: (d: any) => `Greedy advance ${d.path}` },
        intercept: { 1: () => 'Token expired', 2: () => 'Already resolved', 3: () => 'Node busy', 3.1: () => 'Node in queue', 4: (d: any) => `Wait for upstream (L${d.targetLevel}>L${d.currentLevel})`, 5: (d: any) => `Barrier withheld (L${d.currentLevel} ➔ L${d.targetLevel})`, 6: () => `Upstream silent`, 7: () => `Backpressure intercepted` },
        stagnate: { 1: () => 'Standby suspended', 2: () => `Barrier active, blocked ➔` },
        flowWait: { 1: () => `System waiting for nodes to resolve...`, 2: () => `Concurrency limit reached`, 3: (d: any) => `Waiting for ${d?.asyncNums || 0} logic ripples to settle...` },
        flowFire: { 1: (d: any) => `Scheduler: ${d.active} Active, ${d.pending} Pending, ${d.blocked} Blocked.` },
        flowEnd: { 1: () => `Flow ended, system returned to silent state.` }
    }
};

export interface LoggerOptions {
    locale?: 'zh' | 'en';
    foldFilter?: (path: MeshPath, calledBy: number) => boolean;
}

const logger = createConsola({ level: 3 });

// 🌟 修改点 1：把原来直接打印的方法，改成生成 console.log 所需的参数数组
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

const useLogger = (options: LoggerOptions = {}) => {
    const lang = options.locale || 'zh';
    const t = locales[lang];
    const shouldFold = options.foldFilter || ((path, calledBy) => calledBy !== 0);

    const apply = (api: any) => {
        let sessionSecurityLogs: any[] = [];
        let sessionNodeTrace: Array<{ path: MeshPath, calledBy: number }> = []; 
        let sessionSchedulerLogs: string[] = []; 
        let sessionEntangleLogs: any[] = []; 
        
        // 🌟 修改点 2：新增专门收集彩色徽章操作的数组
        let sessionOperationLogs: any[][] = []; 

        let lastWaitStamp = ''; 
        let isFlowGroupActive = false; 

        // 🌟 核心并发状态控制
        const activeTokens = new Set<symbol>();
        const tokenToPath = new Map<symbol, MeshPath>(); 
        let abortedPaths: MeshPath[] = []; 
        let finalDuration = '';
        let closeTimer: any = null; 

        const on = <K extends LoggerEventName>(event: K, cb: (data: MeshEvents[K]) => void) => {
            api.on(event, cb);
        };

        on( MeshFlowEventsName.FlowStart , ({ path, token }) => {
            if (closeTimer) {
                clearTimeout(closeTimer);
                closeTimer = null;
            }

            activeTokens.add(token);
            tokenToPath.set(token, path);
            
            if (isFlowGroupActive) return; 
            isFlowGroupActive = true;

            sessionSecurityLogs = []; 
            sessionNodeTrace = []; 
            sessionSchedulerLogs = []; 
            sessionEntangleLogs = []; 
            sessionOperationLogs = []; // 清空收集器
            abortedPaths = [];
            lastWaitStamp = '';
            finalDuration = ''; 
            
            console.groupCollapsed(`%c${t.tags.engineStart}`, "color: #909399; font-weight: bold; font-size: 12px;");
        });

        const tryCloseGroup = () => {
            if (activeTokens.size > 0 || !isFlowGroupActive) return;

            if (abortedPaths.length > 0) {
                console.groupCollapsed(`%c${t.tags.flowAbortTitle} %c${t.tags.abortCount(abortedPaths.length)}`, "color: #F56C6C; font-weight: bold; font-size: 11px;", "color: #909399; font-style: normal;");
                abortedPaths.forEach(p => console.log(`%c ${t.tags.abortItem} %c ${p as string} `, "color: #F56C6C; font-size: 10px;", "color: #909399;"));
                console.groupEnd();
            }
            
            // 🌟 修改点 3：专门为你开辟的 Operations Log！遍历缓存的数组，打印出你喜欢的彩色徽章
            if (sessionOperationLogs.length > 0) {
                console.groupCollapsed(`%c${t.reports.operations(sessionOperationLogs.length)}`, "color: #b3e19d; font-style: italic; font-size: 11px;");
                sessionOperationLogs.forEach(args => console.log(...args)); // 原样打出
                console.groupEnd();
            }

            const foldedNodes = sessionNodeTrace.filter(n => shouldFold(n.path, n.calledBy));
            
            if (foldedNodes.length > 0) {
                console.groupCollapsed(`%c${t.reports.nodesTrace(foldedNodes.length)}`, "color: #00bcd4; font-style: italic; font-size: 11px;");
                console.table(foldedNodes); 
                console.groupEnd();
            }

            
            if (sessionEntangleLogs.length > 0) {
                console.groupCollapsed(`%c${t.reports.entangle(sessionEntangleLogs.length)}`, "color: #F56C6C; font-weight: bold; font-style: italic; font-size: 11px;");
                
                const hotspots = sessionEntangleLogs.reduce((acc, log) => {
                    if (log.event === 'Clamping' && log.target) {
                        acc[log.target] = (acc[log.target] || 0) + 1;
                    }
                    return acc;
                }, {} as Record<string, number>);
                
                if (Object.keys(hotspots).length > 0) {
                    console.log(`%c${t.reports.hotspotsTitle}`, "font-weight: bold; color: #E6A23C");
                    const hotspotTable = Object.entries(hotspots)
                        .sort((a: any, b: any) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([target, count]) => ({
                            [t.reports.hotspotTableTarget]: target,
                            [t.reports.hotspotTableCount]: count
                        }));
                    console.table(hotspotTable);
                }
                
                console.log(`%c${t.reports.streamTitle}`, "font-weight: bold; color: #909399");
                console.table(sessionEntangleLogs);
                console.groupEnd();
            }

            if (sessionSecurityLogs.length > 0) {
                console.groupCollapsed(`%c${t.reports.security(sessionSecurityLogs.length)}`, "color: #909399; font-style: italic; font-size: 11px;");
                const mappedLogs = sessionSecurityLogs.map(l => ({
                    ...l,
                    reason: l.action === 'Intercept' ? t.intercept[l.type](l.detail) : 
                            l.action === 'Release' ? t.release[l.type](l.detail) : 
                            l.action === 'Revive' ? t.reports.revivedBy(l.path, l.triggerPath) : t.stagnate[l.type]()
                }));
                console.table(mappedLogs);
                console.groupEnd();
            }

            if (sessionSchedulerLogs.length > 0) {
                console.groupCollapsed(`%c${t.reports.scheduler(sessionSchedulerLogs.length)}`, "color: #E6A23C; font-style: italic; font-size: 11px;");
                sessionSchedulerLogs.forEach(log => console.log(`%c${log}`, "color: #909399"));
                console.groupEnd();
            }

            console.groupEnd(); 
            isFlowGroupActive = false;
            console.log(''); 

            if (finalDuration) {
                logger.success(`${t.tags.flowSuccess} ${finalDuration}`);
                finalDuration = ''; 
            }

            tokenToPath.clear();
        };

        const returnToken = (token: symbol, isSyncClose: boolean = false) => {
            if (!activeTokens.has(token)) return;
            activeTokens.delete(token);

            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }

            if (isSyncClose) {
                tryCloseGroup();
            } else {
                closeTimer = setTimeout(tryCloseGroup, 10);
            }
        };

        on(MeshFlowEventsName.FlowSuccess , ({ duration, token }) => {
            finalDuration = duration; 
            returnToken(token, true);
        });

        on(MeshFlowEventsName.FlowAbort , ({ token }) => {
            const pathName = tokenToPath.get(token) || 'unknown' ;
            abortedPaths.push(pathName); 
            returnToken(token);
        });

        // 遇到 Error 还是要立刻打印出来暴露问题
        on(MeshFlowEventsName.NodeError , ({ path, error }) => {
            if (isFlowGroupActive) {
                console.groupEnd();
                isFlowGroupActive = false;
            }
            activeTokens.clear(); 
            printBadge(t.tags.error, path, '#F56C6C', '#3d1d1d', false);
            console.error(error);
        });

        on( MeshFlowEventsName.NodeProcessing , () => {}); 

        // 🌟 修改点 4：把原来的 printBadge 替换为 sessionOperationLogs.push，收集所有样式和文案
        on( MeshFlowEventsName.NodeStart , ({ path, calledBy }) => {
            lastWaitStamp = ''; 
            if (shouldFold(path, calledBy)) return; 
            sessionOperationLogs.push(getBadgeArgs(t.tags.start, path, '#58b9ff', '#1a2b3c', true)); 
        });

        on( MeshFlowEventsName.NodeBucketSuccess , ({ path, key, value, calledBy }) => {
            if (shouldFold(path, calledBy)) return; 
            const displayValue = (value !== null && typeof value === 'object') ? `{... ${Object.keys(value).length} keys}` : value;
            // 因为这个是不带边框徽章的树状图文本，直接保存参数数组
            sessionOperationLogs.push([`  %c└─ %c[${path as string}] %c${key} %c➔ %c${displayValue}`, "color: #4a4a4a", "color: #58b9ff", "color: #e0e0e0; font-weight: bold", "color: #909399", "color: #a6e22e"]);
        });

        on( MeshFlowEventsName.NodeSuccess , ({ path, calledBy }) => {
            sessionNodeTrace.push({ path, calledBy }); 
            if (shouldFold(path, calledBy)) return; 
            sessionOperationLogs.push(getBadgeArgs(t.tags.success, path, '#67C23A', '#1e3323', false)); 
        });

        on( MeshFlowEventsName.FlowWait , ({ type, detail }) => {
            const currentStamp = `${type}-${detail?.asyncNums || detail?.nums || 0}`;
            if (lastWaitStamp === currentStamp) return; 
            lastWaitStamp = currentStamp;
            const styles = { 1: { label: t.tags.wait, color: '#E6A23C', bg: '#423019' }, 2: { label: t.tags.limit, color: '#F56C6C', bg: '#3d1d1d' }, 3: { label: t.tags.entag, color: '#00bcd4', bg: '#0d282e' } };
            const s = styles[type as keyof typeof styles] || styles[1];
            sessionOperationLogs.push(getBadgeArgs(s.label, (t.flowWait as any)[type](detail), s.color, s.bg, false));
        });

        on( MeshFlowEventsName.NodeRelease , ({ path, type, detail }) => sessionSecurityLogs.push({ action: 'Release', path, type, detail }));
        on( MeshFlowEventsName.NodeRevive , ({ path, triggerPath }) => sessionSecurityLogs.push({ action: 'Revive', path, triggerPath }));
        on( MeshFlowEventsName.NodeIntercept  , ({ path, type, detail }) => sessionSecurityLogs.push({ action: 'Intercept', path, type, detail }));
        on( MeshFlowEventsName.NodeStagnate , ({ path, type }) => sessionSecurityLogs.push({ action: 'Stagnate', path, type }));
        on( MeshFlowEventsName.FlowFire , ({ path, type, detail }) => sessionSchedulerLogs.push(`${t.tags.fire} ${path as string} ${(t.flowFire as any)[type](detail)}`));
        on( MeshFlowEventsName.FlowEnd , ({ type }) => { sessionSchedulerLogs.push(`${t.tags.end} ${(t.flowEnd as any)[type]()}`); });
        
        on( MeshFlowEventsName.EntangleWarn , (d) => { sessionEntangleLogs.push({ event: 'Config Warn', path: d.path, detail: t.reports.entangleWarn(d.path, d.type) }); logger.warn(t.reports.entangleWarn(d.path, d.type)); });
        on( MeshFlowEventsName.EntangleBlocked , (d) => { sessionEntangleLogs.push({ event: 'Clamping', observer: d.observer, target: d.target, detail: t.reports.entangleBlocked(d.observer, d.target), depth: d.count }); });
    }

    return { apply }
}

export { useLogger }