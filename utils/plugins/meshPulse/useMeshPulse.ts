import { MeshFlowEventsName, MeshPath } from "@/utils/core/engine/useEngineManager";

export interface MeshPulseOptions {
    maxHistory?: number;
    logPrefix?: string;
    onTrace?: (sessionPulses: any[]) => void; // 喂给图表的钩子
    onStop?: (flowRecord: any) => void;       // 🌟 任务结束时的终极钩子
}

export const useMeshPulse = (options: MeshPulseOptions = {}) => {
    const { 
        maxHistory = 50, 
        logPrefix = '🫀 MeshPulse',
        onTrace,
        onStop 
    } = options;

    const pulseHistory: any[] = []; 

    // 🌟 默认的 onStop 行为：漂亮的控制台折叠打印
    const defaultOnStop = (flowRecord: any) => {
        console.groupCollapsed(
            `%c📦 ${logPrefix} Session Trace (Epochs: ${flowRecord.totalEpochs}, Time: ${flowRecord.duration.toFixed(2)}ms) [${flowRecord.status.toUpperCase()}]`,
            `color: ${flowRecord.status === 'success' ? '#00bcd4' : '#F56C6C'}; font-weight: bold; border-bottom: 1px dashed ${flowRecord.status === 'success' ? '#00bcd4' : '#F56C6C'}; padding-bottom: 2px;`
        );
        console.log(JSON.stringify(flowRecord, null, 2));
        console.groupEnd();
    };

    // 最终使用的 onStop：如果你传了自定义的就用你的，没传就用默认打印
    const finalOnStop = onStop || defaultOnStop;

    const apply = (api: any) => {
        let currentFlow: any = null; 
        let currentEpochEmits: any[] = [];
        let epochCounter = 0;
        let hasMainTaskSucceeded = false; 

        const activeTokens = new Set<symbol>();
        const on = <K extends keyof any>(event: K, cb: (data: any) => void) => api.on(event, cb);

        const finalizeFlow = (status: 'success' | 'abort' = 'success') => {
            if (!currentFlow) return;

            if (currentEpochEmits.length > 0) {
                currentFlow.epochs.push({
                    epoch: `T${epochCounter}`,
                    timestamp: performance.now(),
                    emits: [...currentEpochEmits]
                });
            }

            currentFlow.status = status;
            currentFlow.endTime = performance.now();
            currentFlow.duration = currentFlow.endTime - currentFlow.startTime;
            currentFlow.totalEpochs = currentFlow.epochs.length;

            if (currentFlow.totalEpochs > 0) {
                pulseHistory.push(currentFlow);
                if (pulseHistory.length > maxHistory) {
                    pulseHistory.shift();
                }

                // 1. 局部钩子：只把 epochs 传出去画图
                if (onTrace) onTrace(currentFlow.epochs);

                // 🌟 2. 全局钩子：把这次任务的完整大 JSON 传给 onStop
                finalOnStop(currentFlow);
            }

            currentFlow = null;
            currentEpochEmits = [];
        };

        on(MeshFlowEventsName.FlowStart, ({ token }) => {
            activeTokens.add(token);
            epochCounter = 0;
            currentEpochEmits = [];
            hasMainTaskSucceeded = false;

            currentFlow = {
                flowId: String(token), // 🌟 修复：保证 Symbol 能被字符串化
                startTime: performance.now(),
                status: 'pending',
                epochs: []
            };
        });

        on(MeshFlowEventsName.EntangleEmitCalled, (payload) => {
            if (!currentFlow) return;
            currentEpochEmits.push({ 
                cause: payload.observer, 
                impact: payload.target, 
                via: payload.via
            });
        });

        on(MeshFlowEventsName.EntangleEpochChange, (payload) => {
            if (!currentFlow) return;

            if (currentEpochEmits.length > 0) {
                currentFlow.epochs.push({
                    epoch: `T${epochCounter}`,
                    timestamp: payload.timestamp,
                    emits: [...currentEpochEmits]
                });
                epochCounter++;
                currentEpochEmits = [];
            }

            if (hasMainTaskSucceeded && currentEpochEmits.length === 0) {
                finalizeFlow('success');
            }
        });

        on(MeshFlowEventsName.FlowSuccess, ({ token }) => {
            if (!activeTokens.has(token)) return;
            hasMainTaskSucceeded = true; 
            finalizeFlow('success');
        });

        on(MeshFlowEventsName.FlowAbort, ({ token }) => {
            if (!activeTokens.has(token)) return;
            finalizeFlow('abort'); 
            activeTokens.delete(token);
        });
    };

    return { 
        apply,
        getHistory: () => pulseHistory, 
        clearHistory: () => { pulseHistory.length = 0; }
    };
};