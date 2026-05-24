export type HistoryActionItem = {
  undoAction: () => void;
  redoAction: () => void;
};

// 🌟 引擎注入给历史模块的执行上下文：现在只需要唯一的正门 batchNotify
export type EngineContext = {
  BN: (updates: { path: string; key: string; value: any }[],source:number) => void;
};

export type MutationData = { path: string; key: string; oldVal: any; newVal: any };

export interface HistoryMethods {
  Undo: () => void;
  Redo: () => void;
  updateUndoSize: (cb: (newVal: number) => void) => void;
  updateRedoSize: (cb: (newVal: number) => void) => void;

  // StartTransaction: () => void;
  // CommitTransaction: (version: number) => void;
  // AbortTransaction: () => void;

  // GetCurrentVersion: () => number;

  // // 🌟 神级重载：单点更新 0 内存分配，批量更新支持数组
  // RecordMutation(path: string, key: string, oldVal: any, newVal: any): void;
  // RecordMutation(mutations: MutationData[]): void;

  // // 🌟 专供 SilentSet 使用的潜行记账 API
  // RecordSilentMutation(path: string, key: string, oldVal: any, newVal: any): void;
}

export type HistoryInitializer = (getEngineCtx: () => EngineContext) => HistoryMethods;

export type HistoryModuleFactory = HistoryInitializer & {
  isMeshModuleInited: boolean;
};

const useHistory = (maxStep?: number): HistoryModuleFactory => {
  let currentMaxStep = maxStep !== undefined ? maxStep : 100;
   
  const initHistory: HistoryInitializer = (getEngineCtx) => {
    const historyUndoList: Array<HistoryActionItem> = [];
    const historyRedoList: Array<HistoryActionItem> = [];
    const status = {
      canRedo: () => {},
      canUndo: () => {},
    };

    let isTransactionActive = false;
    let isRestoring = false; 
    
    let currentVersion = 0;

    const currentMutations = new Map<string, MutationData>();

    // ==========================================
    // 潜行装备：用于缓冲 SilentSet 的孤立修改
    // ==========================================
    const silentBuffer: MutationData[] = [];
    let silentTimer: ReturnType<typeof setTimeout> | null = null;

    // 内部方法：引擎启动时，将潜行区的战利品压平进大账本
    const flushSilentBuffer = () => {
      if (silentBuffer.length > 0) {
        for (let i = 0; i < silentBuffer.length; i++) {
          const m = silentBuffer[i];
          const compositeKey = `${m.path}::${m.key}`;
          if (currentMutations.has(compositeKey)) {
            currentMutations.get(compositeKey)!.newVal = m.newVal;
          } else {
            currentMutations.set(compositeKey, { ...m });
          }
        }
        silentBuffer.length = 0; // 提货完毕即清空
      }
    };

    const abortInternal = () => {
      isTransactionActive = false;
      currentMutations.clear();
      silentBuffer.length = 0; // 发生中止时，也清空潜行区
    };

    return {
      Undo:    () => {
         
        if (!historyUndoList.length || isRestoring) return;
        const actionItem = historyUndoList.pop()!;
        
        
        actionItem.undoAction();
        
        
        historyRedoList.push(actionItem);
        if (historyRedoList.length > currentMaxStep) historyRedoList.shift();
        status.canRedo();
        status.canUndo();
      },

      Redo:   () => {
        if (!historyRedoList.length || isRestoring) return;
        const actionItem = historyRedoList.pop()!;
        
      
        actionItem.redoAction();
       
        
        historyUndoList.push(actionItem);
       
        if (historyUndoList.length > currentMaxStep) historyUndoList.shift();
        status.canUndo();
        status.canRedo();
      },

      StartTransaction: () => {
        if (isTransactionActive) return; // 🌟 无缝上车：已激活则不重置
        isTransactionActive = true;
        currentVersion++;
        
        // 大门开启，立刻提取潜行区的数据
        flushSilentBuffer();
      },
      
      AbortTransaction: abortInternal,

      RecordMutation: (arg1: string | MutationData[], key?: string, oldVal?: any, newVal?: any) => {
        if (isRestoring) return; 
      
        // 自动补票：不管有没有手动 Start，只要有真实变更就强行开门建档
        if (!isTransactionActive) {
          isTransactionActive = true;
          currentVersion++;
          flushSilentBuffer(); // 开门的同时，合并以前藏好的 SilentSet 变更
        }
          
        if (typeof arg1 === 'string') {
          const compositeKey = `${arg1}::${key}`;
          if (currentMutations.has(compositeKey)) {
            // 已有初恋值，仅更新 newVal
            currentMutations.get(compositeKey)!.newVal = newVal;
          } else {
            currentMutations.set(compositeKey, { path: arg1, key: key!, oldVal, newVal });
          }
        } else {
          arg1.forEach(m => {
            const compositeKey = `${m.path}::${m.key}`;
            if (currentMutations.has(compositeKey)) {
              currentMutations.get(compositeKey)!.newVal = m.newVal;
            } else {
              currentMutations.set(compositeKey, { ...m });
            }
          });
        }
      },

      // 🌟 SilentSet 专用口：潜行与自动合并逻辑的核心
      RecordSilentMutation: (path: string, key: string, oldVal: any, newVal: any) => {
        if (isRestoring) return;

        // 场景 A：如果事务正在进行，当作普通的 Mutation 直接记账
        if (isTransactionActive) {
          const compositeKey = `${path}::${key}`;
          if (currentMutations.has(compositeKey)) {
            currentMutations.get(compositeKey)!.newVal = newVal;
          } else {
            currentMutations.set(compositeKey, { path, key, oldVal, newVal });
          }
          return;
        }

        // 场景 B：事务未启动，存入潜行区。处理对同一个 key 的重复修改
        let found = false;
        for (let i = 0; i < silentBuffer.length; i++) {
          if (silentBuffer[i].path === path && silentBuffer[i].key === key) {
            silentBuffer[i].newVal = newVal;
            found = true;
            break;
          }
        }
        if (!found) {
          silentBuffer.push({ path, key, oldVal, newVal });
        }

        // 兜底清道夫：利用宏任务，如果没有任何微任务引发事务启动，则原谅并销毁！
        if (!silentTimer) {
          silentTimer = setTimeout(() => {
            silentTimer = null;
            if (!isTransactionActive && silentBuffer.length > 0) {
              silentBuffer.length = 0; 
            }
          }, 0);
        }
      },

      CommitTransaction: (version: number) => {
        // if (isRestoring) {
        //   isRestoring = false; // 🌟 关键：在这里解锁，即意味着本次 Undo/Redo 彻底结束
        //   currentMutations.clear(); // 🌟 清理掉撤销过程中引发的所有级联副作用
        //   return; // 🌟 掠过记账步骤，直接 return，不给 Undo 列表推东西
        // }

        if (!isTransactionActive || version !== currentVersion) return;
        isTransactionActive = false; // 关门结算
         
        // 核心过滤：剔除所有一顿操作猛如虎，一看位移零点五的节点
        const finalMutations = Array.from(currentMutations.values())
          .filter(m => !Object.is(m.oldVal, m.newVal));

        // 账本已生成，物理清空 Map 准备下一次点火
        currentMutations.clear();

        if (finalMutations.length === 0) return;

        const ctx = getEngineCtx();

        const batchedAction: HistoryActionItem = {
          undoAction: () => {
            ctx.BN(
              finalMutations.map(m => ({ path: m.path, key: m.key, value: m.oldVal })),
              1
            );
          },
          redoAction: () => {
            ctx.BN(
              finalMutations.map(m => ({ path: m.path, key: m.key, value: m.newVal })),
              1
            );
          }
        };
         
        historyRedoList.length = 0;
        historyUndoList.push(batchedAction);
        if (historyUndoList.length > currentMaxStep) historyUndoList.shift();
        
        status.canUndo();
        status.canRedo();
      },
      
      GetCurrentVersion:()=>{
        return currentVersion;
      },
      updateUndoSize: (cb) => { 
        status.canUndo = () => cb(historyUndoList.length); 
        status.canUndo(); 
      },
      updateRedoSize: (cb) => { 
        status.canRedo = () => cb(historyRedoList.length); 
        status.canRedo(); 
      },
    };
  };

  (initHistory as HistoryModuleFactory).isMeshModuleInited = true;
  return initHistory as HistoryModuleFactory;
};

(useHistory as any).isMeshModuleInited = false;

export { useHistory };