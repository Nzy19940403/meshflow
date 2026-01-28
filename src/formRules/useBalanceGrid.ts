import { MeshPath } from "@meshflow/core";
import { useScheduler } from '@/utils/core/engine/useScheduler';

// 🌟 这里统一控制维度，5 就是 5x5 的矩阵！
export const GRID_SIZE = 5; 

export const useBalanceGrid = <T, P extends MeshPath>(scheduler: ReturnType<typeof useScheduler<T, P>>) => {
  const cellViews: any[] = [];
  const summaryViews: any[] = [];
  const monitorViews: any[] = [];

  // --- 1. 注册 25 个原子格子 (Cells) ---
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const vPath = `grid.cell_${r}_${c}` as P;
      const cellNode = scheduler.registerNode({
        path: vPath,
        type: "cell",
     
        state: { value: 0 },
        meta: { row: r, col: c },
        notifyKeys: new Set(["value"]),
      
 
     
      });
      cellViews.push(cellNode.createView({ path: vPath }));
    }
  }

  // --- 2. 注册 10 条行、列中介节点 (Rows & Cols) ---
  for (let i = 0; i < GRID_SIZE; i++) {
    // 动态行
    const rowInputs = Array.from({ length: GRID_SIZE }, (_, c) => `grid.cell_${i}_${c}` as P);
    const rowPath = `summary.row_${i}` as P;
    const rowNode = scheduler.registerNode({
      path: rowPath,
      type: "summary",
      state: { value: 0 },
      meta: { group: 'row', index: i, inputs: rowInputs },
      notifyKeys: new Set(["value"]),
    
     
     
    
    });
    summaryViews.push(rowNode.createView({ path: rowPath }));

    // 动态列
    const colInputs = Array.from({ length: GRID_SIZE }, (_, r) => `grid.cell_${r}_${i}` as P);
    const colPath = `summary.col_${i}` as P;
    const colNode = scheduler.registerNode({
      path: colPath,
      type: "summary",
      state: { value: 0 },
      meta: { group: 'col', index: i, inputs: colInputs },
      notifyKeys: new Set(["value"]),
    
 
  
     
    });
    summaryViews.push(colNode.createView({ path: colPath }));
  }

  // --- 3. 注册 2 条对角线节点 (Diagonals) ---
  const mainDiagInputs = Array.from({ length: GRID_SIZE }, (_, i) => `grid.cell_${i}_${i}` as P);
  const antiDiagInputs = Array.from({ length: GRID_SIZE }, (_, i) => `grid.cell_${i}_${GRID_SIZE - 1 - i}` as P);

  const diagPaths = [`summary.diag_0` as P, `summary.diag_1` as P];
  const diagInputs = [mainDiagInputs, antiDiagInputs];

  diagPaths.forEach((path, i) => {
    const diagNode = scheduler.registerNode({
      path: path,
      type: "summary",
      state: { value: 0 },
      meta: { group: 'diag', index: i, inputs: diagInputs[i] },
      notifyKeys: new Set(["value"]),
      
   
   
     
  
    });
    summaryViews.push(diagNode.createView({ path }));
  });

  // --- 4. 注册 1 个全局监控节点 ---
  const monitorInputs = Array.from({ length: GRID_SIZE }, (_, i) => `summary.row_${i}` as P);
  const monitorPath = `monitor.balance` as P;
  const monitorNode = scheduler.registerNode({
    path: monitorPath,
    type: "monitor",
    state: { value: 0 },
    meta: { inputs: monitorInputs },
    notifyKeys: new Set(["value"]),
   
 
   
  });
  monitorViews.push(monitorNode.createView({ path: monitorPath }));

  return { cells: cellViews, summaries: summaryViews, monitor: monitorViews };
};