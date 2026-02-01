//表单计算流程的动画

type NodeStatus = 'idle' | 'pending' | 'calculating' | 'calculated' | 'error' | 'canceled';

export function useExecutionTrace<T>(
  GetNextDependency: (path: T) => T[]
) {
  // ♻️ 替换：不再需要 activeSet/finishedSet，用一个 Map 记录所有人的状态
  const statusMap = new Map<T, NodeStatus>();

  // ♻️ 替换：回调不再接收数组，而是直接接收当前的状态字符串
  const callbackMap = new Map<T, (status: NodeStatus) => void>();

  // 保留：记录当前版图，用于重置和熔断时的遍历
  let currentSessionAffected = new Set<T>();

  /**
   * ⚡️ 核心：精准状态更新器 (替代 dispatch)
   * 只触发指定 path 的回调，其他人不打扰
   */
  const updateStatus = (path: T, newStatus: NodeStatus) => {
    // 防抖：状态没变就不触发
    if (statusMap.get(path) === newStatus) return;

    statusMap.set(path, newStatus);

    // 🎯 精准打击：只通知关注这个 path 的组件
    const cb = callbackMap.get(path);
    if (cb) {
      cb(newStatus);
    }
  };

  const pushExecution = (paths: T[], clean?: boolean) => {
    // 1. 清理逻辑：如果是新一轮联动，先把上一轮的人都重置为 idle
    if (clean) {
      currentSessionAffected.forEach(p => updateStatus(p, 'idle'));
      currentSessionAffected.clear();
      statusMap.clear();
    }

    if (paths.length === 0) return;

    // 2. 核心逻辑：当前正在执行的节点 -> calculating
    paths.forEach((p) => {
      // 记录版图
      if (!currentSessionAffected.has(p)) {
        currentSessionAffected.add(p);
      }
      
      // 更新状态：变蓝/闪烁
      updateStatus(p, 'calculating');

      // 3. 【深度预判】(保留你的逻辑)
      // 找到所有下游，如果它们还没状态，就标记为 pending (等待中/变黄)
      const nextDeps = GetNextDependency(p);
      nextDeps.forEach((desc) => {
        if (!currentSessionAffected.has(desc)) {
          currentSessionAffected.add(desc);
          // 仅当它还没有状态时才设为 pending，防止覆盖掉已经 calculating 的
          if (!statusMap.has(desc)) {
            updateStatus(desc, 'pending');
          }
        }
      });
    });
  };

  const popExecution = (paths: T[]) => {
    paths.forEach((p) => {
      // 核心逻辑：执行完成 -> calculated (变绿)
      updateStatus(p, 'calculated');
    });
  };

  /**
   * 🛑 新增：熔断处理
   * 当 path 报错时调用
   */
  const markError = (errorPath: T) => {
    // 1. 报错节点变红
    updateStatus(errorPath, 'error');

    // 2. 扫荡战场：所有还在等待(pending)或者计算中(calculating)的节点，强制变灰(canceled)
    currentSessionAffected.forEach((p) => {
      const current = statusMap.get(p);
      if (p !== errorPath && (current === 'pending' || current === 'calculating')) {
        updateStatus(p, 'canceled');
      }
    });
  };

  /**
   * 🔌 订阅接口
   */
  const SetTrace = (
    myPath: T,
    onUpdate: (newStatus: NodeStatus) => void, // 这里类型变了
    context: any
  ) => {
    // 1. 注册回调
    callbackMap.set(myPath, onUpdate);

    // 2. ⚡️ 立即回放当前状态 (防止组件刚挂载时状态不同步)
    const currentStatus = statusMap.get(myPath) || 'idle';
    onUpdate(currentStatus);

    // 3. 返回卸载函数
    return () => {
      callbackMap.delete(myPath);
    };
  };

  return { pushExecution, popExecution, markError, SetTrace };
}
