//表单计算流程的动画

 

export function useExecutionTrace<T>(
  GetNextDependency: (path: T) => T[]
) {
  const activeSet = new Set<T>();
  const callbackMap = new Map<
    T,
    (batch: T[], finishedArray: T[]) => void
  >();

  // 核心：记录当前这波联动的全量版图
  let currentSessionAffected = new Set<T>();

  let finishedSet = new Set<T>();

  const dispatch = () => {
    const snapshot = Array.from(activeSet);

    callbackMap.forEach((cb) => cb(snapshot, Array.from(finishedSet)));
  };

  const pushExecution = (paths: T[], clean?: boolean) => {
    // console.log('本次联动的全量版图:', currentSessionAffected);
    // console.log("本次新增paths:" + paths);
    if (clean) {
      currentSessionAffected.clear();
      finishedSet.clear();
      activeSet.clear();
    }

    if (paths.length == 0) return;
    const allDescendants =  new Set<T>();

    paths.forEach((p)=>{
       let list = GetNextDependency(p);
      list.forEach((item)=>{
        allDescendants.add(item)
      })
     
    })

    paths.forEach((p) => {
      activeSet.add(p);

      // 2. 【深度预判】只要有一个新路径进来，就把它所有可能的“后代”全部标记为 pending
      if (!currentSessionAffected.has(p)) {
        currentSessionAffected.add(p);
        // 递归拿到 p 的所有下游，不管现在算没算到它们

        Array.from(allDescendants).forEach((desc) => {
          currentSessionAffected.add(desc);
        });
      }
    });
    
    dispatch();
  };

  const popExecution = (paths: T[], clean?: boolean) => {
    // console.log(paths);
    // if(paths.includes('cloudConsole.specs.storage.capacity')){
    //     debugger
    // }

    paths.forEach((p) => {
      if (activeSet.has(p)) {
        activeSet.delete(p);
        // 【核心逻辑】只要从 active 移除，就标记为已完成
        finishedSet.add(p);
      }
    });
    dispatch();
  };

  const SetTrace = (
    myPath: T,
    onUpdate: (newStatus: any) => void,
    context: any
  ) => {
    const internalCallback = (batch: T[], finishedArray: T[]) => {
      const newStatus = calculateStatus<T>(
        myPath,
        batch,
        Array.from(currentSessionAffected),
        finishedArray
      );

      onUpdate(newStatus);
    };

    callbackMap.set(myPath, internalCallback);

    return () => {
      callbackMap.delete(myPath);
    };
  };

  return { pushExecution, popExecution, SetTrace };
}
export function calculateStatus<T>(
  myPath: T,
  activeBatch: T[],
  affectedPaths: T[],
  finishedArray: T[]
) {
  const myLevel = affectedPaths.indexOf(myPath);

  if (myLevel === -1) return "idle";

  if (activeBatch.includes(myPath)) return "calculating";
  if (finishedArray.includes(myPath)) return "calculated";
  if (activeBatch.length === 0) return "calculated";

  return "pending";
}
