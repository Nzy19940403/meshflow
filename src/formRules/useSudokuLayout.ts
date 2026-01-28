import { useScheduler, MeshPath, MeshFlowTaskNode } from "@meshflow/core";

// --- 1. 严格的类型定义 ---
export interface CellState {
  value: number | null;
  candidates: number[];
}

export interface CellMeta {
  index: number;
  row: number;
  col: number;
  box: number;
}

export interface JudgementState {
  // 记录 "某个区域的某个数字" 唯一对应的格子 path
  // 例如: { "row_0_num_5": "cell_4" } 意味着第0行只有 cell_4 能填 5
  globalDistribution: Record<string, string>;
}

export type SudokuSchema = 
  | { path: string; type: 'cell'; state: CellState; meta: CellMeta; notifyKeys: Set<string>; }
  | { path: 'judgement'; type: 'judgement'; state: JudgementState; meta: {}; notifyKeys: Set<string>; };

// --- 2. 动态生成与注册工厂 ---
export function useSudokuLayout() {
  const _data: any[] = [];

  // 生成 81 个格子
  for (let i = 0; i < 81; i++) {
    const row = Math.floor(i / 9);
    const col = i % 9;
    const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);

    _data.push({
      path: `cell_${i}`,
      type: "cell",
      state: { 
        value: null, 
        candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9] , 
        forbidden: {},
        neighbors: {},
        banned: [],
        isGiven: false
      },
      meta: { index: i, row, col, box,originCandidates: [1,2,3,4,5,6,7,8,9] },
      notifyKeys: new Set([]),
    });
  }

  // 生成上帝视角的法官
  _data.push({
    path: 'judgement',
    type: 'judgement',
    state: { 
      globalDistribution: { unique: {}, pointing: [] },
      cellMap: {},
      rescue: { target: null, deadCells: [], triedCells: []  }
    },
    meta: {},
    notifyKeys: new Set([]),
  });

  // 强转类型以绕过 MeshFlow 的 readonly 字面量检查
  const data = _data as unknown as readonly SudokuSchema[];

  const useSudokuModule = <T, P extends MeshPath>(
    scheduler: ReturnType<typeof useScheduler<T, P>>,
    rootSchema: readonly SudokuSchema[]
  ) => {
    const CellArray: MeshFlowTaskNode<P>['proxy'][] = [];
    let judgementNode: any = null;

    for (let item of rootSchema) {
      const node = scheduler.registerNode(item as any);
      if (item.type === 'cell') {
        CellArray.push(node.createView());
      } else if (item.type === 'judgement') {
        judgementNode = node.createView();
      }
    }

    // 辅助函数：获取一个格子的 20 个邻居
    const getNeighbors = (cellProxy: any) => {
      const { row, col, box } = cellProxy.meta;
      return CellArray.filter(c => 
        c.path !== cellProxy.path && 
        (c.meta.row === row || c.meta.col === col || c.meta.box === box)
      );
    };

    return { CellArray, judgementNode, getNeighbors };
  }

  return { data, useSudokuModule };
}