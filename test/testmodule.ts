import { MeshPath } from '@meshflow/core';
import {useScheduler} from '../utils/core/engine/useEngineManager'
/**
 * 专门为 Vitest 单元测试设计的节点注册模块
 * 摒弃所有业务逻辑，只保留核心的状态原子
 */
export const setupTestNodes = <T, P extends MeshPath>(
  scheduler: ReturnType<typeof useScheduler<T, P>>, // 传入你的 engine 或 scheduler 实例
  nodeConfigs:any 
) => {
  const views: Record<string, any> = {};

  const nodes:any[] = nodeConfigs.nodes
  nodes.forEach((config) => {
    const path = config.path as P;
    
    // 1. 注册基础测试节点
    const node = scheduler.registerNode({
      path: path,
      type: "test-node",
      state: { 
        value: config.initValue,
        count: 0 
      },
      // 这里的 notifyKeys 必须给到位，否则纠缠监听不到
      notifyKeys: new Set(),
      meta:{}
    });
 
    // 2. 收集 View 方便测试直接访问和修改
    views[config.path] = node.createView();
  });

  // 3. 额外注册一个“纪元统计”节点 (可选，用来监控版本更迭)
  const statsPath = "sys.stats" as P;
  const statsNode = scheduler.registerNode({
    path: statsPath,
    type: "stats",
    state: { version: 0 },
    notifyKeys: new Set(),
    meta:{}
  });
  views['stats'] = statsNode.createView({ path: statsPath });

  return views;
};