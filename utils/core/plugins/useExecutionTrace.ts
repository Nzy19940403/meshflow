//表单计算流程的动画

import { BaseMeshEvents, MeshFlowEventsName } from "../types/types";

type NodeStatus = 'idle' | 'pending' | 'calculating' | 'calculated' | 'error' | 'canceled';

export function useExecutionTrace<T>(

) {
  // 存储当前路径的状态快照
  const statusMap = new Map<T, NodeStatus>();

  // 存储每个路径对应的 UI 更新回调
  const callbackMap = new Map<T, (status: NodeStatus) => void>();

  // 保留：记录当前版图，用于重置和熔断时的遍历
  let currentSessionAffected = new Set<T>();

  /**
   * ⚡️ 核心：精准状态更新器 (替代 dispatch)
   * 只触发指定 path 的回调，其他人不打扰
   */
  const updateStatus = (path: T, newStatus: NodeStatus) => {
    // 防抖：状态没变就不触发
    // if (statusMap.get(path) === newStatus) return;

    statusMap.set(path, newStatus);

    // 🎯 精准打击：只通知关注这个 path 的组件
    const cb = callbackMap.get(path);
    if (cb) {
      cb(newStatus);
    }
  };

  const useTrace = ()=>{
    const apply = (api: { 
      on: (event: keyof BaseMeshEvents, cb: (data: any) => void) => void 
    }) => {
      // 1. 全局流点火：新任务开始，重置上一轮
      api.on( MeshFlowEventsName.FlowStart , () => {
         
        currentSessionAffected.forEach(p => updateStatus(p, 'idle'));
        currentSessionAffected.clear();
        statusMap.clear();
      
      });
  
      // 2. 释放点火：标记为待命状态
      api.on( MeshFlowEventsName.NodeRelease , ({ path ,type}) => {
        if(type==1||type==2){
          
          currentSessionAffected.add(path);
          updateStatus(path, 'pending');
        }
        // currentSessionAffected.add(path);
        // if (!statusMap.has(path) || statusMap.get(path) === 'idle') {
        //   updateStatus(path, 'pending');
        // }
      });

      api.on( MeshFlowEventsName.NodePending ,({path})=>{
        
         currentSessionAffected.add(path);
        if (!statusMap.has(path) || statusMap.get(path) === 'idle') {
          updateStatus(path, 'pending');
        }
      })
  
      // 3. 计算启动：正式施工
      api.on( MeshFlowEventsName.NodeStart , ({ path }: { path: T }) => {
        // if(path==='cloudConsole.billing.totalPrice'){
        //   debugger
        // }
        currentSessionAffected.add(path);
        updateStatus(path, 'calculating');
      
      });
  
      // 4. 计算成功：完成施工
      api.on( MeshFlowEventsName.NodeSuccess , ({ path }: { path: T }) => {
        updateStatus(path, 'calculated');
      });
  
      // 5. 路径终结信号：确保 UI 不会悬挂
      api.on( MeshFlowEventsName.NodeIntercept , ({ path ,type}) => {
        //3是节点正在被计算的拦截信号,所以显示正在被计算
        if(type==3){
          updateStatus(path, 'calculating');
        }

        if(type==6){
          updateStatus(path, 'idle');
        }

      });
      api.on( MeshFlowEventsName.NodeStagnate , ({ path } ) => {
        updateStatus(path, 'pending')
      });
      api.on( MeshFlowEventsName.NodeError , ({ path } ) => updateStatus(path, 'error'));
    };

    return { apply }
  }


  
  /**
   * 🔌 订阅接口
   */
  const SetTrace = (
    myPath: T,
    onUpdate: (newStatus: NodeStatus) => void, // 这里类型变了
  ) => {
    // 1. 注册回调
    callbackMap.set(myPath, onUpdate);

    // 2. ⚡️ 立即回放当前状态 (防止组件刚挂载时状态不同步)
    const currentStatus = statusMap.get(myPath) || 'idle';
    onUpdate(currentStatus);

    // 3. 返回卸载函数
    return {
      cancel:() => {
        callbackMap.delete(myPath);
      }
    };
  };

  return {  SetTrace ,useTrace};
}
