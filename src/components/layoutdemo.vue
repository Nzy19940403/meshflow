<template>
  <div class="dashboard-wrapper">

    <div class="control-panel">
    <div class="mode-selector">
        <div class="selector-label">排版策略：</div>
        <div class="radio-group">
        <label :class="['radio-item', { active: layoutMode === 'oscillation' }]">
            <input type="radio" v-model="layoutMode" value="oscillation" />
            <span class="radio-dot"></span>
            <span class="text">物理震荡 (Entanglement)</span>
        </label>
        <!-- <label :class="['radio-item', { active: layoutMode === 'correction' }]">
            <input type="radio" v-model="layoutMode" value="correction" />
            <span class="radio-dot"></span>
            <span class="text">中心修正 (Direct Judge)</span>
        </label> -->
        </div>
        <button @click="reset">
            reset
        </button>
    </div>
    </div>

    <div class="cell-container">
      <div
        v-for="box in BoxArray"
        class="cell"
        :style="{
          position: 'absolute',
          width: `${box.width}px`,
          height: `${box.height}px`,
          transform: `translate(${box.pos?.x || 0}px, ${box.pos?.y || 0}px)`,
          transition: 'all 0.4s ease',
        }"
      >
        {{ box.path }} 
      </div>
    </div>

    <div class="dashboard-container">
      <div
        v-for="zone in ZoneArray"
        :key="zone.path"
        :class="[
          'energy-box',
          { 'is-overload': zone.currentLoad > zone.capacity },
        ]"
        :style="{
          '--trigger': zone.dirtySignal?.value,
          position: 'absolute',
          left: '0px',
          top: '0px',
          transform: `translate(${zone.position?.x || 0}px, ${
            zone.position?.y || 0
          }px)`,
          transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }"
      >
        <div class="box-header">
          <div class="path-label">
            <span class="status-dot"></span>
            {{ zone.path }}
          </div>
          <div class="controls" style="display: flex; gap: 5px; z-index: 100">
            <button
              @click="changeCapacity(zone.path, -10)"
              style="
                cursor: pointer;
                background: #444;
                color: white;
                border: none;
                padding: 2px 6px;
              "
            >
              -
            </button>
            <button
              @click="changeCapacity(zone.path, 10)"
              style="
                cursor: pointer;
                background: #444;
                color: white;
                border: none;
                padding: 2px 6px;
              "
            >
              +
            </button>
          </div>
          <div class="load-value">
            Max: {{ zone.value }} | {{ Math.round(zone.capacity ) }}%
          </div>
        </div>

        <div class="water-stage">
          <div
            class="water-layer current-load"
            :style="{
              height: `${zone.capacity  }%`,
            }"
          ></div>
          <div
            v-if="zone.currentLoad > zone.capacity"
            class="overload-line"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref,onUnmounted } from "vue";
import {
  useMeshFlow,
  DefaultStrategy,
} from "@/utils/core/engine/useEngineManager";
import { useFlowLayout } from "../formRules/useFlowLayout";
import { useLogger } from "@/utils/plugins/logger/useLogger";
import { deleteEngine } from "@/utils/forms/useMeshForm";
 

const layoutMode = ref('oscillation');

const { data, useFlowLayoutModule } = useFlowLayout();
const engine = useMeshFlow("layout", data, {
  UITrigger: {
    signalCreator: () => ref(0),
    signalTrigger: (signal) => signal.value++,
  },
  config: {
    useGreedy: true,
    // useEntangleStep: 200,
  },
  modules: { flowLayoutModule: useFlowLayoutModule },
});

const cancel = useLogger();
engine.config.usePlugin(cancel);

const { ZoneArray, BoxArray, judgementNode } = engine.modules.flowLayoutModule;

const setupSortingEntangle = () => {
  let isCourtBusy = false;
  // ==========================================================
  // 1. Zone 与 Zone 之间的碰撞排版
  // ==========================================================
  ZoneArray.forEach((nodeA_View) => {


    engine.config.useEntangle({
      observer: nodeA_View.path,
      target: nodeA_View.path,
      triggerKeys: ["currentLoad", "value"], 
      emit: (obs) => {
        const val = obs.value || 1; // 防止除以 0
        const load = obs.currentLoad || 0;
        return {
          key: "capacity",
          value: (load / val) * 100
        };
      }
    })

    ZoneArray.forEach((nodeB_View) => {
      if (nodeA_View.path == nodeB_View.path) return;

      engine.config.useEntangle({
        observer: nodeB_View.path,
        target: nodeA_View.path,
        triggerKeys: ["position"],
        emit: (obsNodeB, tgtNodeA) => {
          const uidA = tgtNodeA.uid;
          const uidB = obsNodeB.uid;
          const gap = 10;
          const zoneW = 260;

          if (uidA > uidB) {
            const posA = tgtNodeA.state.position || { x: 0, y: 0 };
            const posB = obsNodeB.state.position || { x: 0, y: 0 };

            if (posB.x + zoneW > posA.x && posA.x >= posB.x) {
              return {
                key: "position",
                value: {
                  x: posB.x + zoneW + gap,
                  y: posA.y,
                },
              };
            }
          }
          return;
        },
      });
    });
  });

  const boxPaths = BoxArray.map((item) => item.path);

  // ==========================================================
  // 2. Zone 的核心规则与上报（向法官汇报）
  // ==========================================================
  ZoneArray.forEach((zone) => {
    engine.config.SetRules(boxPaths, zone.path, "children", {
      logic: async ({ slot }) => {
        let newChildren = [];
        for (let node of slot.triggerTargets) {
          if (node.parent == zone.path) {
            newChildren.push(node.path);
          }
        }
        return newChildren;
      },
      triggerKeys: ["parent", "path"],
    });



    engine.config.SetRules(boxPaths, zone.path, "currentLoad", {
      logic: async ({ slot }) => {
        let nums = 0;
        for (let node of slot.triggerTargets) {
          if (node.parent == zone.path) {
            nums += node.maxAmount;
          }
        }
        return nums;
      },
      triggerKeys: ["parent", "maxAmount",],
 
    });

    engine.config.SetRule(zone.path, judgementNode.path, "zoneState", {
      logic: ({ slot }) => {
        const [trigger] = slot.triggerTargets;
   
        return {
          [trigger.path]: {
            capacity: trigger.capacity  ,
            value: trigger.value,
          },
        };
      },
      triggerKeys: ["capacity", "path", "value"],
   
    });



    engine.config.SetRule(zone.path, judgementNode.path, "zoneChildren", {
      logic: ({ slot }) => {
        const [trigger] = slot.triggerTargets;
        return {
          [trigger.path]: trigger.children,
        };
      },
      triggerKeys: ["children", "path"],
    });
  });

  boxPaths.forEach((boxpath) => {
    engine.config.SetRule(boxpath, judgementNode.path, "cellAmounts", {
      logic: ({ slot }) => {
        const [trigger] = slot.triggerTargets;
        return {
          [trigger.path]: trigger.maxAmount || 0,
        };
      },
      triggerKeys: ["maxAmount", "path"],
    });
 
  });

  engine.config.SetStrategy(
    judgementNode.path,
    "zoneChildren",
    DefaultStrategy.MERGE
  );
  engine.config.SetStrategy(
    judgementNode.path,
    "cellAmounts",
    DefaultStrategy.MERGE
  );
  engine.config.SetStrategy(
    judgementNode.path,
    "zoneState",
    DefaultStrategy.MERGE
  );
 

  // ==========================================================
  // 3. 物理排版引擎：Zone -> Box 同步基准点
  // ==========================================================

  boxPaths.forEach((boxpath) => {
    ZoneArray.forEach((zone) => {
      engine.config.useEntangle({
        observer: zone.path,
        target: boxpath,
        triggerKeys: ["children"],
        filter: (obs, tgt) => {
          const isMyChild = obs.children.includes(tgt.path);

          return isMyChild;
        },
        emit: (observer, target) => {
            
            const nextX = observer.position.x;
            const nextY = observer.position.y + 160

            if(target.parentPos.x===nextX && target.parentPos.y===nextY) return;

          return {
            key: "parentPos",
            value: {
              x: nextX,
              y: nextY, // 头部留白
            },
          };
        },
      });
    });

// ==========================================================
// 🚀 附加阶段：中心修正专属纠缠（法官一纸定坐标）
// ==========================================================
// boxPaths.forEach((boxpath) => {
//   engine.config.useEntangle({
//     observer: judgementNode.path,
//     target: boxpath,
//     // 监听大区数据变化
//     triggerKeys: ["zoneState", "zoneChildren"], 
//     filter: () => {
//       // 🛡️ 只有在“中心修正”模式下才放行
//       return layoutMode.value === 'correction';
//     },
//     emit: (obs, tgt) => {
//       const currentParent = tgt.parent || "";
//       const isPublicSea = currentParent === "";

//       // 1. 获取我的同居室友，并按 UID 严格排序（保证每次排版绝对一致）
//       let siblings = [];
//       if (isPublicSea) {
//         siblings = BoxArray.filter((b) => !b.parent || b.parent === "");
//       } else {
//         const childrenPaths = obs.zoneChildren?.[currentParent] || [];
//         siblings = BoxArray.filter((b) => childrenPaths.includes(b.path));
//       }

//       siblings.sort((a, b) => a.uid - b.uid);
//       const myIndex = siblings.findIndex((b) => b.path === tgt.path);
      
//       if (myIndex === -1) return;

//       // 2. 布局基准参数（完美对齐你之前的设定）
//       const gap = 10;
//       const padding = 20;
//       const rowHeight = 70;
//       const containerW = isPublicSea ? 99999 : 260; // 公海无限宽，大区260

//       // 3. 获取父级原点坐标
//       let startX = 0;
//       let startY = 0;
//       if (!isPublicSea) {
//         const zoneData = ZoneArray.find((z) => z.path === currentParent);
//         startX = zoneData?.position?.x || 0;
//         startY = (zoneData?.position?.y || 0) + 180; // 头部留白
//       }

//       // 4. 🌟 核心：流式布局模拟推演
//       let nextX = startX + padding;
//       let nextY = startY;

//       // 从老大开始往后算，一直算到我自己的位置
//       for (let i = 0; i <= myIndex; i++) {
//         const box = siblings[i];
//         const boxW = box.width || 60; // 如果找不到宽度，给个兜底

//         // 如果不是排头兵，检查放入当前格子后会不会撑爆边界
//         if (i > 0) {
//           if (nextX + boxW > startX + containerW - padding) {
//             nextX = startX + padding; // 换行：X回到起点
//             nextY += rowHeight;       // 换行：Y往下走一行
//           }
//         }

//         // 算出我的位置了，跳出循环！
//         if (i === myIndex) break;

//         // 如果还没到我，X 轴向右推进，给下一个兄弟腾位置
//         nextX += boxW + gap;
//       }

//       // 5. 终极防抖护盾：如果算出来的坐标和现在一样，拒绝提交（阻断无效渲染）
//       const currentPos = tgt.state?.pos || { x: 0, y: 0 };
//       if (
//         Math.abs(nextX - currentPos.x) < 0.5 &&
//         Math.abs(nextY - currentPos.y) < 0.5
//       ) {
//         return;
//       }

//       // ⚡️ 法官落锤，直接发下绝对坐标
//       return { key: "pos", value: { x: nextX, y: nextY } };
//     }
//   });
// });
    // ==========================================================
    // 4. 👨‍⚖️ 法官逻辑（完美保留你的原版判定，仅注入锁与延时）
    // ==========================================================
    engine.config.useEntangle({
      observer: judgementNode.path,
      target: boxpath,
      triggerKeys: ["zoneState"],
      filter: (obs, tgt) => {
        const currentZone = tgt.parent;
        const myZoneData = obs.zoneState?.[currentZone];
        const isPublicSea = !currentZone || currentZone === "";

        // 如果我在大区，且大区根本没爆满（capacity <= 100），法官你别管我！
        if (!isPublicSea && myZoneData && myZoneData.capacity <= 100) {
          return false; // 拦截！不执行 emit，直接切断因果链
        }
      
        return true; // 爆满了，或者我在公海等分配，放行！
      },
      emit: async (observer, target) => {
        const state = observer.zoneState || {};
        const zoneChildren = observer.zoneChildren || {};
        const cellAmounts = observer.cellAmounts || {};
        const currentZone = target.parent;

        const myAmount = cellAmounts[target.path] || 0;

        // ==========================================================
        // 🌟 情形 A：公海招新
        // ==========================================================
        if (!currentZone || currentZone === "") {
          const publicSeaBoxes = BoxArray.filter(
            (b) => !b.parent || b.parent === ""
          );
          const strongestInSea = publicSeaBoxes.sort(
            (a, b) => a.uid - b.uid
          )[0];

          // 没轮到我，直接闭嘴等下一轮
          if (strongestInSea && strongestInSea.path !== target.path) return;

          // 🔒 核心注入：轮到我了，但看看法官现在忙不忙？忙就退回，等会再试
          if (isCourtBusy) return
          isCourtBusy = true; // 上锁！
           
          try {
            let bestZoneForNewbie: string | null = null;
            let minExpectedCapacity = 100;

            ZoneArray.forEach((z) => {
              const zoneName = z.path;
              const targetZoneData = state[zoneName]  ;
              const targetCapacity = targetZoneData.capacity;
              const targetValue = targetZoneData.value  ;

              const expectedCapacity =
                targetCapacity + (myAmount / targetValue) * 100;

              if (
                expectedCapacity <= 100 &&
                expectedCapacity < minExpectedCapacity
              ) {
                minExpectedCapacity = expectedCapacity;
                bestZoneForNewbie = zoneName;
              }
            });

            if (bestZoneForNewbie) {
              if (target.parent === bestZoneForNewbie) return;

              console.log(
                `📡 [公海招新] UID:${target.uid} 排头兵 ${target.path} 获批归巢至 ${bestZoneForNewbie}`
              );
              return { key: "parent", value: bestZoneForNewbie };
            }
            return;
          } finally {
            // 🔓 必须解锁，不然法庭永远关门
            isCourtBusy = false;
          }
        }

        // ==========================================================
        // 🌟 情形 B：末位淘汰与强权置换
        // ==========================================================
        const myZoneData = state[currentZone] || { capacity: 0, value: 100 };
        const currentCapacity = myZoneData.capacity;

        if (currentCapacity > 100) {
          const childrenInMyZone = zoneChildren[currentZone] || [];
          if (childrenInMyZone.length === 0) return;

          const mySiblings = BoxArray.filter((b) =>
            childrenInMyZone.includes(b.path)
          );
          const targetToKick = mySiblings.sort((a, b) => b.uid - a.uid)[0];

          // 不是最弱的，不关我事
          if (targetToKick.path !== target.path) return;

          // 🔒 核心注入：我是那个倒霉蛋，我要找新家了。先看法庭开没开门！
          if (isCourtBusy) return;
          isCourtBusy = true; // 上锁！

          try {
            let bestEmptyZone: string | null = null;
            let minExpectedCapacity = 100;

            let bestBullyZone: string | null = null;
            let maxWeakestUid = -1;

            ZoneArray.forEach((z) => {
              const zoneName = z.path;
              if (zoneName === currentZone) return;

              const targetZoneData = state[zoneName] || {
                capacity: 0,
                value: 100,
              };
              const targetCapacity = targetZoneData.capacity;
              const targetValue = targetZoneData.value || 100;

              const expectedCapacity =
                targetCapacity + (myAmount / targetValue) * 100;

              // 🕊️ 和平调配
              if (expectedCapacity <= 100) {
                if (expectedCapacity < minExpectedCapacity) {
                  minExpectedCapacity = expectedCapacity;
                  bestEmptyZone = zoneName;
                }
              }
              // ⚔️ 强权置换
              else {
                const targetChildren = zoneChildren[zoneName] || [];
                const targetSiblings = BoxArray.filter((b) =>
                  targetChildren.includes(b.path)
                );
                const weakerGuys = targetSiblings.filter(
                  (b) => b.uid > target.uid
                );

                if (weakerGuys.length > 0) {
                  const weakerTotalAmount = weakerGuys.reduce(
                    (sum, b) => sum + (cellAmounts[b.path] || 0),
                    0
                  );
                  const survivalCapacity =
                    targetCapacity +
                    ((myAmount - weakerTotalAmount) / targetValue) * 100;

                  if (survivalCapacity <= 100) {
                    const weakest = weakerGuys.sort((a, b) => b.uid - a.uid)[0];
                    if (weakest.uid > maxWeakestUid) {
                      maxWeakestUid = weakest.uid;
                      bestBullyZone = zoneName;
                    }
                  }
                }
              }
            });

            // 🌟 恢复你的震荡延时！
            await new Promise((resolve) => setTimeout(resolve, 150));

            if (bestEmptyZone) {
              if (target.parent === bestEmptyZone) return;
              console.log(
                `🕊️ [和平调配] ${target.path} 转移至空闲的 ${bestEmptyZone}`
              );
              return { key: "parent", value: bestEmptyZone };
            } else if (bestBullyZone) {
              if (target.parent === bestBullyZone) return; // 🌟 护盾 2 补上！
              console.log(
                `⚔️ [生存置换] ${target.path} 强行挤入 ${bestBullyZone}，准备踢出 UID:${maxWeakestUid}`
              );
              return { key: "parent", value: bestBullyZone };
            } else {
              if (target.parent === "") return; // 🌟 护盾 3 补上！
              console.log(`💀 [无情剔除] 空间不足，${target.path} 被踢向公海`);
              return { key: "parent", value: "" };
            }
          } finally {
            // 🔓 必须解锁
            isCourtBusy = false;
          }
        }
        return;
      },
    });

    // ==========================================================
    // 5. 🌟 格子自发定位 (排头兵落座 + 小弟入列主动找座位)
    // ==========================================================
    engine.config.useEntangle({
      observer: boxpath,
      target: boxpath,
      triggerKeys: ["parentPos", "parent"],
      filter: (obs, tar) => {
        if (obs.parent !== tar.parent) return false;

        // 🌟 核心拦截：只有震荡模式才允许“自发定位”
        return layoutMode.value === 'oscillation';
      },
      emit: (obs,tgt) => {
        const isPublicSea = !obs.parent || obs.parent === "";
        const siblings = BoxArray.filter((b) => b.parent === obs.parent).sort(
          (a, b) => a.uid - b.uid
        );
        const myIndex = siblings.findIndex((b) => b.path === obs.path);
       
        if (myIndex === -1) return;

        let nextX = 0;
        let nextY = 0;
     

        // 【计算我应该去的位置】
        if (myIndex === 0) {
          if (isPublicSea) {
            nextX = 20;
            nextY = 0;
          } else {
            nextX = (obs.parentPos?.x || 0) + 20;
            nextY = obs.parentPos?.y || 0;
          }
        } else {
          const predecessor = siblings[myIndex - 1];
          const predPos = predecessor.state?.pos || { x: 0, y: 0 };
          const gap = 10;
          const padding = 20;
          const containerW = isPublicSea ? 99999 : 260;
          const rowHeight = 70;
          const pPosX = isPublicSea ? 0 : obs.parentPos?.x || 0;

          nextX = predPos.x + predecessor.width + gap;
          nextY = predPos.y;
          
          const rightBoundary = pPosX + containerW - padding;
          if (nextX + obs.width > rightBoundary) {
            nextX = pPosX + padding;
            nextY = predPos.y + rowHeight;
          }
        }

        // 🌟 终极护盾 4：检查位置是否真的变了！
        const currentPos = obs.state?.pos || { x: 0, y: 0 };
        if (
          Math.abs(nextX - currentPos.x) < 0.5 &&
          Math.abs(nextY - currentPos.y) < 0.5
        ) {
          return; // 原地不动，坚决不交提案，不触发下一级震荡！
        }

        if(tgt.pos.x === nextX && tgt.pos.y === nextY) return;

        return { key: "pos", value: { x: nextX, y: nextY } };
      },
    });
  });

  // ==========================================================
  // 6. 🌟 局部推搡引擎 (带阻尼与单向保护)
  // ==========================================================
  boxPaths.forEach((pathA) => {
    boxPaths.forEach((pathB) => {
      engine.config.useEntangle({
        observer: pathA,
        target: pathB,
        triggerKeys: ["pos","parent"], // 🌟 只盯位置
        filter: (obs, tgt) => {
      
            if (layoutMode.value === 'correction') return false;
    
            return obs.parent === tgt.parent && obs.uid < tgt.uid;
        },
        emit: (obs, tgt) => {
          // 🛑 空间隔离：不同区不推搡
          if (obs.parent !== tgt.parent) return;

          // 🛑 严格序：只有资历老的（UID小）能推资历浅的（UID大）
          if (obs.uid >= tgt.uid) return;

          // 🛑 邻里判定：只推自己身后的那一个
          const siblings = BoxArray.filter((b) => b.parent === obs.parent).sort(
            (a, b) => a.uid - b.uid
          );
          const myIdx = siblings.findIndex((b) => b.path === obs.path);
          if (siblings[myIdx + 1]?.path !== tgt.path) return;

          // --- 计算逻辑 ---
          const isPublicSea = !obs.parent || obs.parent === "";
          const gap = 10;
          const containerW = isPublicSea ? 99999 : 260;
          const pPosX = isPublicSea ? 0 : tgt.parentPos?.x || 0;

          let nextX = obs.pos.x + obs.width + gap;
          let nextY = obs.pos.y;
           
          // 换行
          if (!isPublicSea && nextX + tgt.width > pPosX + containerW - 20) {
            nextX = pPosX + 20;
            nextY = obs.pos.y + 70;
          }

          // 🌟 核心修复：精度死区 (阻尼)
          // 如果计算出的新位置跟现在位置差不到 1px，就认为“已收敛”，不再触发下一级
          const currentPos = tgt.state.pos || { x: 0, y: 0 };
          const dist =
            Math.abs(nextX - currentPos.x) + Math.abs(nextY - currentPos.y);

          if (dist < 1) return; // 🌟 阻断微小震荡传导

          return { key: "pos", value: { x: nextX, y: nextY } };
        },
      });
    });
  });
};

const reset = ()=>{
    let res = [];
    for (let box of BoxArray) {
    res.push({
        path:box.path,
        key:'parent',
        value:'zone1'
    })
    // engine.data.SetValue(box.path, "parent", "zone1");
  };

  engine.data.SetValues(res)
}

engine.hooks.onSuccess(() => {
  // 可以在这里查看最终结算的稳态数据
 
  console.log(123)
});
engine.config.notifyAll();
const changeCapacity = (path: string, delta: number) => {
  const zone = ZoneArray.find((z) => z.path === path);
  if (zone) {
    const newValue = Math.max(1, (zone.value || 0) + delta);
    // 🌟 仅仅修改一个数据，就能触发全链路的“暴力震荡”
    engine.data.SetValue(path, "value", newValue);
  }
};

onMounted(() => {
  setupSortingEntangle();

  let res = [];
  for (let zone of ZoneArray) {
    res.push({
        path:zone.path,
        key:'position',
        value:{ x: 0, y: 0 }
    })
    // engine.data.SetValue(zone.path, "position", { x: 0, y: 0 });
  }

  // 初始将所有人压入 zone1 引爆系统
  for (let box of BoxArray) {
    res.push({
        path:box.path,
        key:'parent',
        value:'zone1'
    })
    // engine.data.SetValue(box.path, "parent", "zone1");
  };

  engine.data.SetValues(res)

});

onUnmounted(() => {
    deleteEngine('layout')
})
</script>

<style scoped>
.dashboard-wrapper {
  background: #0a0a0c;
}

.dashboard-container {
  position: relative;
  padding: 40px;
  height: 900px;
}

.energy-box {
  width: 260px;
  height: 320px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.energy-box.is-overload {
  border-color: #ff4d4f;
  box-shadow: 0 0 15px rgba(255, 77, 79, 0.2);
}

.box-header {
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  z-index: 10;
  font-size: 12px;
  color: white;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #52c41a;
  margin-right: 8px;
}

.is-overload .status-dot {
  background: #ff4d4f;
  animation: pulse 1s infinite;
}

.water-stage {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.water-layer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  transition: height 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.current-load {
  background: linear-gradient(
    180deg,
    rgba(24, 144, 255, 0.2) 0%,
    rgba(24, 144, 255, 0) 100%
  );
  border-top: 1px solid rgba(24, 144, 255, 0.5);
}

.overload-line {
  position: absolute;
  top: 0;
  width: 100%;
  height: 2px;
  background: #ff4d4f;
}

.cell {
  background-color: gray;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  border-radius: 4px;
}
.cell-container {
  height: 100px;
  margin-top: 20px;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}



.control-panel {
  padding: 20px 40px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
}
.mode-selector {
  display: flex;
  align-items: center;
  gap: 15px;
}
.selector-label {
  color: #888;
  font-size: 13px;
}
.radio-group {
  display: flex;
  gap: 10px;
  background: #000;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid #333;
}
.radio-item {
  cursor: pointer;
  padding: 6px 16px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
  position: relative;
}
.radio-item input {
  display: none;
}
.radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #444;
  transition: all 0.3s;
}
.radio-item .text {
  font-size: 12px;
  color: #666;
}
/* 选中状态 */
.radio-item.active {
  background: rgba(24, 144, 255, 0.15);
}
.radio-item.active .radio-dot {
  background: #1890ff;
  box-shadow: 0 0 8px #1890ff;
}
.radio-item.active .text {
  color: #fff;
  font-weight: bold;
}
</style>
