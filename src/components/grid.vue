<template>
    <v-container class="pa-8">
      <v-row>
        <v-col cols="12" md="8">
          <div class="d-flex justify-space-between mb-4 align-center">
            <div class="text-h5 font-weight-bold">
              高精度流体实验室 ({{ GRID_SIZE }}x{{ GRID_SIZE }})
            </div>
            <v-btn color="primary" prepend-icon="mdi-flash" @click="applyInitialForce">
              引爆中心核弹负载
            </v-btn>
          </div>
  
          <div 
            :style="{ 
              display: 'grid', 
              gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`, 
              gap: '12px' 
            }"
          >
            <v-card
              v-for="cell in cells"
              :key="cell.path" 
              :elevation="cell.calledBy === 1 ? 12 : 3"
              :color="getLoadColor(cell.value)"
              class="pa-4 transition-swing d-flex flex-column align-center justify-center cursor-pointer"
              :style="cell.calledBy === 1 ? 'border: 2px solid white; transform: scale(1.02);' : 'border: 2px solid transparent'"
              height="120"
              @click="injectTraffic(cell)"
              v-ripple
            >
              <div class="text-h4 font-weight-black text-white" :key="cell.dirtySignal.value">
                {{ (cell.value || 0).toFixed(2) }}
              </div>
              
              <div class="text-caption text-white mt-1 opacity-80">
                节点 {{ cell.path.split("_").slice(1).join(",") }}
              </div>
  
              <div class="text-caption text-white mt-2 opacity-50" style="font-size: 0.6rem !important;">
                点击注入流量
              </div>
  
              <v-icon v-if="cell.calledBy === 1" color="white" size="small" class="position-absolute top-0 right-0 ma-2">
                mdi-sync
              </v-icon>
            </v-card>
          </div>
        </v-col>
  
        <v-col cols="12" md="4">
          <v-card class="mb-4" color="blue-grey-darken-4" theme="dark">
            <v-card-text>
              <div class="text-overline text-grey">物理大盘总承载量 (验证守恒)</div>
              <div class="text-h2 text-success font-weight-bold">{{ realTimeTotal.toFixed(2) }}</div>
              <div class="text-caption text-grey mt-2">不论网格内部如何剧烈震荡，此数字应稳如磐石。</div>
            </v-card-text>
          </v-card>
  
          <v-card title="行/列压力" subtitle="区域负载总和" variant="outlined">
            <v-list density="compact" class="overflow-y-auto" max-height="500">
              <v-list-item v-for="s in summaries" :key="s.path">
                <template v-slot:prepend>
                  <v-icon size="small" :color="(s.value / GRID_SIZE) > 80 ? 'red' : 'grey'">mdi-wave</v-icon>
                </template>
                <v-list-item-title class="text-caption">{{ s.path }}</v-list-item-title>
                <template v-slot:append>
                  <v-chip size="small" :key="s.dirtySignal.value" label variant="flat" :color="getLoadColor(s.value / GRID_SIZE)">
                    {{ (s.value || 0).toFixed(2) }}
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </template>
  
  <script setup lang="ts">
  import { useMeshFlow } from "@/utils/core/engine/useEngineManager";
  import { useBalanceGrid, GRID_SIZE } from "@/src/formRules/useBalanceGrid";
  import { computed, ref, onMounted } from "vue";
  import { useLogger } from '@/utils/plugins/logger/useLogger';
  
  const getLoadColor = (val: number) => {
    const safeVal = val || 0;
    if (safeVal < 60) return 'success';
    if (safeVal <= 85) return 'warning';
    return 'error';
  };
  
  const generateMetadata = (size: number) => {
    const meta: any = { grid: {}, summary: {}, monitor: { balance: { value: 0 } } };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        meta.grid[`cell_${r}_${c}`] = { value: 0 };
      }
    }
    for (let i = 0; i < size; i++) {
      meta.summary[`row_${i}`] = { value: 0 };
      meta.summary[`col_${i}`] = { value: 0 };
    }
    meta.summary['diag_0'] = { value: 0 };
    meta.summary['diag_1'] = { value: 0 };
    return meta;
  };
  
  const engine = useMeshFlow("balance-grid", generateMetadata(GRID_SIZE), {
      UITrigger: {
          signalCreator: () => ref(0),
          signalTrigger: (signal) => { signal.value++ }
      },
      config: { useGreedy: true },
      modules: { useBalanceGrid },
  });
  
  const cancel = useLogger();
  engine.config.usePlugin(cancel);
  
  const { cells, summaries, monitor } = engine.modules.balanceGrid;
  const gridSize = computed(() => Math.floor(Math.sqrt(cells.length)));
  const monitorNode = monitor[0]; 
  
  const realTimeTotal = computed(() => {
      return cells.reduce((sum, cell) => {
          const _ = cell.dirtySignal.value; 
          return sum + (cell.value || 0);
      }, 0);
  });
  
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // ==========================================
  // 1. 因果层：区域监控大盘
  // ==========================================
  summaries.forEach(sView => {
      engine.config.SetRules(sView.meta.inputs, sView.path, 'value', {
        logic: async ({ slot }) => {
          // 直接返回累加值，不再进行 round
          return slot.triggerTargets.reduce((prev: any, cur: any) => (prev || 0) + (cur.value || 0), 0);
        },
      });
  });
  
  engine.config.SetRules(monitorNode.meta.inputs, monitorNode.path, 'value', {
      logic: async ({ slot }) => {
          await sleep(500);
          return slot.triggerTargets.reduce((prev: any, cur: any) => (prev || 0) + (cur.value || 0), 0);
      }
  });
  
  // ==========================================
  // 🌟 2. 绝对守恒层：全向原子对冲
  // ==========================================
  cells.forEach((cell, idx) => {
    const row = Math.floor(idx / GRID_SIZE);
    const col = idx % GRID_SIZE;
  
    const neighbors: any[] = [];
    if (row > 0) neighbors.push(cells[idx - GRID_SIZE]);
    if (row < GRID_SIZE - 1) neighbors.push(cells[idx + GRID_SIZE]);
    if (col > 0) neighbors.push(cells[idx - 1]);
    if (col < GRID_SIZE - 1) neighbors.push(cells[idx + 1]);
  
    neighbors.forEach(neighbor => {
      engine.config.useEntangle({
        observer: cell.path,
        target: neighbor.path,
        triggerKeys:['value'],
        emit:  (me, target) => {
          const vMe = me.value || 0;
          const vTarget = target.value || 0;
          const diff = vMe - vTarget;
  
          // 🌟 精度修改 4: 只有压差大于 0.01 时才流动
          if (diff <= 0.01) return;

          // await sleep(Math.random() * 100);
          const flow = diff * 0.02; 
          return { key: 'value', delta: flow, weight: 1 };
        }
      });
  
      engine.config.useEntangle({
        observer: cell.path,
        target: cell.path, 
        triggerKeys:['value'],
        emit: (me, target) => {
          const nNode = engine.modules.balanceGrid.cells.find(c => c.path === neighbor.path);
          const vMe = me.value || 0;
          const vNei = nNode.value || 0;
          const diff = vMe - vNei;
  
          if (diff <= 0.01) return;
          // await sleep(Math.random() * 100);
          const flow = diff * 0.02;
          return { key: 'value', delta: -flow, weight: 1 };
        }
      });
    });
  });
  
  const applyInitialForce = () => {
      cells.forEach(c => engine.data.SetValue(c.path, 'value', 20.00));
      setTimeout(() => {
          const centerIdx = Math.floor(cells.length / 2);
          engine.data.SetValue(cells[centerIdx].path, 'value', 500.00);
      }, 200);
  };
  
  const injectTraffic = (cell: any) => {
      const current = cell.value || 0;
      engine.data.SetValue(cell.path, 'value', current + 150.00);
  };
  
  onMounted(() => {
    //   cells.forEach(c => engine.data.SetValue(c.path, 'value', 20.00));
      engine.config.notifyAll();
  });
  </script>