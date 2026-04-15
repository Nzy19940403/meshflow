import { MeshFlowEventsName, MeshPath } from "@/utils/core/engine/useEngineManager";

export interface MeshPulseOptions {
    logPrefix?: string;
    showTable?: boolean;
    outputJson?: boolean;
}

export const useMeshPulse = (options: MeshPulseOptions = {}) => {
    const {
        logPrefix = '🫀 MeshPulse',
        showTable = true,
        outputJson = true
    } = options;

    const apply = (api: any) => {
        // --- 核心状态 ---
        let epochCounter = 0; // 纪元序号
        let currentEpochEmits: Array<{ cause: string, impact: string, via: any }> = []; // 当前纪元的子弹
        let sessionPulses: Array<{ epoch: string, timestamp: number, emits: any[] }> = []; // 整个 Flow 的脉冲快照
        let currentTimeStrap = 0;
        let displayTimeStrap = '0';
        // 可选：利用 token 防止并发污染
        const activeTokens = new Set<symbol>();

        const on = <K extends keyof any>(event: K, cb: (data: any) => void) => {
            api.on(event, cb);
        };

        // 1. 引擎启动：重置脉冲记录器
        on(MeshFlowEventsName.FlowStart, ({ token }) => {
            activeTokens.add(token);
            epochCounter = 0;
            currentEpochEmits = [];
            sessionPulses = [];
            currentTimeStrap = 0;

            if (showTable) {
                console.log(`%c${logPrefix} %cTracker Activated...`, "color: #bada55; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: #909399; font-style: italic;");
            }
        });

        // 2. 收集子弹：只要有发射，就塞进当前纪元的弹夹
        on(MeshFlowEventsName.EntangleEmitCalled, (payload) => {
            currentEpochEmits.push({
                cause: payload.observer,
                impact: payload.target,
                via: payload.via
            });
        });

        // 3. 纪元结算（发令枪）：将当前弹夹打包成一个 Pulse，并推入快照
        on(MeshFlowEventsName.EntangleEpochChange, (payload) => {
            if (currentEpochEmits.length === 0) return; // 空转的纪元不记录

            const pulseSnapshot = {
                epoch: `T${epochCounter}`,
                timestamp: payload.timestamp,
                emits: [...currentEpochEmits]
            };
            
            sessionPulses.push(pulseSnapshot);

            displayTimeStrap = (payload.timestamp - currentTimeStrap).toFixed(1);
            if(currentTimeStrap===0){
                displayTimeStrap = '0';
                currentTimeStrap = payload.timestamp;
            }
          
            // 🌟 装逼时刻：控制台实时打印带折叠的脉冲表
            if (showTable) {
                console.groupCollapsed(
                    `%c${logPrefix} [Epoch ${pulseSnapshot.epoch}] %c TimeStrap ${displayTimeStrap}- Settled ${currentEpochEmits.length} entanglements`, 
                    "background: #1e1e1e; color: #bada55; font-weight: bold; border-radius: 2px; padding: 2px 4px;", 
                    "color: #a6e22e; font-style: italic;"
                );
                console.table(currentEpochEmits);
                console.groupEnd();
            }

            // 清空弹夹，准备迎接下一个纪元
            epochCounter++;
            currentEpochEmits = []; 
        });

        // 4. 引擎停机：吐出最终的 JSON 数据，证明收敛
        const handleFlowEnd = (token: symbol) => {
            if (!activeTokens.has(token)) return;
            activeTokens.delete(token);

            // 如果还有没结算的“残影”（理论上不会有，但在强制终止时可能存在）
            if (currentEpochEmits.length > 0) {
                sessionPulses.push({
                    epoch: `T${epochCounter} (Abort/Flush)`,
                    timestamp: performance.now(),
                    emits: [...currentEpochEmits]
                });
            }

            if (sessionPulses.length > 0 && outputJson) {
                console.groupCollapsed(
                    `%c📦 ${logPrefix} Session Trace (Total Epochs: ${sessionPulses.length})`, 
                    "color: #00bcd4; font-weight: bold; border-bottom: 1px dashed #00bcd4; padding-bottom: 2px;"
                );
                // 打印出完美的 JSON 结构，可以直接复制到文档里
                console.log(JSON.stringify(sessionPulses, null, 2));
                console.groupEnd();
            }
        };

        on(MeshFlowEventsName.FlowSuccess, ({ token }) => handleFlowEnd(token));
        on(MeshFlowEventsName.FlowAbort, ({ token }) => handleFlowEnd(token));
    };

    return { apply };
};