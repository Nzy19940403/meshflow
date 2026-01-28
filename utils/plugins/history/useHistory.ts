export type HistoryActionItem = {
  undoAction: () => void;
  redoAction: () => void;
};

export interface HistoryMethods {
  Undo: () => void;
  Redo: () => void;
  PushIntoHistory: (action: HistoryActionItem, cleanRedo?: boolean) => void;
  CreateHistoryAction: (
    metadata: [{ path: string; value: any }, { path: string; value: any }],
    cb: (meta: { path: string; value: any }) => void
  ) => HistoryActionItem;
  updateUndoSize: (cb: (newVal: number) => any) => void;
  updateRedoSize: (cb: (newVal: number) => any) => void;
}

// 🌟 重新定义 Factory 类型，确保它返回的是纯粹的 HistoryMethods
export type HistoryModuleFactory = {
  (maxStep?: number): HistoryMethods; // 明确只返回 Methods
  isMeshModuleInited: boolean;
};

const useHistory = (maxStep?: number): HistoryModuleFactory => {
  const historyUndoList: Array<HistoryActionItem> = [];
  const historyRedoList: Array<HistoryActionItem> = [];
  let currentMaxStep = 100;
  if (maxStep !== undefined) currentMaxStep = maxStep;
  const status = {
    canRedo: () => {},
    canUndo: () => {},
  };

  // 1. 定义核心逻辑函数
  const historyModule = ((): HistoryMethods => {
 
    const PushIntoRedoHistory = (action: HistoryActionItem) => {
      historyRedoList.push(action);
      if (historyRedoList.length > currentMaxStep) historyRedoList.shift();
      status.canRedo();
      status.canUndo();
    };

    const PushIntoHistory = (action: HistoryActionItem, cleanRedo: boolean = true) => {
      if (cleanRedo) historyRedoList.length = 0;
      historyUndoList.push(action);
      if (historyUndoList.length > currentMaxStep) historyUndoList.shift();
      status.canUndo();
      status.canRedo();
    };

    // 🌟 返回纯粹的对象，不带任何 factory 的元属性
    return {
      Undo: () => {
        if (!historyUndoList.length) return;
        const actionItem = historyUndoList.pop()!;
        actionItem.undoAction();
        PushIntoRedoHistory(actionItem);
      },
      Redo: () => {
        if (!historyRedoList.length) return;
        const actionItem = historyRedoList.pop()!;
        actionItem.redoAction();
        PushIntoHistory(actionItem, false);
      },
      PushIntoHistory,
      CreateHistoryAction: (metadata, cb) => {
        const [oldMeta, newMeta] = metadata;
        return {
          undoAction: () => cb(oldMeta),
          redoAction: () => cb(newMeta),
        };
      },
      updateUndoSize: (cb) => { status.canUndo = () => cb(historyUndoList.length); },
      updateRedoSize: (cb) => { status.canRedo = () => cb(historyRedoList.length); },
    };
  }) as HistoryModuleFactory; // 🌟 强制断言为 Factory 类型

  historyModule.isMeshModuleInited = true;
  return historyModule;
};

// 静态标记
(useHistory as any).isMeshModuleInited = false;

export { useHistory };