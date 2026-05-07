import { useScheduler } from "@meshflow/core";

export const useTableData = (scheduler: ReturnType<typeof useScheduler<any, string>>) => {
  // 定义初始节点配置
 
  const nodes = [
    { id: 'N1', label: '核心 1', formula: 'N2 * 0.5 + N4 * 0.5 + 2' },
    { id: 'N2', label: '核心 2', formula: 'N1 * 0.4 + N3 * 0.4 + N5 * 0.2' },
    { id: 'N3', label: '核心 3', formula: 'N2 * 0.8 + 5' },
    { id: 'N4', label: '核心 4', formula: 'N1 * 0.3 + N5 * 0.3 + N7 * 0.4' },
    { id: 'N5', label: '枢纽 5', formula: '(N2 + N4 + N6 + N8) / 4' }, // 中心节点受四方影响
    { id: 'N6', label: '核心 6', formula: 'N3 * 0.3 + N5 * 0.3 + N9 * 0.4' },
    { id: 'N7', label: '核心 7', formula: 'N4 * 0.7 + N8 * 0.3' },
    { id: 'N8', label: '核心 8', formula: 'N7 * 0.4 + N5 * 0.2 + N9 * 0.4' },
    { id: 'N9', label: '核心 9', formula: 'N6 * 0.5 + N8 * 0.5' },
  ];

  return {
    list: nodes.map(n => scheduler.registerNode({
      path: n.id,
      type:'cell',
      state: { count: -1 },
      meta: { label: n.label, formula: n.formula },
      notifyKeys: new Set(['count'])
    }).createView())
  };
  
};