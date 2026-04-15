import { MeshFlowEventsName, MeshPath } from "@/utils/core/engine/useEngineManager";

export interface MeshPulseOptions {
    logPrefix?: string;
    showTable?: boolean;
    outputJson?: boolean;
    onTrace?: (sessionPulses: any[]) => void;
}

export const useMeshPulse = (options: MeshPulseOptions = {}) => {
    const { logPrefix = '🫀 MeshPulse', showTable = true, outputJson = true, onTrace } = options;

    const apply = (api: any) => {
        let epochCounter = 0;
        let currentEpochEmits: any[] = [];
        let sessionPulses: any[] = [];
        let currentTimeStrap = 0;
        let displayTimeStrap = '0';
        
        // 🌟 只需要这一个最核心的标志位
        // 它的物理意义：主干代码（非异步回调部分）是否已经跑完了？
        let hasMainTaskSucceeded = false; 

        const activeTokens = new Set<symbol>();
        const on = <K extends keyof any>(event: K, cb: (data: any) => void) => api.on(event, cb);

        const finalizeAndPrint = () => {
            if (sessionPulses.length === 0) return;

            if (typeof onTrace === 'function') {
                onTrace(sessionPulses);
            }

            if (outputJson) {
                console.groupCollapsed(
                    `%c📦 ${logPrefix} Session Trace (Total Epochs: ${sessionPulses.length})`,
                    "color: #00bcd4; font-weight: bold; border-bottom: 1px dashed #00bcd4; padding-bottom: 2px;"
                );
                console.log(JSON.stringify(sessionPulses, null, 2));
                console.groupEnd();
            }
            
            // 打印完清空，防止被重复触发
            sessionPulses = []; 
        };

        on(MeshFlowEventsName.FlowStart, ({ token }) => {
            activeTokens.add(token);
            epochCounter = 0;
            currentEpochEmits = [];
            sessionPulses = [];
            currentTimeStrap = 0;
            hasMainTaskSucceeded = false; // 🚦 任务开始，灯变红

            if (showTable) {
                console.log(`%c${logPrefix} %cTracker Activated...`, "color: #bada55; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: #909399; font-style: italic;");
            }
        });

        on(MeshFlowEventsName.EntangleEmitCalled, (payload) => {
            currentEpochEmits.push({ cause: payload.observer, impact: payload.target, via: payload.via });
        });

        // 🌟 核心：所有判定全在 EpochChange 里完成
        on(MeshFlowEventsName.EntangleEpochChange, (payload) => {
            // 1. 如果有子弹，正常打包当前纪元
            if (currentEpochEmits.length > 0) {
                const pulseSnapshot = {
                    epoch: `T${epochCounter}`,
                    timestamp: payload.timestamp,
                    emits: [...currentEpochEmits]
                };
                sessionPulses.push(pulseSnapshot);

                displayTimeStrap = (payload.timestamp - currentTimeStrap).toFixed(1);
                if (currentTimeStrap === 0) {
                    displayTimeStrap = '0';
                    currentTimeStrap = payload.timestamp;
                }

                if (showTable) {
                    console.groupCollapsed(
                        `%c${logPrefix} [Epoch ${pulseSnapshot.epoch}] %c TimeStrap ${displayTimeStrap}ms - Settled ${currentEpochEmits.length} entanglements`,
                        "background: #1e1e1e; color: #bada55; font-weight: bold; border-radius: 2px; padding: 2px 4px;",
                        "color: #a6e22e; font-style: italic;"
                    );
                    console.table(currentEpochEmits);
                    console.groupEnd();
                }

                epochCounter++;
                currentEpochEmits = [];
            }

            // 2. 🌟 终极收网判定 🌟
            // 既然能走到这里（不管是空转还是打完了子弹），说明内核在尝试结算。
            // 如果主任务已经跑完了（hasMainTaskSucceeded === true）
            // 且这次结算之后，弹夹里没新东西了
            // 那就是真结束了！因为你的 monitor 只有在幽灵归零时才会发这个事件。
            if (hasMainTaskSucceeded && currentEpochEmits.length === 0) {
                finalizeAndPrint();
            }
        });

        // 这个事件在主干 flushQueue 走完时触发
        on(MeshFlowEventsName.FlowSuccess, ({ token }) => {
            if (!activeTokens.has(token)) return;
            hasMainTaskSucceeded = true; // 🚦 主任务跑完，灯变绿

            // 针对纯同步任务的特判：
            // 如果它是纯同步的，FlowSuccess 时根本没有在飞的幽灵，
            // 也就不会再有下一次的 EpochChange 了，所以这里直接帮它收网。
            // if (currentEpochEmits.length === 0) {
            //     finalizeAndPrint();
            // }
            // 🌟 核心：同步补偿逻辑 🌟
            // 如果弹夹里还有子弹，说明这是没有心跳的纯同步任务，或者最后一波没结算的残留
            if (currentEpochEmits.length > 0) {
                const pulseSnapshot = {
                    epoch: `T${epochCounter}`, // 标明这是同步收尾
                    timestamp: performance.now(),
                    emits: [...currentEpochEmits]
                };
                sessionPulses.push(pulseSnapshot);

                if (showTable) {
                    console.groupCollapsed(
                        `%c${logPrefix} [Epoch ${pulseSnapshot.epoch}] %c Settled ${currentEpochEmits.length} entanglements`,
                        "background: #1e1e1e; color: #bada55; font-weight: bold; border-radius: 2px; padding: 2px 4px;",
                        "color: #a6e22e; font-style: italic;"
                    );
                    console.table(currentEpochEmits);
                    console.groupEnd();
                }
                
                // 清空弹夹
                currentEpochEmits = [];
            }

            // 既然已经到了 FlowSuccess，且我们手动把剩余的子弹都打包清空了
            // 此时直接调用收网函数，吐出 JSON
            finalizeAndPrint();
        });

        on(MeshFlowEventsName.FlowAbort, ({ token }) => {
            if (!activeTokens.has(token)) return;
            // Abort 时强行收网（如果还有没打印的纪元，直接放弃，输出已有的 Session）
            finalizeAndPrint(); 
            activeTokens.delete(token);
        });
    };

    return { apply };
};