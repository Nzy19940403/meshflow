
export type HistoryActionItem = {
    undoAction:()=>void
    redoAction:()=>void
}

export type MeshFlowHistory = {
    Undo: () => void;
    Redo: () => void;
    initCanUndo: any; // 如果是 Vue 可以是 Ref<boolean>
    initCanRedo: any;
    PushIntoHistory:(action: HistoryActionItem, cleanRedo?: boolean) => void,
    CreateHistoryAction:(metadata: [
        { path: string; value: any; }, 
        { path: string; value: any; }
    ], cb: any) => {
        undoAction: () => any;
        redoAction: () => any;
    },
}

export interface MeshFlowEngineMap {}

export type MeshPath = string | number | symbol;