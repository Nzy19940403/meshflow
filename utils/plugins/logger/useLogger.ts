interface LoggerInternalEvents {
    'node:start': { path: string };
    'node:success': { path: string;};
    'node:bucket:success':{path:string,key:string,value:any}
 
    'node:error': { path: string; error: any };
    'node:intercept': { path: string; reason: string; detail?: any };
    'node:release': { path: string; reason:string}
    'node:stagnate': { path: string;reason:string }
    'node:processing': { path:string }
    'flow:wait':{reason:string}
    'flow:fire': { path: string; reason: string };
}
type LoggerEventName = keyof LoggerInternalEvents
const useLogger = () => {
    const apply = (api: { 
        on: (event: LoggerEventName, cb: (data: any) => void) => void 
    }) => {
        
        const on = <K extends LoggerEventName>(
            event: K, 
            cb: (data: LoggerInternalEvents[K]) => void
        ) => api.on(event, cb);

        // 修复：补齐了第二个参数 "color: #e0e0e0"
        on('node:start', ({ path }) => {
            console.log(`%c🚀 [Start] %c${path}`, "color: #58b9ff; font-weight: bold", "color: #e0e0e0");
        })

        // 修复：补齐了样式参数
        on('node:success', ({ path }) => {
            console.log(`%c✅ [Success] %c${path}`, "color: #67C23A; font-weight: bold", "color: #e0e0e0");
        })

        on('node:bucket:success', ({ path, key, value }) => {
            // 这里 %c 数量和参数是匹配的，共 4 对
            console.log(
                `  %c└─ %c[${path}] %c${key} %c➔`, 
                "color: #717171", 
                "color: #58b9ff", 
                "color: #e0e0e0; font-weight: bold", 
                "color: #909399", 
                value 
            );
        });

        on('node:processing', ({ path }) => {
            console.log(`%c🛰️ [Processing] %c${path}`, "color: #00bcd4", "color: #909399");
        })

        on('node:error', ({ path, error }) => {
            console.log(`%c❌ [Error] %c${path}`, "background: #F56C6C; color: #fff; padding: 2px 4px", "color: #F56C6C", error);
        })

        // 修复：确保 4 个 %c 对应 4 个样式字符串
        on('node:release', ({ path, reason }) => {
            console.log(`%c🔥 [Release] %c${reason} %c➔ %c${path}`, 
                "color: #F56C6C; font-weight: bold", 
                "color: #909399", 
                "color: #717171", 
                "color: #58b9ff; font-weight: bold"
            );
        });

        on('node:intercept', ({ path, reason }) => {
            console.log(`%c🛑 [Intercept] %c${path} | ${reason}`, "background: #FFF7E8; color: #E6A23C; padding: 2px 4px", "color: #E6A23C");
        })

        on('node:stagnate', ({ path, reason }) => {
            console.log(`%c🧊 [Stagnate] %c${reason} %c➔ %c${path}`, 
                "color: #909399; font-weight: bold", "color: #909399", "color: #717171", "color: #e0e0e0");
        })

        on('flow:wait', ({ reason }) => {
            console.log(
                `%c 💤 [Wait] %c ${reason} `, 
                "background: #444;   font-weight: bold; border-radius: 4px 0 0 4px; border: 1px solid #555; border-right: none;", 
                "background: #222;   border-radius: 0 4px 4px 0; border: 1px solid #555;  "
            );
        });

        on('flow:fire', ({ path, reason }) => {
            console.log(
                `%c🔥 [Fire] %c ${path} ${reason} `, 
                "background: #ff9800; color: #000; font-weight: bold; border-radius: 2px 0 0 2px;", 
                "background: #444; color: #ff9800; border-radius: 0 2px 2px 0;"
            );
        });
    }
    return { apply }
}

export {useLogger}