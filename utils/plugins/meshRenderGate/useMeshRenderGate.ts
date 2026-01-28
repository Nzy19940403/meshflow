import { MeshFlowTaskNode, MeshPath } from "@meshflow/core";

type MeshRenderGateBaseModule = <P extends MeshPath, Node extends MeshFlowTaskNode<P>>(
  getResolve: () => (path: P) => Node
) => {
  init: () => void;
  onDirty: (
    callback: (dirtyNodes: Record<string, any>) => void,
    types?: string[]
  ) => () => void;
  emit: (paths: P[]) => void;
};

type MeshRenderGateModule = MeshRenderGateBaseModule & { isMeshModuleInited: boolean }

const useMeshRenderGate:()=>MeshRenderGateModule = () => {
  const meshRenderGateModule: MeshRenderGateModule = <
    P extends MeshPath,
    Node extends MeshFlowTaskNode<P>
  >(
    getResolve: () => (path: P) => Node
  ) => {
    let GetNodeFuncInited = false;
    let getNodeByPath: (path: P) => Node;

    const listeners = new Set<{
      callback: (dirtyNodes: Record<string, any>) => void;
      types?: string[];
    }>();

    // 🛡️ 原有的只读 Proxy 处理器
    const readOnlyHandler: ProxyHandler<any> = {
      set(target, prop) {
        console.warn(`[MeshRenderGate] 拦截: 不能直接修改节点属性。`);
        return true; 
      },
      deleteProperty(target, prop) {
        console.warn(`[MeshRenderGate] 拦截: 不能删除属性。`);
        return true;
      }
    };

    const init = () => {
      if (GetNodeFuncInited) return;
      GetNodeFuncInited = true;
      getNodeByPath = getResolve();
    };

    return {
      init,
      onDirty: (callback: (dirtyNodes: Record<string, any>) => void, types?: string[]) => {
        const listener = { callback, types };
        listeners.add(listener);
        return () => listeners.delete(listener);
      },

      emit: (paths: P[]) => {
        if (listeners.size === 0 || !GetNodeFuncInited) return;

        const batch = new Map<P, { rawNode: Node; type?: string }>();
        for (const path of paths) {
          const targetNode = getNodeByPath(path);
          if (targetNode) {
            batch.set(path, {
              rawNode: targetNode,
              type: (targetNode as any).type, 
            });
          }
        }

        listeners.forEach(({ callback, types }) => {
          const filteredMap: Record<string, any> = {};
          let hasMatchedData = false;

          batch.forEach((info, path) => {
            const isTarget = !types || (info.type && types.includes(info.type));

            if (isTarget) {
              // 🌟 拨乱反正：不再使用 {...viewNode} 解构！
              // 恢复你原本的逻辑：交出带有 readOnly 保护的 Proxy
              const viewNode = info.rawNode.proxy || info.rawNode.createView();
              filteredMap[path as string] = new Proxy(viewNode, readOnlyHandler);
              
              hasMatchedData = true;
            }
          });

          if (hasMatchedData) {
            callback(filteredMap);
          }
        });
      },
    };
  };

  meshRenderGateModule.isMeshModuleInited = true;
  return meshRenderGateModule;
};
 
(useMeshRenderGate as any).isMeshModuleInited = false;
 

export { useMeshRenderGate };