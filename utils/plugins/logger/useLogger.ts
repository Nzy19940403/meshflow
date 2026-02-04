interface LoggerInternalEvents {
    'node:start': { path: string };
    'node:success': { path: string;};
    'node:bucket:success':{path:string,key:string,value:any}
 
    'node:error': { path: string; error: any };
    'node:intercept': { path: string; type:number; detail?: any };
    'node:release': { path: string; type:number,detail?:any}
    'node:stagnate': { path: string;type:number }
    'node:processing': { path:string }
    'flow:wait':{type:number;detail?:any}
    'flow:fire': { path: string;type:number ; detail?:any };
    'flow:success':{duration:string}
}
type LoggerEventName = keyof LoggerInternalEvents


const NODE_RELEASE = {
    1:(detail:any)=>{
        return ` 上游${detail.path} 值变了`
    },
    2:(detail:any)=>{
        return `上游 ${detail.path} 完成(穿透)`
    },
    3:(detail:any)=>{
        return `水位推进至 L${detail.level}，释放暂存节点`
    }
}
/*
    给node:intercept加入几个状态
    1:token过期的拦截
    2:已经计算完的路径拦截
    3:正在计算的路径拦截
    4:整体水位进度还没到路径层级的拦截
*/

const NODE_INTERCEPT = {
    1:()=>{
        return '令牌过期，丢弃旧任务计算结果'
    },
    2:()=>{
        return '已计算完成'
    },
    3:()=>{
        return '节点正在队列或被计算,忽略本次重复信号'
    },
    4:(detail:any)=>{
        return `层级过高(L${detail.targetLevel}>L${detail.currentLevel})，退回暂存区等待上游(余${detail.pendingParentsCount})`
    }
}
const FLOW_WAIT = {
    1:(detail:any)=>{
        return `调度挂起：尚有 ${detail.nums} 个异步任务在途...`
    }
}
const FLOW_FIRE = {
    1:(detail:any)=>{
        return `归航，剩余 ${detail.remaining} 个任务在途，系统保持待机。`
    },
    2:(detail:any)=>{
        return `最终归航！所有任务已清空，重启调度检查收尾。`
    }
}

const NODE_STAGNATE = {
    1:()=>{
        return '上游静默，候补挂起'
    }
}

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

        //节点计算成功
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
        on('node:release', ({ path, type,detail }) => {
            const reason = NODE_RELEASE[type as keyof typeof NODE_RELEASE](detail)
            console.log(`%c🌊 [Release] %c${reason} %c➔ %c${path}`, 
                "color: #F56C6C; font-weight: bold", 
                "color: #909399", 
                "color: #717171", 
                "color: #58b9ff; font-weight: bold"
            );
        });

        on('node:intercept', ({ path, type,detail }) => {
            const reason = NODE_INTERCEPT[type as keyof typeof NODE_INTERCEPT](detail);
            console.log(`%c🛑 [Intercept] %c${path} | ${reason}`, "background: #FFF7E8; color: #E6A23C; padding: 2px 4px", "color: #E6A23C");
        })

        on('node:stagnate', ({ path, type }) => {
            const reason = NODE_STAGNATE[type as keyof typeof NODE_STAGNATE]()
            console.log(`%c🧊 [Stagnate] %c${reason} %c➔ %c${path}`, 
                "color: #909399; font-weight: bold", "color: #909399", "color: #717171", "color: #e0e0e0");
        })

        on('flow:wait', ({ type,detail }) => {
            const reason = FLOW_WAIT[type as keyof typeof FLOW_WAIT](detail);
            console.log(
                `%c 💤 [Wait] %c ${reason} `, 
                "background: #444;   font-weight: bold; border-radius: 4px 0 0 4px; border: 1px solid #555; border-right: none;", 
                "background: #222;   border-radius: 0 4px 4px 0; border: 1px solid #555;  "
            );
        });

        on('flow:fire', ({ path, type,detail }) => {
            const reason = FLOW_FIRE[type as keyof typeof FLOW_FIRE](detail);
            console.log(
                `%c🔥 [Fire] %c ${path} ${reason} `, 
                "background: #ff9800; color: #000; font-weight: bold; border-radius: 2px 0 0 2px;", 
                "background: #444; color: #ff9800; border-radius: 0 2px 2px 0;"
            );
        });

        on('flow:success',({duration})=>{
             
            console.log(
                `%c🎉 [Flow Success] ${duration}  ⚡ `,
                "color: #fff; background: #2e7d32; padding: 2px 4px; border-radius: 4px 0 0 4px;"
            );
        })
    }
    return { apply }
}

export {useLogger}