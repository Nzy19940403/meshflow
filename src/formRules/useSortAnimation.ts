 
import {MeshPath,useScheduler} from '@meshflow/core';

// 1. 定义动画节点的基础结构
export type AnimItemSchema = {
  type: "anim-item";
  name: string;
  value: number;
};

export type AnimRootSchema = {
  type: "group";
  name: string;
  children: AnimItemSchema[];
};

// 2. 渲染层的附加属性（坐标、状态等）
type RenderAnimExtra = {
  path: string;
  dirtySignal: any;
  state: {
    val: number;
    posIndex: number; // 绘制核心：逻辑位置
    status: 'idle' | 'active' | 'swapping';
  };
  dependOn: (cb: (...args: any) => void) => void;
};

export type RenderAnimItem = AnimItemSchema & RenderAnimExtra;

/*----------------------------------------------------------------------------------------------------*/

export const useSortAnimation = <T, P extends MeshPath>(
  scheduler: ReturnType<typeof useScheduler<T, P>>,
  rootSchema: any[]
) => {
  const itemVnodeViews: any[] = [];
  const itemEntityViews: any[] = [];
  const BAR_WIDTH = 40;
  const GAP = 10;

  rootSchema.forEach((data, index) => {
    const rawPath = data.name;
    const vnodePath = `vnode.${rawPath}` as P;
    const entityPath = rawPath as P;

    const logicalNode = scheduler.registerNode({
      path: vnodePath,
      type: "vnode",
     
      state: { value: data.value, posIndex: index },
      meta: { ...data, entityPath, uid: index ,},
 
      notifyKeys: new Set(["posIndex", "value"]),
      
 
   
    });

    const entityNode = scheduler.registerNode({
      path: entityPath,
      type: 'entity',
   
      state: { x: index * (BAR_WIDTH + GAP), isChoosed: false,posIndex:1 },
      meta: { ...data, width: BAR_WIDTH,posIndex:1  },
  
      notifyKeys: new Set(['x']),
  
 
      
    });

    itemVnodeViews.push(logicalNode.createView({ path: vnodePath }));
    itemEntityViews.push(entityNode.createView({ path: entityPath }));
  });

  // 🌟 中介节点：存储全网快照
  const coordinatorPath = "vnode.system.coordinator" as P;
  const coordinatorNode = scheduler.registerNode({
    path: coordinatorPath,
    type: "vnode",
 
    state: { 
      // 存储结构：{ [path]: { pos: number, val: number, uid: number } }
      worldState: {} as Record<string, { pos: number, val: number, uid: number }>,
      version:0
    },
    meta: { name: "coordinator" ,worldState: {},version:0},
 
    notifyKeys: new Set(["worldState"]), // 核心：监听快照变化
 
 
   
  });
 
  return {
    vnodes: itemVnodeViews,
    entities: itemEntityViews,
    coordinator: coordinatorNode.createView({ path: coordinatorPath }),
  };
};