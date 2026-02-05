 

export interface MeshEvents {
    'node:start': { path: string };
    'node:success': { path: string;};
    'node:bucket:success':{path:string,key:string,value:any}
 
    'node:error': { path: string; error: any };
    'node:intercept': { path: string;  type:number,detail?:any };
    'node:release': { path: string; type:number,detail?:any}
    'node:stagnate': { path: string;type:number }
    'node:processing': { path:string }
    'flow:wait':{type:number;detail?:any}
    'flow:fire': { path: string;type:number ; detail?:any };
    'flow:start':{path:string}
    'flow:success':{duration:string}

    'node:pending':{path:string}

};
/*
   给node:intercept加入几个状态
    1:token过期的拦截
    2:已经计算完的路径拦截
    3:正在计算的路径拦截
    3.1:正在队列的路径拦截
    4:整体水位进度还没到路径层级,并且入度还没减到0,暂时等待后续水位推进再一次执行
    5,整体水位进度还没到路径层级,但是入度已经减到0了,在非贪婪模式下暂时扣押,
    6:最后的截流,清空resureArea,这是静默的信号,
*/
export type MeshEventName = keyof MeshEvents;

export type MeshEmit = <K extends MeshEventName>(
    event: K, 
    data: MeshEvents[K]
  ) => void;

const usePluginManager = ()=>{
    const plugins = new Set();
    const eventGroups = new Map<string, Set<Function>>();

    // 内部发射方法：供业务代码调用
    const emit:MeshEmit = (event: MeshEventName, data: any) => {
        eventGroups.get(event)?.forEach(cb => cb(data));
    };

    const on = (event:MeshEventName,cb:Function)=>{
        if(!eventGroups.has(event)){
            eventGroups.set(event,new Set());
        }
        eventGroups.get(event)!.add(cb);

        return ()=>eventGroups.get(event)!.delete(cb);
    }
 

    const usePlugin = (plugin:{apply:(api:{on:typeof on})=>void})=>{
       
        // 专门为这个插件建立一个销毁任务池
        const cleanups = new Set<Function>();

        const proxyOn: typeof on = (event, cb) => {
            const cancel = on(event, cb);
            cleanups.add(cancel); // 偷偷存起来
            return cancel;
        };

        plugin.apply({ on: proxyOn });
        plugins.add(plugin);

        return () => {
            cleanups.forEach(cancel => cancel());
            cleanups.clear();
            plugins.delete(plugin);
           
            console.log(`[Plugin] 插件已彻底卸载，并清理了所有事件监听`);
        };
    }

    return {usePlugin,emit}
}

export {usePluginManager}