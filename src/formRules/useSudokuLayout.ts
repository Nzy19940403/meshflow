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
  globalDistribution: Record<string, string>;
}

export type SudokuSchema = 
  | { path: string; type: 'cell'; state: CellState; meta: CellMeta; notifyKeys: Set<string>; }
  | { path: 'judgement'; type: 'judgement'; state: JudgementState; meta: {}; notifyKeys: Set<string>; };

// --- 2. 动态生成与注册工厂 ---
// 🚀 核心修改：传入 size (默认 9，可以传 16)
export function useSudokuLayout(size: number = 9) {
  const _data: any[] = [];
  
  // 算出子宫格的边长 (比如 size=9 时 subSize=3, size=16 时 subSize=4)
  const subSize = Math.sqrt(size);
  if (!Number.isInteger(subSize)) {
    throw new Error("⚠️ 玩脱了老哥！数独的边长必须是完全平方数 (如 9, 16, 25)");
  }

  const totalCells = size * size;

  // 动态生成候选数数组：[1, 2, 3, ..., size]
  const initialCandidates = Array.from({ length: size }, (_, i) => i + 1);

  // 🚀 生成 N * N 个格子
  for (let i = 0; i < totalCells; i++) {
    const row = Math.floor(i / size);
    const col = i % size;
    // 🧠 核心拓扑数学：计算当前格子属于哪个大 Box
    const box = Math.floor(row / subSize) * subSize + Math.floor(col / subSize);

    _data.push({
      path: `cell_${i}`,
      type: "cell",
      state: { 
        value: null, 
        // 记得用展开语法切断引用，防止所有格子共享同一个数组内存！
        candidates: [...initialCandidates], 
        forbidden: {},
        neighbors: {},
        banned: [],
        isGiven: false,
        version:-1
      },
      meta: { 
        index: i, 
        row, 
        col, 
        box, 
        originCandidates: [...initialCandidates] 
      },
      notifyKeys: new Set([]),
    });
  }

  // 生成上帝视角的法官 (保持不变)
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

    // 🌟 这个辅助函数你写得太绝了！它直接依赖 meta，所以完美兼容 16x16，一行都不用改！
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