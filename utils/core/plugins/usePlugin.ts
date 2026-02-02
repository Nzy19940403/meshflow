 

export interface MeshEvents {
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
};

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
        plugin.apply({on});

        return ()=>{
            plugins.delete(plugin);
        }
    }

    return {usePlugin,emit}
}

export {usePluginManager}