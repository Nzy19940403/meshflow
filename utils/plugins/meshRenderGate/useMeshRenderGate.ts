import { MeshFlowTaskNode, MeshPath } from "@meshflow/core";

type MeshRenderGateModule<P extends MeshPath> = {
  init: () => void;
  onDirty: (callback: (dirtyNodes: Record<string, any>) => void, types?: string[]) => () => void;
  emit: (paths: P[]) => void;
};

export const useMeshRenderGate = () => {
  let getNodeByPath: ((path: any) => any) | null = null;
  const listeners = new Set<{
    callback: (dirtyNodes: Record<string, any>) => void;
    types?: string[];
  }>();

  const moduleFactory = <P extends MeshPath, Node extends MeshFlowTaskNode<P>>(
    getResolve: () => (uid: number) => Node
  ): MeshRenderGateModule<P> => {
    
    return {
      init: () => {
        if (getNodeByPath) return;
        getNodeByPath = getResolve();
      },

      onDirty: (callback, types) => {
        const listener = { callback, types };
        listeners.add(listener);
        return () => listeners.delete(listener); 
      },

      emit: (paths: P[]) => {
        if (listeners.size === 0 || !getNodeByPath) return;

        // 遍历所有监听器
        listeners.forEach(({ callback, types }) => {
          
          // 这个 Record 是本帧唯一不可避免的微小分配，用于交接给 Vue
          const filteredMap: Record<string, any> = {};
          let hasMatchedData = false;

          for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            
            // 1. 防御性查询
            const targetNode = getNodeByPath!(path);
            if (!targetNode) continue; 

            // 2. 检查节点类型是否匹配
            const nodeType = (targetNode as any).type;
            if (types && !types.includes(nodeType)) continue;

            // 🌟 3. 终极绝杀：直接剥削底层的劳动力！
            // 既然底层节点在创建时就已经维护好了 proxy，直接拿它的引用，绝对不要做二次包装！
            if (targetNode.proxy) {
              filteredMap[path as string] = targetNode.proxy;
              hasMatchedData = true;
            } else {
              // 极度边缘的兜底逻辑：如果真有没 proxy 的野节点，走原始对象或 createView
              filteredMap[path as string] = typeof targetNode.createView === 'function' 
                ? targetNode.createView() 
                : targetNode;
              hasMatchedData = true;
            }
          }

          if (hasMatchedData) {
            callback(filteredMap);
          }
        });
      },
    };
  };

  (moduleFactory as any).isMeshModuleInited = true;
  return moduleFactory;
};

(useMeshRenderGate as any).isMeshModuleInited = false;