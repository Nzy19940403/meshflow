// core/engine/useMeshNode.ts

import { MeshFlowGroupNode, MeshFlowTaskNode, MeshPath,MeshNodeProxy } from "../types/types";

export function createMeshNode<
    P extends MeshPath,
    NM = any,
    V = any,
 
>(config: any) {
    // 1. 内部私有状态 (闭包变量)
    // 提取共有属性
    const { path, uid, type, meta, dirtySignal,  state } = config;

    let proxyView:any = null;
    const importantKeys = ['path', 'uid', 'type', 'dependOn',  'nodeBucket'];
    // 🌟 创建视图逻辑
    const createView = <E extends Record<string, any> = {}>(extraProps: E = {} as E): MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM, E> => {
        if (proxyView && Object.keys(extraProps).length === 0) return proxyView;

        const proxy = new Proxy(extraProps, {
            get(target, prop) {
                const key = prop as string;
  
               
                if (Reflect.has(target, prop)) {
                    return Reflect.get(target, prop);
                }
                // 如果是 Task 节点，尝试从 state 读
                if (key in config.state) {

                    return config.state[key];
                }

                if (key in config) {
                    return config[key]
                }

                // 尝试从 meta 读 (label, placeholder 等)

                if (meta && key in meta) {

                    return meta[key];
                }
                return Reflect.get(target, prop);
            },
            set(target, prop, value) {
                console.warn(
                    `[MeshFlow] Mutation Blocked: Direct assignment to "${String(prop)}" is forbidden.\n` +
                    `👉 Action Required: Return a proposal { key, value } from the emit function instead.`
                  );
                  return false;
            },

            // 🌟 核心修复 1: 让外界知道我们有哪些键
            ownKeys(target) {
                const keys = new Set([
                    ...Reflect.ownKeys(target),
                    ...Object.keys(state || {}),
                    ...Object.keys(meta || {}),
                    ...importantKeys
                ]);
        
                return Array.from(keys);
            },

            // 🌟 核心修复 2: 声明这些键是可枚举的
            getOwnPropertyDescriptor(target, prop) {
                const key = prop as string;
                // 如果是 state 或 meta 里的属性，伪造描述符
                if (
                    Reflect.has(target, prop) || 
                    (state && key in state) || 
                    (meta && key in meta) ||
                    importantKeys.includes(key) 
                    
                ) {
                    return {
                        enumerable: true,
                        configurable: true,
                        // 注意：不要写 value 或 get，让它继续触发外层的 get 拦截器
                    };
                }
                return Reflect.getOwnPropertyDescriptor(target, prop);
            }

        });

        proxyView = proxy;

        return proxy as any;
    };

    // 根据 config 的类型返回对应的对象
    const baseInstance = { path, uid, type, meta, dirtySignal, createView };
    
    if ("children" in config) {
        // 返回 Group 实例
        return { ...baseInstance, children: config.children } as MeshFlowGroupNode<P>;
    } else {
        // 返回 Task 实例
        return {
            ...baseInstance,
            state: config.state,
            nodeBucket: config.nodeBucket,
            notifyKeys: config.notifyKeys,
            dependOn: config.dependOn,
            calledBy:0,
            get proxy():MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM>{
                return proxyView
            }
        } as  MeshFlowTaskNode<P, V, NM>;
    }
}

