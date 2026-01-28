<template>
  <div class="dashboard-wrapper">
    <div class="control-panel">
      <div class="mode-selector">
        <div class="selector-label">解题策略：</div>
        <div class="radio-group">
          <label :class="['radio-item', { active: layoutMode === 'oscillation' }]">
            <input type="radio" v-model="layoutMode" value="oscillation" />
            <span class="radio-dot"></span>
            <span class="text">约束坍缩 (Constraint Collapse)</span>
          </label>
        </div>
      </div>
      <div class="controls">
        <button class="replay-btn" @click="replay">
          <span class="icon">⚡</span> 坍缩重放
        </button>
        <button class="reset-btn" @click="reset">
          <span class="icon">↻</span> 清空棋盘
        </button>
      </div>
    </div>

    <div class="playground" @click="selectedCell = null">
      
      <div class="status-toast-container" :class="{ visible: gameStatus !== 'playing' }">
        <div class="status-toast" :class="gameStatus">
          <span v-if="gameStatus === 'solved'" class="toast-icon pulse-animation">🎉🎉🎉</span>
          <span v-if="gameStatus === 'failed'" class="toast-icon shake-animation">💀💥💀</span>
          <span class="toast-msg">
            {{ gameStatus === 'solved' ? '物理约束已收敛，全盘坍缩完成！' : '拓扑网络死锁，请根据案发现场排查！' }}
          </span>
          <span v-if="gameStatus === 'solved'" class="toast-icon pulse-animation">🎉🎉🎉</span>
          <span v-if="gameStatus === 'failed'" class="toast-icon shake-animation">💀💥💀</span>
        </div>
      </div>

      <div class="playground-canvas" style="display: flex; justify-content: center; padding-top: 100px">
        <div class="sudoku-board">
          <div
            v-for="cell in CellArray"
            :key="cell.path"
            class="cell"
            @click.stop="handleCellClick(cell)"
            :class="{
              'has-value': cell.value !== null,
              'border-r': cell.col % 3 === 2 && cell.col !== 8,
              'border-b': cell.row % 3 === 2 && cell.row !== 8,
              'is-selected': selectedCell?.path === cell.path,
              'is-dead-end': deadEndCells.includes(cell.path),
              'is-suspect': suspectCells.includes(cell.path)
            }"
            :style="{
              '--trigger': cell.dirtySignal.value,
              position: 'absolute',
              top: '0px',
              left: '0px',
              width: '56px',
              height: '56px',
              transform: `translate(${cell.col * 58}px, ${cell.row * 58}px)`,
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }"
          >
            <div v-if="cell.value !== null" class="final-value">
              {{ cell.value }}
            </div>
            <div v-else class="candidates-grid" :style="{ opacity: cell.candidates.length < 9 ? 1 : 0.1 }">
              <span v-for="n in 9" :key="n" :class="['c-num', { hidden: !cell.candidates.includes(n) }]">
                {{ n }}
              </span>
            </div>
            <div v-if="cell.banned && cell.banned.length > 0" class="banned-badge">
              💀 {{ cell.banned.length }}
            </div>
          </div>

          <div
            v-if="selectedCell"
            class="editor-popover"
            @click.stop
            :style="{
              left: selectedCell.col > 4 ? (selectedCell.col * 58 - 140) + 'px' : (selectedCell.col * 58 + 65) + 'px',
              top: (selectedCell.row * 58 - 10) + 'px'
            }"
          >
            <div class="popover-title">干预 [行{{selectedCell.row + 1}}列{{selectedCell.col + 1}}]</div>
            <div class="popover-input-group">
              <input
                ref="inputRef"
                type="number"
                min="0" max="9"
                v-model.number="editInputValue"
                @keyup.enter="applyEdit"
                placeholder="0-9"
              />
              <button class="btn-confirm" @click="applyEdit">注入</button>
            </div>
            <div class="popover-hint">输入 1-9 修改，输入 0 清空</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, onUnmounted, nextTick } from "vue";
import { useMeshFlow, deleteEngine } from "@/utils/core/engine/useEngineManager";
import { useSudokuLayout } from "../formRules/useSudokuLayout";
import { useLogger } from "@meshflow/logger";

const layoutMode = ref("oscillation");

const selectedCell = ref<any>(null);
const editInputValue = ref<number | "">("");
const inputRef = ref<HTMLInputElement | null>(null);

// 🌟 取证状态记录 & 全局游戏状态
const isDeadlocked = ref(false);
const deadEndCells = ref<string[]>([]); // 遇害者
const suspectCells = ref<string[]>([]); // 嫌疑人
const gameStatus = ref<'playing' | 'solved' | 'failed'>('playing'); 

const handleCellClick = async (cell: any) => {
  selectedCell.value = cell;
  editInputValue.value = cell.value !== null ? cell.value : "";
  await nextTick();
  if (inputRef.value) inputRef.value.focus();
};

const applyEdit = () => {
  if (!selectedCell.value) return;
  const path = selectedCell.value.path;
  const val = editInputValue.value;

  if (val === 0 || val === "") {
    engine.data.SetValues([
      { path, key: "value", value: null },
      { path, key: "isGiven", value: false }
    ]);
  } else if (typeof val === "number" && val >= 1 && val <= 9) {
    engine.data.SetValues([
      { path, key: "value", value: val },
      { path, key: "isGiven", value: true } // 🌟 用户填的值保护起来
    ]);
  }

  // 🌟 如果用户手动干预了，清空报错状态让系统继续跑
  isDeadlocked.value = false;
  deadEndCells.value = [];
  suspectCells.value = [];
  gameStatus.value = 'playing';

  selectedCell.value = null;
};

const { data, useSudokuModule } = useSudokuLayout();
const engine = useMeshFlow("sudoku_engine", data, {
  UITrigger: {
    signalCreator: () => ref(0),
    signalTrigger: (signal) => signal.value++,
  },
  config: { useGreedy: true },
  modules: {   useSudokuModule  },
});

const cancel = useLogger();
  // engine.config.usePlugin(cancel);

const { CellArray, judgementNode } = engine.modules.sudokuModule;

const startSolving = () => {
  isDeadlocked.value = false;
  deadEndCells.value = [];
  suspectCells.value = [];
  gameStatus.value = 'playing';

  const puzzle = [
    { r: 0, c: 0, v: 5 }, { r: 0, c: 1, v: 3 }, { r: 0, c: 4, v: 7 },
    { r: 1, c: 0, v: 6 }, { r: 1, c: 3, v: 1 }, { r: 1, c: 4, v: 9 }, { r: 1, c: 5, v: 5 },
    { r: 2, c: 1, v: 9 }, { r: 2, c: 2, v: 8 }, { r: 2, c: 7, v: 6 },
    { r: 3, c: 0, v: 8 }, { r: 3, c: 4, v: 6 }, { r: 3, c: 8, v: 3 },
    { r: 4, c: 0, v: 4 }, { r: 4, c: 3, v: 8 }, { r: 4, c: 5, v: 3 }, { r: 4, c: 8, v: 1 },
    { r: 5, c: 0, v: 7 }, { r: 5, c: 4, v: 2 }, { r: 5, c: 8, v: 6 },
    { r: 6, c: 1, v: 6 }, { r: 6, c: 6, v: 2 }, { r: 6, c: 7, v: 8 },
    { r: 7, c: 3, v: 4 }, { r: 7, c: 4, v: 1 }, { r: 7, c: 5, v: 9 }, { r: 7, c: 8, v: 5 },
    { r: 8, c: 4, v: 8 }, { r: 8, c: 7, v: 7 }, { r: 8, c: 8, v: 9 },
  ];
  let res: any[] = [];
  puzzle.forEach((p) => {
    // 🚨 修正：初始化题目时，必须打上 isGiven 标签，否则嫌疑人会选错
    res.push({ path: `cell_${p.r * 9 + p.c}`, key: "value", value: p.v });
    res.push({ path: `cell_${p.r * 9 + p.c}`, key: "isGiven", value: true });
  });
  engine.data.SetValues(res);
};

const setupSudokuEntangle = () => {
  CellArray.forEach((cell) => {
    const myNeighbors = CellArray.filter(
      (c) => c.path !== cell.path && (c.row === cell.row || c.col === cell.col || c.box === cell.box)
    );

    myNeighbors.forEach((neighbor) => {
      engine.config.useEntangle({
        observer: neighbor.path,
        target: cell.path,
        triggerKeys: ["value"],
        emit: async (obs, tgt) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          return {
            key: "forbidden",
            patch: (oldForbidden: Record<number, number>) => {
              const next = { ...oldForbidden };
              const prevValue = tgt.neighbors[obs.path];
              if (prevValue !== null && prevValue !== undefined) {
                next[prevValue] = Math.max(0, (next[prevValue] || 0) - 1);
                if (next[prevValue] === 0) delete next[prevValue];
              }
              if (obs.value !== null) {
                next[obs.value] = (next[obs.value] || 0) + 1;
              }
              return next;
            }
          };
        }
      });
    });

    myNeighbors.forEach((neighbor) => {
      engine.config.useEntangle({
        observer: neighbor.path,
        target: cell.path,
        triggerKeys: ["value"],
        emit: async (obs, tgt) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          return {
            key: "neighbors",
            patch: (oldNeighbors: Record<string, number | null>) => ({
              ...oldNeighbors,
              [obs.path]: obs.value
            })
          };
        }
      });
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: cell.path,
      triggerKeys: ["forbidden", "banned"],
      filter: (obs, tgt) => tgt.value === null,
      emit: (obs, tgt) => {
        if (!obs.forbidden) return;
        const banned = obs.banned || [];
        const validCands = [1,2,3,4,5,6,7,8,9].filter(v =>
          (!obs.forbidden[v] || obs.forbidden[v] === 0) &&
          !banned.includes(v) 
        );
        if (tgt.candidates.join() !== validCands.join()) {
          return { key: "candidates", value: validCands };
        }
      }
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: cell.path,
      triggerKeys: ["forbidden"],
      filter: (obs, tgt) => {
        if (tgt.value === null) return false;
        if (tgt.isGiven) return false; 
        if (!obs.forbidden) return false;
        return (obs.forbidden[tgt.value] || 0) > 0;
      },
      emit: async (obs, tgt) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        const competitor = Object.entries(tgt.neighbors)
          .filter(([path, val]) => val === tgt.value)
          .map(([path]) => path)
          .sort((a, b) => {
            const uidA = parseInt(a.split('_')[1]) || 0;
            const uidB = parseInt(b.split('_')[1]) || 0;
            return uidA - uidB;
          })[0];

        if (!competitor) return;

        const myIdx = parseInt((tgt.path as string).split('_')[1]) || 0;
        const competitorIdx = parseInt(competitor.split('_')[1]) || 0;

        if (myIdx > competitorIdx) {
          console.log(`⚖️ UID让位撤回: ${tgt.path}(${myIdx}) 让给 ${competitor}(${competitorIdx})`);
          return { key: "value", value: null };
        }
      }
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: cell.path,
      triggerKeys: ["candidates"],
      filter: (obs, tgt) => {
        if (tgt.value !== null) return false;
        if (obs.candidates.length !== 1) return false;
        return !(tgt.banned || []).includes(obs.candidates[0]);
      },
      emit: async (obs, tgt) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        return { key: "value", value: obs.candidates[0] };
      },
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: judgementNode.path,
      triggerKeys: ["candidates"],
      filter: (obs, tgt) => obs.value === null && obs.candidates.length === 0,
      emit: (obs, tgt) => {
        console.log(`💀 ${obs.path} 死局，向法官求援`);
        return {
          key: "rescue",
          patch: (old: any) => ({
            ...old,
            target: old.target,
            deadCells: [...(old.deadCells || []), obs.path]
          })
        };
      }
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: judgementNode.path,
      triggerKeys: ["forbidden", "value"],
      emit: (obs, tgt) => {
        return {
          key: "cellMap",
          op: "merge",
          delta: {
            [obs.path]: {
              path: obs.path,
              row: obs.row,
              col: obs.col,
              box: obs.box,
              value: obs.value,
              forbidden: { ...obs.forbidden },
              banned: [...(obs.banned || [])],
              isGiven: obs.isGiven || false,
              timestamp: obs.value !== null ? Date.now() : null
            }
          }
        };
      }
    });

    engine.config.useEntangle({
      observer: judgementNode.path,
      target: judgementNode.path,
      triggerKeys: ["cellMap"],
      emit: (obs) => {
        const dist: Record<string, any[]> = {};
        const uniqueDist: Record<string, string> = {};
        const pointingPairs: any[] = [];

        Object.values(obs.cellMap).forEach((c: any) => {
          if (c.value !== null) return;
          const forbidden = c.forbidden || {};
          const banned = c.banned || [];
          const candidates = [1,2,3,4,5,6,7,8,9].filter(
            num => (!forbidden[num] || forbidden[num] === 0) && !banned.includes(num)
          );
          candidates.forEach((num: number) => {
            [`row_${c.row}_num_${num}`, `col_${c.col}_num_${num}`, `box_${c.box}_num_${num}`].forEach(k => {
              if (!dist[k]) dist[k] = [];
              dist[k].push(c);
            });
          });
        });

        Object.entries(dist).forEach(([k, cells]) => {
          if (cells.length === 1) uniqueDist[k] = cells[0].path;
        });

        for (let b = 0; b < 9; b++) {
          for (let num = 1; num <= 9; num++) {
            const cells = dist[`box_${b}_num_${num}`];
            if (cells && cells.length > 1 && cells.length <= 3) {
              const rows = new Set(cells.map((c: any) => c.row));
              if (rows.size === 1) pointingPairs.push({ type: "row", index: Array.from(rows)[0], num, excludeBox: b });
              const cols = new Set(cells.map((c: any) => c.col));
              if (cols.size === 1) pointingPairs.push({ type: "col", index: Array.from(cols)[0], num, excludeBox: b });
            }
          }
        }

        return {
          key: "globalDistribution",
          value: { unique: uniqueDist, pointing: pointingPairs, cellMap: obs.cellMap }
        };
      }
    });

    engine.config.useEntangle({
      observer: judgementNode.path,
      target: judgementNode.path,
      triggerKeys: ["rescue"],
      filter: (obs) => {
        return obs.rescue &&
          obs.rescue.deadCells &&
          obs.rescue.deadCells.length > 0 &&
          obs.rescue.target === null;
      },
      emit: (obs) => {
        const deadPath = obs.rescue.deadCells[obs.rescue.deadCells.length - 1];
        const deadCell = obs.cellMap[deadPath];
        if (!deadCell) return;

        const culprits = Object.values(obs.cellMap)
          .filter((c: any) => {
            if (c.value === null) return false;
            if (c.isGiven) return false;
            return true;
          })
          .sort((a: any, b: any) => {
            return (b.timestamp || 0) - (a.timestamp || 0);
          });

        if (culprits.length === 0) {
          console.error(`❌ 所有格子都试过了，真的无解`);
          return {
            key: "rescue",
            value: { target: null, deadCells: [] }
          };
        }

        const target = culprits[0] as any;
        console.log(`🔄 法官撤回 ${target.path}(值${target.value}) 破解死局 ${deadPath}`);

        return {
          key: "rescue",
          patch: (old: any) => ({
            ...old,
            target: target.path
          })
        };
      }
    });

    engine.config.useEntangle({
      observer: judgementNode.path,
      target: cell.path,
      triggerKeys: ["rescue"],
      filter: (obs, tgt) => {
        return obs.rescue?.target === tgt.path && tgt.value !== null;
      },
      emit: (obs, tgt) => {
        console.log(`📝 ${tgt.path} 记录banned值 ${tgt.value}`);
        return {
          key: "banned",
          value: [...(tgt.banned || []), tgt.value]
        };
      }
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: cell.path,
      triggerKeys: ["banned"],
      filter: (obs, tgt) => {
        return tgt.value !== null && (obs.banned || []).includes(tgt.value);
      },
      emit: async (obs, tgt) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        console.log(`🔄 ${tgt.path} banned触发撤回值 ${tgt.value}`);
        return { key: "value", value: null };
      }
    });

    engine.config.useEntangle({
      observer: cell.path,
      target: judgementNode.path,
      triggerKeys: ["value"],
      filter: (obs, tgt) => {
        return obs.value === null &&
          tgt.rescue &&
          tgt.rescue.target === obs.path;
      },
      emit: (obs, tgt) => {
        console.log(`✅ ${obs.path} 撤回完成，重置rescue`);
        return {
          key: "rescue",
          value: { target: null, deadCells: [] }
        };
      }
    });

    engine.config.useEntangle({
      observer: judgementNode.path,
      target: cell.path,
      triggerKeys: ["globalDistribution"],
      filter: (obs, tgt) => tgt.value === null,
      emit: (obs, tgt) => {
        const { unique, cellMap } = obs.globalDistribution;
        if (!unique || !cellMap) return;

        for (let num = 1; num <= 9; num++) {
          if (
            unique[`row_${tgt.row}_num_${num}`] === tgt.path ||
            unique[`col_${tgt.col}_num_${num}`] === tgt.path ||
            unique[`box_${tgt.box}_num_${num}`] === tgt.path
          ) {
            if (!tgt.candidates.includes(num)) continue;

            if ((tgt.banned || []).includes(num)) {
              console.warn(`🚫 [禁止裁决] ${tgt.path} 填 ${num} 在banned列表`);
              continue;
            }

            if (tgt.forbidden && (tgt.forbidden[num] || 0) > 0) {
              console.warn(`⚠️ [拦截误判] ${tgt.path} 填 ${num} forbidden里已有`);
              continue;
            }

            const isPhysicallyValid = Object.values(cellMap).every((otherCell: any) => {
              if (otherCell.path === tgt.path) return true;
              const isNeighbor = (
                otherCell.row === tgt.row ||
                otherCell.col === tgt.col ||
                otherCell.box === tgt.box
              );
              if (isNeighbor && otherCell.value === num) return false;
              return true;
            });

            if (isPhysicallyValid) {
              return { key: "value", value: num };
            } else {
              console.warn(`⚠️ [拦截误判] ${tgt.path} 填 ${num} 被否决`);
            }
          }
        }
      },
    });

    engine.config.useEntangle({
      observer: judgementNode.path,
      target: cell.path,
      triggerKeys: ["globalDistribution"],
      filter: (obs, tgt) => tgt.value === null,
      emit: (obs, tgt) => {
        const { pointing } = obs.globalDistribution;
        if (!pointing) return;

        let newCands = [...tgt.candidates];
        let changed = false;

        pointing.forEach((rule: any) => {
          if (
            ((rule.type === "row" && tgt.row === rule.index) ||
              (rule.type === "col" && tgt.col === rule.index)) &&
            tgt.box !== rule.excludeBox &&
            newCands.includes(rule.num)
          ) {
            newCands = newCands.filter((c) => c !== rule.num);
            changed = true;
          }
        });

        if (changed) {
          return { key: "candidates", value: newCands };
        }
      },
    });
  });
};

const reset = () => {
  isDeadlocked.value = false;
  deadEndCells.value = [];
  suspectCells.value = [];
  gameStatus.value = 'playing';

  selectedCell.value = null; 
  let res: any[] = [];
  CellArray.forEach((c) => {
    res.push({ path: c.path, key: "value", value: null });
    res.push({ path: c.path, key: "candidates", value: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    res.push({ path: c.path, key: "forbidden", value: {} });
    res.push({ path: c.path, key: "neighbors", value: {} });
    res.push({ path: c.path, key: "banned", value: [] });
    res.push({ path: c.path, key: "isGiven", value: false });
  });
  res.push({ 
  path: judgementNode.path, 
  key: "rescue", 
  value: { target: null, deadCells: [],  } 
});
  engine.data.SetValues(res);
};

const replay = ()=>{
  isDeadlocked.value = false;
  deadEndCells.value = [];
  suspectCells.value = [];
  gameStatus.value = 'playing';

  let res: any[] = [];
  CellArray.forEach((c) => {
    // 🚨 修正：只把“非题目”的格子变 null，保留初始题目
    if (!c.isGiven) {
      res.push({ path: c.path, key: "value", value: null });
      res.push({ path: c.path, key: "banned", value: [] });
      res.push({ path: c.path, key: "candidates", value: [1,2,3,4,5,6,7,8,9] });
    }
  });
  res.push({ path: judgementNode.path, key: "rescue", value: { target: null, deadCells: [] } });
  engine.data.SetValues(res);
}

setupSudokuEntangle();
engine.config.notifyAll();

engine.hooks.onSuccess(async () => {
  const emptyCells = CellArray.filter((c) => c.value === null);
  
  // 1. 🌟 全盘完成时
  if (emptyCells.length === 0) {
    console.log("🎉 全盘坍缩完成！");
    gameStatus.value = 'solved';
    
    // 👉 案子破了，清理警戒线和嫌疑人！
    isDeadlocked.value = false;
    deadEndCells.value = [];
    suspectCells.value = [];
    return;
  }

  // rescue还在处理中，等它
  if (judgementNode.rescue?.target !== null || judgementNode.rescue?.deadCells?.length > 0) {
    return;
  }

  emptyCells.sort((a, b) => a.candidates.length - b.candidates.length);
  const targetCell = emptyCells[0];

  // 2. 🌟 触发案发现场取证
  if (!targetCell || targetCell.candidates.length === 0) {
    console.warn("💥 推演失败，当前路径无解，启动案发现场取证！");
    
    isDeadlocked.value = true;
    gameStatus.value = 'failed';

    const deadCells = emptyCells.filter(c => c.candidates.length === 0);
    deadEndCells.value = deadCells.map(c => c.path);

    const suspects = new Set<string>();
    deadCells.forEach(dead => {
      CellArray.forEach(c => {
        if (c.value !== null && !c.isGiven) {
          const isNeighbor = c.row === dead.row || c.col === dead.col || c.box === dead.box;
          if (isNeighbor) suspects.add(c.path);
        }
      });
    });
    
    suspectCells.value = Array.from(suspects).sort((a, b) => {
      const cellA = CellArray.find(c => c.path === a);
      const cellB = CellArray.find(c => c.path === b);
      return (cellB?.timestamp || 0) - (cellA?.timestamp || 0);
    });

    return;
  }

 

  const randomIndex = Math.floor(Math.random() * targetCell.candidates.length);
  const guessValue = targetCell.candidates[randomIndex];
  engine.data.SetValue(targetCell.path, "value", guessValue);
});

onMounted(() => {
  startSolving();
});

onUnmounted(() => {
  deleteEngine("sudoku_engine");
});
</script>

<style scoped>
.dashboard-wrapper { background: #0d1117; border: 1px solid var(--vp-c-divider, rgba(255, 255, 255, 0.1)); border-radius: 12px; overflow: hidden; margin: 24px 0; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); font-family: sans-serif; }
.control-panel { padding: 16px 24px; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between; }
.controls { display: flex; gap: 12px; }
.reset-btn { background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); padding: 6px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 6px; }
.reset-btn:hover { background: rgba(255, 255, 255, 0.2); }
.mode-selector { display: flex; align-items: center; gap: 15px; }
.selector-label { color: #888; font-size: 13px; }
.radio-group { display: flex; gap: 10px; background: rgba(0, 0, 0, 0.3); padding: 4px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1); }
.radio-item { cursor: pointer; padding: 6px 16px; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: all 0.3s; }
.radio-item input { display: none; }
.radio-dot { width: 8px; height: 8px; border-radius: 50%; background: #444; transition: all 0.3s;}
.radio-item .text { font-size: 12px; transition: all 0.3s;}
.radio-item.active { background: rgba(24, 144, 255, 0.15); }
.radio-item.active:first-child .radio-dot { background: #1890ff; box-shadow: 0 0 8px #1890ff; }
.radio-item.active:first-child .text { color: #fff; font-weight: bold; }
/* 🚨 高度修改：740px */
.playground { width: 100%; height: 740px; overflow: hidden; position: relative; }
.sudoku-board { position: relative; width: 520px; height: 520px; background: #1a1e24; border: 2px solid #40a9ff; border-radius: 8px; box-shadow: 0 0 20px rgba(24, 144, 255, 0.15); }
.cell { background: linear-gradient(135deg, #2b323b 0%, #1a1e24 100%); border: 1px solid rgba(255, 255, 255, 0.05); z-index: 20; display: flex; align-items: center; justify-content: center; color: white; border-radius: 4px; box-sizing: border-box; cursor: pointer; }
.cell:hover { box-shadow: inset 0 0 10px rgba(24, 144, 255, 0.3); }
.cell.is-selected { box-shadow: inset 0 0 15px rgba(255, 170, 0, 0.6); border-color: #ffaa00; z-index: 30;}
.cell.border-r { border-right: 2px solid #40a9ff; }
.cell.border-b { border-bottom: 2px solid #40a9ff; }
.cell.has-value { background: rgba(24, 144, 255, 0.1); border-color: rgba(24, 144, 255, 0.3); }
.final-value { font-size: 28px; font-weight: 800; color: #00e5ff; text-shadow: 0 0 10px rgba(0, 229, 255, 0.5); }
.candidates-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); width: 100%; height: 100%; padding: 4px; box-sizing: border-box; }
.c-num { font-size: 11px; line-height: 1; color: #ffaa00; font-family: monospace; display: flex; align-items: center; justify-content: center; transition: opacity 0.2s; }
.c-num.hidden { opacity: 0; }
.editor-popover { position: absolute; z-index: 100; background: #1a1e24; border: 1px solid #40a9ff; border-radius: 8px; padding: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 12px rgba(24, 144, 255, 0.3); width: 140px; transform: translateY(-50%); }
.popover-title { color: #888; font-size: 12px; margin-bottom: 8px; text-align: center; }
.popover-input-group { display: flex; gap: 6px; }
.popover-input-group input { flex: 1; width: 0; background: rgba(0,0,0,0.4); border: 1px solid #444; border-radius: 4px; color: #00e5ff; text-align: center; font-size: 16px; font-weight: bold; outline: none; padding: 4px 0; }
.popover-input-group input:focus { border-color: #00e5ff; }
.popover-input-group input::-webkit-outer-spin-button, .popover-input-group input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.btn-confirm { background: rgba(24, 144, 255, 0.2); color: #40a9ff; border: 1px solid #40a9ff; border-radius: 4px; padding: 0 10px; cursor: pointer; transition: 0.2s;}
.btn-confirm:hover { background: #40a9ff; color: #fff;}
.popover-hint { font-size: 10px; color: #555; text-align: center; margin-top: 6px; }

/* 🚨 增加 !important 防止被 has-value 覆盖 */
.cell.is-dead-end {
  background: rgba(255, 77, 79, 0.2) !important;
  border-color: #ff4d4f !important;
  box-shadow: inset 0 0 20px rgba(255, 77, 79, 0.5), 0 0 10px rgba(255, 77, 79, 0.8) !important;
  animation: pulse-dead 1.5s infinite;
  z-index: 40 !important;
}

/* 🚨 增加 !important 和 background 颜色，使橙色警示更鲜明 */
.cell.is-suspect {
  background: rgba(250, 173, 20, 0.15) !important;
  border-color: #faad14 !important;
  box-shadow: inset 0 0 15px rgba(250, 173, 20, 0.5), 0 0 8px rgba(250, 173, 20, 0.3) !important;
  z-index: 35 !important;
}

.cell.is-suspect .final-value {
  color: #faad14 !important;
  text-shadow: 0 0 10px rgba(250, 173, 20, 0.8) !important;
}

.banned-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  color: #ff4d4f;
  background: rgba(0,0,0,0.6);
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid rgba(255, 77, 79, 0.4);
}

@keyframes pulse-dead {
  0% { box-shadow: inset 0 0 20px rgba(255, 77, 79, 0.5), 0 0 5px rgba(255, 77, 79, 0.5); }
  50% { box-shadow: inset 0 0 30px rgba(255, 77, 79, 0.8), 0 0 15px rgba(255, 77, 79, 0.8); }
  100% { box-shadow: inset 0 0 20px rgba(255, 77, 79, 0.5), 0 0 5px rgba(255, 77, 79, 0.5); }
}

.replay-btn {
  background: rgba(187, 134, 252, 0.1); 
  color: #bb86fc; 
  border: 1px solid rgba(187, 134, 252, 0.3);
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  overflow: hidden;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.replay-btn:hover {
  background: rgba(187, 134, 252, 0.2);
  border-color: #bb86fc;
  color: #fff;
  box-shadow: 0 0 15px rgba(187, 134, 252, 0.4);
  transform: translateY(-1px);
}

.replay-btn:active {
  transform: translateY(1px) scale(0.96);
  box-shadow: 0 0 5px rgba(187, 134, 252, 0.2);
}

.replay-btn .icon {
  font-size: 14px;
  filter: drop-shadow(0 0 2px #bb86fc);
}

.replay-btn::after {
  content: "";
  position: absolute;
  top: -50%;
  left: -60%;
  width: 20%;
  height: 200%;
  background: linear-gradient(
    to right,
    transparent,
    rgba(187, 134, 252, 0.4),
    transparent
  );
  transform: rotate(30deg);
  transition: 0.5s;
}

.replay-btn:hover::after {
  left: 120%;
  transition: 0.5s;
}

.status-toast-container {
  position: absolute;
  top: 15px;
  left: 50%;
  transform: translateX(-50%) translateY(-20px);
  opacity: 0;
  pointer-events: none;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 1000;
}

.status-toast-container.visible {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}

.status-toast {
  padding: 12px 28px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: bold;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.status-toast.solved {
  background: rgba(82, 196, 26, 0.15);
  border: 1px solid #52c41a;
  color: #52c41a;
  box-shadow: 0 0 20px rgba(82, 196, 26, 0.3), inset 0 0 10px rgba(82, 196, 26, 0.2);
}

.status-toast.failed {
  background: rgba(255, 77, 79, 0.15);
  border: 1px solid #ff4d4f;
  color: #ff4d4f;
  box-shadow: 0 0 20px rgba(255, 77, 79, 0.3), inset 0 0 10px rgba(255, 77, 79, 0.2);
}

.toast-icon {
  font-size: 22px;
}

.toast-msg {
  letter-spacing: 1px;
}

.pulse-animation {
  animation: bounce-joy 1.2s infinite cubic-bezier(0.28, 0.84, 0.42, 1);
  display: inline-block;
}

@keyframes bounce-joy {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-6px) scale(1.1); }
}

.shake-animation {
  animation: shake-alert 0.5s infinite;
  display: inline-block;
}

@keyframes shake-alert {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px) rotate(-5deg); }
  75% { transform: translateX(3px) rotate(5deg); }
}
</style>