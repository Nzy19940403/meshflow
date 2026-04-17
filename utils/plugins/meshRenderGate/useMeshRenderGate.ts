import { MeshFlowTaskNode, MeshPath } from "@meshflow/core";

// 定义返回的 Module 结构
type MeshRenderGateModule<P extends MeshPath> = {
  init: () => void;
  onDirty: (callback: (dirtyNodes: Record<string, any>) => void, types?: string[]) => () => void;
  emit: (paths: P[]) => void;
};

export const useMeshRenderGate = () => {
  // 1. 状态彻底收敛在工厂函数内部，每次调用生成全新沙箱
  let getNodeByPath: ((path: any) => any) | null = null;
  const listeners = new Set<{
    callback: (dirtyNodes: Record<string, any>) => void;
    types?: string[];
  }>();

  // 🛡️ 严格的只读 Proxy 处理器
  const readOnlyHandler: ProxyHandler<any> = {
    set(target, prop) {
      console.warn(`[MeshRenderGate] 拦截: 渲染层严禁直接修改节点！请使用 engine.data.SetValue 发起新事务。`);
      return true; // 静默拦截，不中断程序
    },
    deleteProperty() {
      console.warn(`[MeshRenderGate] 拦截: 渲染层不能删除引擎属性。`);
      return true;
    }
  };

  // 2. 这是引擎真正会调用的高阶函数
  const moduleFactory = <P extends MeshPath, Node extends MeshFlowTaskNode<P>>(
    getResolve: () => (uid: number) => Node
  ): MeshRenderGateModule<P> => {
    
    return {
      init: () => {
        if (getNodeByPath) return; // 防重复初始化
        getNodeByPath = getResolve();
      },

      onDirty: (callback, types) => {
        const listener = { callback, types };
        listeners.add(listener);
        // 返回取消订阅的函数，方便 Vue 在 onUnmounted 中调用
        return () => listeners.delete(listener); 
      },

      emit: (paths: P[]) => {
        if (listeners.size === 0 || !getNodeByPath) return;

        const batch = new Map<P, { rawNode: Node; type?: string }>();

        // 🌟 核心改造点 1：防御性查询
        for (const path of paths) {
          try {
            const targetNode = getNodeByPath(path);
            if (targetNode) {
              batch.set(path, {
                rawNode: targetNode,
                type: (targetNode as any).type, 
              });
            }
          } catch (e) {
            // 新版 Core 如果 path 没有对应 ID 可能会抛错，这里直接消化掉
            // 避免渲染层的脏数据查询直接搞崩底层引擎
            console.warn(`[MeshRenderGate] 节点 ${path as string} 查询失败，可能已被引擎剔除或未完全初始化。`);
          }
        }

        if (batch.size === 0) return;

        listeners.forEach(({ callback, types }) => {
          const filteredMap: Record<string, any> = {};
          let hasMatchedData = false;

          batch.forEach((info, path) => {
            const isTarget = !types || (info.type && types.includes(info.type));

            if (isTarget) {
              // 🌟 核心改造点 2：适配轻量级 Core
              // 兼容老版本的 proxy/createView，同时兼容新版本直接暴露的纯对象
              const viewNode = info.rawNode.proxy 
                || (typeof info.rawNode.createView === 'function' ? info.rawNode.createView() : info.rawNode);
              
              // 包装为 ReadOnly 并交出
              filteredMap[path as string] = new Proxy(viewNode, readOnlyHandler);
              hasMatchedData = true;
            }
          });

          if (hasMatchedData) {
            callback(filteredMap); // 通知 Vue/PixiJS 渲染
          }
        });
      },
    };
  };

  // 保持你原本的标识符逻辑，以便核心引擎识别
  (moduleFactory as any).isMeshModuleInited = true;
  return moduleFactory;
};

// 配合你原本的静态属性（建议后续版本优化掉这种挂载方式）
(useMeshRenderGate as any).isMeshModuleInited = false;

 