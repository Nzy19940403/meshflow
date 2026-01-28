//表单计算流程的动画

import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";

export function useExecutionTrace(
  GetNextDependency: (path: AllPath) => AllPath[]
) {
  const activeSet = new Set<AllPath>();
  const callbackMap = new Map<
    AllPath,
    (batch: AllPath[], finishedArray: AllPath[]) => void
  >();

  // 核心：记录当前这波联动的全量版图
  let currentSessionAffected = new Set<AllPath>();

  let finishedSet = new Set<AllPath>();

  const dispatch = () => {
    const snapshot = Array.from(activeSet);

    callbackMap.forEach((cb) => cb(snapshot, Array.from(finishedSet)));
  };

  const pushExecution = (paths: AllPath[], clean?: boolean) => {
    // console.log('本次联动的全量版图:', currentSessionAffected);
    // console.log("本次新增paths:" + paths);
    if (clean) {
      currentSessionAffected.clear();
      finishedSet.clear();
      activeSet.clear();
    }

    if (paths.length == 0) return;
    const allDescendants =  new Set<AllPath>();

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

  const popExecution = (paths: AllPath[], clean?: boolean) => {
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
    myPath: AllPath,
    onUpdate: (newStatus: any) => void,
    context: any
  ) => {
    const internalCallback = (batch: AllPath[], finishedArray: AllPath[]) => {
      const newStatus = calculateStatus(
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
export function calculateStatus(
  myPath: AllPath,
  activeBatch: AllPath[],
  affectedPaths: AllPath[],
  finishedArray: AllPath[]
) {
  const myLevel = affectedPaths.indexOf(myPath);

  if (myLevel === -1) return "idle";

  if (activeBatch.includes(myPath)) return "calculating";
  if (finishedArray.includes(myPath)) return "calculated";
  if (activeBatch.length === 0) return "calculated";

  return "pending";
}
