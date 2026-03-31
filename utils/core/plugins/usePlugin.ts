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

import { MeshEmit, MeshEventName, MeshPath } from "../types/types";

const usePluginManager = () => {
    const plugins = new Set();
    const eventGroups = new Map<MeshPath, Set<Function>>();
    
    // 🌟 新增：全局卸载池，集中管理所有已注册插件的销毁函数
    const allPluginUninstalls = new Set<Function>();

    // 内部发射方法：供业务代码调用
    const emit: MeshEmit = (event: MeshEventName, data: any) => {
        eventGroups.get(event)?.forEach(cb => cb(data));
    };

    const on = (event: MeshEventName, cb: Function) => {
        if (!eventGroups.has(event)) {
            eventGroups.set(event, new Set());
        }
        eventGroups.get(event)!.add(cb);

        return () => eventGroups.get(event)?.delete(cb);
    };

    const usePlugin = (plugin: { apply: (api: { on: typeof on }) => void }) => {
        // 专门为这个插件建立一个销毁任务池
        const cleanups = new Set<Function>();

        const proxyOn: typeof on = (event, cb) => {
            const cancel = on(event, cb);
            cleanups.add(cancel); // 偷偷存起来
            return cancel;
        };

        plugin.apply({ on: proxyOn });
        plugins.add(plugin);

        // 🌟 定义卸载逻辑
        const uninstall = () => {
            // 1. 取消该插件的所有事件监听
            cleanups.forEach(cancel => cancel());
            cleanups.clear();
            // 2. 从插件集合中移除
            plugins.delete(plugin);
            // 3. 🌟 核心：如果是用户手动调用的，把自己从全局池子里删掉，防止内存泄漏和重复调用
            allPluginUninstalls.delete(uninstall);
        };

        // 将该插件的卸载方法加入全局池，等待被 deleteEngine 统一处决
        allPluginUninstalls.add(uninstall);

        // 返回闭包，赋予用户手动删除的权利
        return uninstall;
    };

    // 🌟 新增：一键销毁所有插件（供外部 Engine 销毁时调用）
    const destroyPlugin = () => {
         
        // 挨个触发还没被卸载的插件闭包
        allPluginUninstalls.forEach(uninstall => uninstall());
        allPluginUninstalls.clear();
        
        // 物理兜底，确保事件桶干干净净
        eventGroups.clear();
        plugins.clear();
    };

    return { usePlugin, emit, destroyPlugin };
}

export { usePluginManager };