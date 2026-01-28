<template>
    <v-container class="pa-8">
      <v-row>
        <v-col cols="12" md="9">
          <div class="d-flex justify-space-between mb-6 align-center">
            <div>
              <div class="text-h5 font-weight-bold">声明式排序推演实验室</div>
              <div class="text-caption text-grey">
                稳定邻里纠缠模型：时间分片调度 + 边界空气墙 + 等值打破器
              </div>
            </div>
            <v-btn
              color="primary"
              variant="tonal"
              prepend-icon="mdi-shuffle"
              @click="shuffleValues"
            >
              随机打乱势能
            </v-btn>
          </div>
  
          <v-card
            variant="outlined"
            height="400"
            class="d-flex align-end pa-8 overflow-auto bg-grey-darken-4"
          >
            <div class="position-relative flex-grow-1" style="height: 100%">
              <div
                v-for="item in entities"
                :key="item.uid"
                class="position-absolute bottom-0 d-flex flex-column align-center  "
                :style="{
                  '--trigger': item.dirtySignal?.value,
                  left: `${item.x}px`,
                  width: `${item.width}px`,
                  transition: 'left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                }"
              >
              {{ item.posIndex }}
                <v-tooltip
                  location="top"
                  :text="`值: ${item.value || 0} | 逻辑位置: ${item.posIndex}`"
                >
                  <template v-slot:activator="{ props }">
                    <div
                      v-bind="props"
                      :style="{
                        width: `${item.meta.width}px`,
                        height: `${(item.value || 0) * 2.5}px`,
                        backgroundColor: getBarColor(item.value || 0),
                     
                      }"
                      class="rounded-t-lg d-flex align-center justify-center elevation-4"
                    >
                      <span
                        class="text-caption font-weight-black text-white"
                        style="transform: rotate(-90deg)"
                      >
                        {{ (item.value || 0).toFixed(0) }}
                      </span>
                    </div>
                  </template>
                </v-tooltip>
                <div class="mt-2 text-caption text-grey-lighten-1 font-mono">
                  L{{ item.posIndex }}
                </div>
              </div>
            </div>
          </v-card>
        </v-col>
  
        <v-col cols="12" md="3">
          <v-card class="mb-4" color="indigo-darken-4" theme="dark">
            <v-card-text>
              <div class="text-overline opacity-70">系统状态</div>
              <div
                class="text-h4 font-weight-bold"
                :key="vnodes[0]?.dirtySignal?.value"
              >
                {{ isStable ? "✅ 稳态" : "🔄 推演中" }}
              </div>
            </v-card-text>
          </v-card>
  
          <v-card title="逻辑排位详情" variant="outlined">
            <v-list density="compact">
              <v-list-item v-for="v in vnodes" :key="v.path">
                <v-list-item-title class="text-caption">{{
                  v.path.split(".").pop()
                }}</v-list-item-title>
                <template v-slot:append>
                  <v-chip size="x-small" label :key="v.dirtySignal.value"
                    >Idx: {{ v.posIndex }}</v-chip
                  >
                </template>
              </v-list-item>
            </v-list>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </template>
  
  <script setup lang="ts">
  import { ref, onMounted } from "vue";
  import { useMeshFlow } from "@/utils/core/engine/useEngineManager";
  import { useSortAnimation } from "@/src/formRules/useSortAnimation";
  import { useLogger } from "@/utils/plugins/logger/useLogger";
  
  const initialData = Array.from({ length: 60 }, (_, i) => ({
    type: "anim-item" as const,
    name: `item_${i}`,
    value: Math.floor(Math.random() * 100) + 10,
    width: 40,
  }));
  
  const engine = useMeshFlow("sorting-lab", initialData, {
    UITrigger: {
      signalCreator: () => ref(0),
      signalTrigger: (signal) => {
        signal.value++;
      },
    },
    config: { 
      useGreedy: true, 
      // useEntangleStep: 10
    },
    modules: { useSortAnimation },
  });
  
  const cancel = useLogger();
  engine.config.usePlugin(cancel);
  
  const { vnodes, entities, coordinator } = engine.modules.sortAnimation;
  const isStable = ref(true);
 
  
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  const setupSortingPhysics = () => {
    const GAP = 12; // 稍微调大一点点间距
    const BAR_WIDTH = 40;
    const MIN_IDX = 0;
    const MAX_IDX = vnodes.length - 1;
  
    // ==========================================
    // 1. 微观局部法则：邻居间的推搡与让位
    // ==========================================
    vnodes.forEach((vView) => {
      vnodes.forEach((otherView) => {
        if (vView.path === otherView.path) return;
        const myIdMatch = vView.path.match(/\d+/);
        const tarIdMatch = otherView.path.match(/\d+/);
        const myId = myIdMatch ? parseInt(myIdMatch[0], 10) : 0;
        const tarId = tarIdMatch ? parseInt(tarIdMatch[0], 10) : 0;
  
        engine.config.useEntangle({
          observer: vView.path,
          target: otherView.path,
          triggerKeys: ["posIndex", "value"],
          emit:   (me, target) => {
            const myVal = me.value || 0;
            const tarVal = target.value || 0;
            const myIdx = me.posIndex;
            const tarIdx = target.posIndex;
            const diff = tarIdx - myIdx;
            const isTarBigger = tarVal > myVal || (tarVal === myVal && tarId > myId);
  
            // await sleep(15); 
  
            // 处理重叠
            if (diff === 0) {
              if (!isTarBigger && myIdx > MIN_IDX) return { key: "posIndex", value: myIdx - 1 ,weight:2};
              if (isTarBigger && myIdx < MAX_IDX) return { key: "posIndex", value: myIdx + 1 ,weight:2};
              return;
            }
            // 邻居交换
            if (diff === -1 && isTarBigger) return { key: "posIndex", value: tarIdx + 1 ,weight:2};
            if (diff === 1 && !isTarBigger) return { key: "posIndex", value: tarIdx - 1 ,weight:2};
          },
        });
      });
  
      // 坐标渲染映射
      engine.config.SetRule(vView.path, vView.meta.entityPath, "posIndex", {
        logic: ({slot}) => slot.triggerTargets[0].posIndex,
        triggerKeys: ["posIndex"],
        effect: (args) => ({
          x: args.posIndex * (BAR_WIDTH + GAP),
          isChoosed: true,
        }),
        effectArgs: ["posIndex"],
      });
    });
  
    // ==========================================
    // 🌟 2. 宏观中介者：注入全场“真空吸力”场
    // ==========================================
    
    // A. 将所有节点的实时状态同步给 Coordinator
    engine.config.SetRules(vnodes.map(item => item.path), coordinator.path, 'worldState', {
      logic: ({ slot }) => {
        const newWorld = slot.affectedTatget || {};
        slot.triggerTargets.forEach(vnode => {
          newWorld[vnode.path] = {
            pos: vnode.posIndex,
            val: vnode.value,
            uid: vnode.uid
          };
        });
        return { ...newWorld };
      },
      triggerKeys: ['posIndex', 'value', 'uid', 'path']
    });
  
   
  // 在 setupSortingPhysics 内部
vnodes.forEach((vView) => {
  engine.config.useEntangle({
    observer: coordinator.path,
    target: vView.path,
    triggerKeys: ["version"], // 只有当 onSuccess 触发版本更新时，审计才上班
    emit:   (observer, target) => {
      const world = observer.worldState;
      // if (!world) return;

      const myPath = target.path;
      const myData = world[myPath];
      // if (!myData) return;

      // 🌟 核心逻辑：计算全场名次
      // 将所有节点按 posIndex 排序，posIndex 相同的按 UID 排序
      const allNodes = Object.keys(world).map(path => ({
        path,
        ...world[path]
      }));

      allNodes.sort((a, b) => {
        if (a.pos !== b.pos) return a.pos - b.pos;
        return a.uid - b.uid; // UID 作为重叠时的最终打破者
      });

      // 找到我在全场中应该排在第几个（这就是理想的连续索引）
      const idealPos = allNodes.findIndex(n => n.path === myPath);

      // 如果当前位置和理想位置不一致（说明有空洞或重叠）
      if (myData.pos !== idealPos) {
        // 给一点点微小的延迟，让审计过程在视觉上有一个“咔哒”入位的捕捉感
        // await sleep(10); 
        
        // 这里的 weight 设置为 1 即可，因为此时局部规则已经静止
        return { 
          key: "posIndex", 
          value: idealPos, 
          weight: 1 
        }  ;
      }
    }
  });
});
  };
  
  const getBarColor = (val: number) => `hsl(${val * 1.2}, 70%, 50%)`;
  
  const shuffleValues = () => {
    isStable.value = false;
  

    let obj: any = [];
    
    vnodes.forEach((v, i) => {
      const num = Math.floor(Math.random() * 100) + 10;
      obj.push({ path: v.path, key: "value", value: num });
      obj.push({ path: v.entityPath, key: "value", value: num });

      engine.data.SetValue(v.entityPath, 'value', num);
      engine.data.SetValue(v.path, 'value', num);
    });
  
    // 🌟 强烈建议这里用批量更新 SetValues 替代循环 SetValue！
    // engine.data.SetValues(obj);
 
  };
  
  engine.hooks.onSuccess(() => {
    const world = engine.data.GetValue(coordinator.path, 'worldState');
    const allNodes = Object.values(world) as any[];

    // 2. 🌟 执行“终极审计”：检查是否有重叠或空隙
    // 这是一个 O(N) 的简单检查
    const posSet = new Set(allNodes.map(n => n.pos));
    const isBroken = posSet.size !== vnodes.length || Math.max(...posSet) !== vnodes.length - 1;
  
    if (isBroken) {
      // 情况 A：还没排好（有重叠或空洞）
      console.log("--- 审计未通过，启动修正脉冲 ---");
 
      // 拨动版本号。这会诱发中介者发出 Proposal
      // 只要有 Proposal，引擎就会开启新一轮 Task，跑完后会再次回到 onSuccess
      const ver = engine.data.GetValue(coordinator.path, 'version')  ;
      engine.data.SetValue(coordinator.path, 'version', ver + 1);
      
    } else {
      // 情况 B：全场逻辑已自洽
      console.log("--- 审计通过，系统达成终极稳态 ---");
      isStable.value = true;
    }
    
  });
  
  onMounted(() => {
    isStable.value = false;
    setupSortingPhysics();
    engine.config.notifyAll();
  });
  </script>
  
  <style scoped>
  .transition-all {
    transition: all 3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .font-mono {
    font-family: "Courier New", Courier, monospace;
  }
  </style>