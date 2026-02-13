import { MeshPath } from "../types/types";

 

export interface MeshEvents {
    'node:start': { path: MeshPath };
    'node:success': { path: MeshPath;};
    'node:bucket:success':{path:MeshPath,key:string,value:any}
 
    'node:error': { path: MeshPath; error: any };
    'node:intercept': { path: MeshPath;  type:number,detail?:any };
    'node:release': { path: MeshPath; type:number,detail?:any}
    'node:stagnate': { path: MeshPath;type:number }
    'node:processing': { path:MeshPath }
    'flow:wait':{type:number;detail?:any}
    'flow:fire': { path: MeshPath;type:number ; detail?:any };
    'flow:start':{path:MeshPath}
    'flow:success':{duration:string}
    'flow:end':{type:number}

    'node:pending':{path:MeshPath}

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
        };
    }

    return {usePlugin,emit}
}

export {usePluginManager}