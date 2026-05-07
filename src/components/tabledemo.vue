<template>
  <div class="meshflow-dashboard">
    <div class="dashboard-container">
      
      <header class="dashboard-header">
        <div class="header-titles">
          <h1>Meshflow Matrix <span>9-Node Entanglement</span></h1>
          <p class="subtitle description">
            <strong>The "Iterative Relaxation" Showcase:</strong> This matrix features intentionally injected cyclic dependencies. 
            Corner nodes (e.g., N1) depend on cross nodes (e.g., N2), and cross nodes reverse-depend on corners. 
            Click <strong>"🚀 Ignite Core"</strong> to inject 1000 energy into N5. Watch MeshFlow gracefully handle the cyclic oscillation (preventing Stack Overflow) and collapse the system into a perfect <strong>1000-500-250</strong> equilibrium.
          </p>
        </div>
        
        <div class="header-actions">
          <div class="action-group">
            <div class="control-group">
              <span class="control-label">Async Evolution:</span>
              <label class="toggle-switch">
                <input type="checkbox" v-model="isAsyncMode">
                <span class="slider"></span>
              </label>
            </div>

            <div class="ignition-group">
              <span class="ignition-label">Ignition Energy:</span>
              <input 
                type="number" 
                v-model="ignitionValue" 
                class="ignition-input"
              />
            </div>
          </div>

          <div class="action-group">
            <button class="btn btn-primary" @click="resetSystem">
              🚀 Ignite Core (N5)
            </button>
            <button class="btn btn-danger" @click="randomPerturb">
              🎲 Chaos Perturbation
            </button>
          </div>
        </div>
      </header>

      <div class="matrix-grid">
        <div v-for="node in list" :key="node.path" class="node-card">
          <div class="node-header">
            <div class="node-identity">
              <span class="node-path">{{ node.path }}</span>
              <span class="node-label">{{ node.meta.label || 'Node' }}</span>
            </div>
            <span class="node-signal">⚡ PUSH: {{ node.dirtySignal.value }}</span>
          </div>

          <div class="node-formula">
            <div class="formula-label">Entanglement Formula:</div>
            <input 
              v-model="node.meta.formula" 
              placeholder=""
              class="formula-input"
            />
          </div>

          <div class="node-projection">
            <div class="projection-label">UI Integer Projection (Collapsed State)</div>
            <input 
              type="number"
              :value="Math.round(node.state.count)"
              @input="e => onUpdate(node, (e.target as HTMLInputElement).valueAsNumber)"
              class="projection-input"
            />
            <div class="raw-value">
              Raw Kinetic Energy: {{ typeof node.state.count === 'number' ? node.state.count.toFixed(4) : node.state.count }}
            </div>
          </div>
        </div>
      </div>

      <div class="charts-wrapper">
        <div class="chart-box">
          <div class="chart-title">Causal Topology Matrix (Entanglement Heatmap)</div>
          <div id="heatmap-container" ref="heatmapRef"></div>
        </div>
        
        <div class="chart-box">
          <div class="chart-title">Convergence Pulse Trajectory (Iterative Relaxation)</div>
          <div id="timeline-container" ref="timelineRef"></div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { deleteEngine, useMeshFlow } from '@meshflow/core';
import { useTableData } from '../formRules/tabledemo'; // 保持你本地的路径
import { useLogger } from "@meshflow/logger";
import { useMeshPulse } from '@/utils/plugins/meshPulse/useMeshPulse'; // 保持你本地的路径
import VChart from '@visactor/vchart';
import { useHistory } from '@meshflow/history';

// 🌟 Default ignition to 1000 for the perfect 1000-500-250 visual
const ignitionValue = ref(1000);
const isAsyncMode = ref(true); 

const heatmapRef = ref<HTMLElement | null>(null);
const timelineRef = ref<HTMLElement | null>(null);
let heatmapInstance: VChart | null = null;
let timelineInstance: VChart | null = null;

// 1. Initialize Engine
const engine = useMeshFlow('9-mesh-solver', [], {
  UITrigger: { 
    signalCreator: () => ref(0), 
    signalTrigger: (signal) => signal.value++ 
  },
  config: { 
    useGreedy: true, 
    useEntangleStep: 1000 
  },
  modules: { useTableData, useHistory }
});

const undo = () => {
  engine.modules.history.Undo();
};

// 🌟 Dual Channel Data Distribution for Charts
const pulse = useMeshPulse({
  onTrace(rawData: any) {
    if (!heatmapInstance || !timelineInstance || !rawData) return;

    const epochsArray = Array.isArray(rawData) ? rawData : [rawData];
    if (epochsArray.length === 0) return;

    const frequencyMap: Record<string, any> = {};
    const timelineData: any[] = [{ epoch: '', count: 0 }]; 

    epochsArray.forEach((epochObj) => {
      timelineData.push({
        epoch: epochObj.epoch,
        count: epochObj.emits?.length || 0
      });

      epochObj.emits?.forEach((item: any) => {
        if (!item.cause || !item.impact) return;
        const key = `${item.cause}_${item.impact}`;
        if (!frequencyMap[key]) {
          frequencyMap[key] = { cause: item.cause, impact: item.impact, count: 0 };
        }
        frequencyMap[key].count += 1;
      });
    });

    heatmapInstance.updateData('heatmapData', Object.values(frequencyMap));
    timelineInstance.updateData('timelineData', timelineData);
  }
});
engine.config.usePlugin(pulse);

const { list } = engine.modules.tableData;

// 🌟 The 1000-500-250 Cyclic Equilibrium Formulas
const applyDefaultFormulas = () => {
  const formulaMap: Record<string, string> = {
    // Corners: strictly 50% of the average of adjacent cross nodes. Target = 250.
    'N1': '(N2 + N4) * 0.25',
    'N3': '(N2 + N6) * 0.25',
    'N7': '(N4 + N8) * 0.25',
    'N9': '(N6 + N8) * 0.25',

    // Crosses: Cyclic Dependency injected here!
    // Depends 80% on N5, and 20% back on the corners. Target = 500.
    'N2': '(N5 * 0.4) + (N1 + N3) * 0.2',
    'N4': '(N5 * 0.4) + (N1 + N7) * 0.2',
    'N6': '(N5 * 0.4) + (N3 + N9) * 0.2',
    'N8': '(N5 * 0.4) + (N7 + N9) * 0.2',

    'N5': '' // Core Ignition
  };

  list.forEach(node => {
    if (formulaMap[node.path] !== undefined) {
      node.meta.formula = formulaMap[node.path];
    }
  });
};

const onUpdate = (node: any, val: number) => {
  engine.data.SetValue(node.path, "count", val || 0);
};

// 3. Clean Reset & Ignite
const resetSystem = () => {
  try {
    list.forEach(node => {
        engine.data.SilentSet(node.path, "count", 0);
    });
    engine.data.SetValue("N5", "count", ignitionValue.value || 0);
  } catch (e) {
    console.error("Engine reset exception:", e);
  }
};

// 4. Chaos Test
const randomPerturb = () => {
  list.forEach(node => {
    const randomVal = 100 + Math.random() * 800; 
    engine.data.StageValue(node.path, "count", randomVal);
  });
};

// 5. Dynamic Solver Setup
const setupDynamicSolver = () => {
  const threshold = 0.001; 

  list.forEach(targetNode => {
    const otherNodes = list.filter(n => n.path !== targetNode.path);
    
    otherNodes.forEach(causeNode => {
      engine.config.useEntangle({
        cause: causeNode.path,
        impact: targetNode.path,
        via: ["count"],
        emit:  async (src, tgt, propose) => {
          const formula = tgt.meta.formula;
          if (!formula || !formula.includes(causeNode.path)) return;
          
            const context: any = {};
            list.forEach(n => context[n.path] = n.state.count ?? 0);
            
            const runner = new Function(...Object.keys(context), `return ${formula}`);
            const raw = runner(...Object.values(context));

            if (typeof raw !== 'number' || isNaN(raw)) return;

            const current = tgt.state.count ?? 0;
            
            if (isAsyncMode.value) {
              await new Promise((resolve) => setTimeout(resolve, 15)); // 10ms visually pleasing delay
            }

            if (Math.abs(raw - current) > threshold) {
              propose.set("count", raw);
            }
        }
      });
    });
  });
};

onMounted(() => {
  applyDefaultFormulas(); 
  setupDynamicSolver();
  
  // ==========================================
  // Chart 1: Heatmap
  // ==========================================
  if (heatmapRef.value) {
    heatmapInstance = new VChart({
      type: 'common',
      data: [{ id: 'heatmapData', values: [] }],
      series: [{
          // @ts-ignore
        type: 'heatmap',
        xField: 'cause', yField: 'impact', valueField: 'count',
        cell: { style: { fill: { field: 'count', type: 'linear', range: ['#1e293b', '#38bdf8', '#f59e0b', '#e11d48'] } } },
        label: { visible: true, style: { fill: '#ffffff', fontSize: 11 } }
      }],
      axes: [
        { orient: 'bottom', type: 'band', title: { visible: true, text: 'Source Node (Cause)', style: { fill: '#94a3b8' } }, label: { style: { fill: '#94a3b8' } } },
        { orient: 'left', type: 'band', title: { visible: true, text: 'Target Node (Impact)', style: { fill: '#94a3b8' } }, label: { style: { fill: '#94a3b8' } } }
      ],
      tooltip: { mark: { title: { value: 'Entanglements' } } }
    }, { dom: heatmapRef.value });
    heatmapInstance.renderSync();
  }

  // ==========================================
  // Chart 2: Convergence Pulse (Area Chart)
  // ==========================================
  if (timelineRef.value) {
    timelineInstance = new VChart({
      type: 'common',
      data: [{ id: 'timelineData', values: [] }],
      series: [{
        type: 'area',
        xField: 'epoch', yField: 'count',
        area: { style: { fill: 'linear-gradient(to top, rgba(56,189,248,0.6), rgba(56,189,248,0))' } },
        line: { style: { stroke: '#38bdf8', lineWidth: 2 } },
        point: { visible: true, style: { fill: '#0f172a', stroke: '#38bdf8', lineWidth: 2 } }
      }],
      axes: [
        { orient: 'bottom', type: 'band', title: { visible: true, text: 'Epoch', style: { fill: '#94a3b8' } }, label: { style: { fill: '#94a3b8' } } },
        { orient: 'left', type: 'linear', title: { visible: true, text: 'Instantaneous Load', style: { fill: '#94a3b8' } }, label: { style: { fill: '#94a3b8' } }, grid: { style: { stroke: '#334155', lineDash: [4, 4] } } }
      ],
      tooltip: { mark: { title: { value: 'Load' } } }
    }, { dom: timelineRef.value });
    timelineInstance.renderSync();
  }

  engine.config.notifyAll();

  // Auto-ignite for first-time viewers
  setTimeout(() => {
    resetSystem();
  }, 500);
     
});

onUnmounted(() => {
  deleteEngine('9-mesh-solver');
  if (heatmapInstance) heatmapInstance.release();
  if (timelineInstance) timelineInstance.release();
});
</script>

<style scoped>
.meshflow-dashboard {
  --primary-blue: #38bdf8;
  --accent-purple: #a78bfa;
  --warning-amber: #f59e0b;
  --danger-rose: #e11d48;
  --bg-darker: #0f172a;
  --bg-card: #1e293b;
  --border-color: #334155;

  background: var(--bg-darker);
  min-height: 100vh;
  color: #f8fafc;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  padding: 16px;
  transition: all 0.3s ease;
}

.dashboard-container {
  max-width: 1200px;
  margin: 0 auto;
}

.dashboard-header {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 32px;
}

@media (min-width: 1024px) {
  .dashboard-header {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
  }
}

.header-titles {
  max-width: 650px;
}

.header-titles h1 {
  margin: 0;
  color: var(--primary-blue);
  font-size: clamp(20px, 5vw, 28px);
  font-weight: 800;
  text-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
}

.header-titles h1 span {
  font-size: 14px;
  color: #64748b;
  margin-left: 12px;
  border-left: 1px solid var(--border-color);
  padding-left: 12px;
  font-weight: 400;
}

/* 🌟 Explanation text styling */
.description {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.6;
  margin-top: 12px;
  background: rgba(56, 189, 248, 0.05);
  border-left: 3px solid var(--primary-blue);
  padding: 10px 16px;
  border-radius: 0 6px 6px 0;
  font-family: system-ui, -apple-system, sans-serif;
}
.description strong {
  color: #e2e8f0;
}

.header-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

@media (min-width: 768px) {
  .header-actions {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-end;
    width: auto;
  }
}

.action-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  flex: 1;
}

.control-group, .ignition-group, .btn {
  flex: 1; 
  min-width: 130px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0 12px;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.btn {
  border: none;
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
}

.btn-primary { background: #0ea5e9; color: white; }
.btn-danger { background: var(--danger-rose); color: white; }
.btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
.btn:active { transform: translateY(0); }

.control-label, .ignition-label {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
}

.ignition-input {
  background: transparent;
  border: none;
  color: var(--primary-blue);
  font-size: 16px;
  font-weight: bold;
  width: 100%;
  max-width: 60px;
  outline: none;
  text-align: right;
}

.matrix-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.node-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, border-color 0.2s;
}

.node-card:hover {
  border-color: #475569;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -5px rgba(0, 0, 0, 0.3);
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.node-path {
  background: var(--primary-blue);
  color: var(--bg-darker);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 900;
  font-size: 14px;
}

.node-label { margin-left: 8px; color: #94a3b8; font-size: 12px; }

.node-signal {
  font-size: 10px;
  color: var(--warning-amber);
  background: rgba(245, 158, 11, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.formula-input {
  width: 100%;
  background: var(--bg-darker);
  border: 1px solid #475569;
  color: var(--accent-purple);
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 8px;
  outline: none;
  box-sizing: border-box;
}

.formula-input:focus {
  border-color: var(--accent-purple);
  box-shadow: 0 0 0 1px var(--accent-purple);
}

.node-projection {
  margin-top: 20px;
  background: rgba(15, 23, 42, 0.4);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.projection-input {
  width: 100%;
  background: transparent;
  border: none;
  color: #fff;
  font-size: clamp(24px, 4vw, 36px);
  font-weight: 800;
  text-align: center;
  outline: none;
  transition: color 0.3s;
}

.projection-input:focus { color: var(--primary-blue); }

.raw-value {
  font-size: 11px;
  color: #10b981;
  margin-top: 12px;
  text-align: right;
  border-top: 1px solid var(--border-color);
  padding-top: 10px;
  opacity: 0.8;
}

.toggle-switch {
  width: 36px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slider:before {
  height: 12px;
  width: 12px;
  left: 3px;
  bottom: 3px;
}

input:checked + .slider:before {
  transform: translateX(18px);
}

.charts-wrapper {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 40px;
}

.chart-box {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.chart-title {
  font-size: 14px;
  color: #94a3b8;
  margin-bottom: 20px;
  border-left: 4px solid var(--primary-blue);
  padding-left: 10px;
  font-weight: 600;
}

#heatmap-container, #timeline-container {
  width: 100%;
  height: 400px;
}
</style>