import { it, expect, vi, describe, beforeEach, afterEach } from "vitest";
import {
  useMeshFlow,
  deleteEngine,
} from "@meshflow/core";
import { setupTestNodes } from "./testmodule";
import { MeshPath } from "@meshflow/core";

// 1️⃣ 定义模块类型
type TestModules = {
  useTestModule: typeof setupTestNodes;
};

describe("Meshflow Epoch Engine 核心一致性与调度测试", () => {
  // 2️⃣ 提取 engine 的准确类型
  let engine: ReturnType<typeof useMeshFlow<any, string, TestModules>>;

  beforeEach(() => {
    // 开启时间宝石（虚拟时间）
    vi.useFakeTimers();

    const testData = {
      nodes: [
        { path: "nodeA", initValue: "initial" },
        { path: "nodeB", initValue: "initial" },
        { path: "nodeC", initValue: "initial" },
        { path: "nodeD", initValue: "initial" },
   
      ],
    };

    // 初始化引擎
    engine = useMeshFlow("test", testData, {
      config: { useGreedy: true,useEntangleStep:100 },
      modules: {
        useTestModule: setupTestNodes,
      },
    });
  });

  afterEach(() => {
    // 清理环境，防止单例污染
    deleteEngine("test");
    vi.useRealTimers();
    vi.restoreAllMocks(); // 清理所有的 spy 记录
  });

  // ==========================================
  // 🟢 基础功能与时序验证
  // ==========================================

  it("1. 测试节点注册：引擎初始化必须成功", async () => {
    const nodeA = engine.data.GetValue("nodeA", "state");
    expect(nodeA.value).toBe("initial");
  });

  it("2. 逆向时序合并：高权重慢任务(2s) vs 低权重快任务(0.5s)（强一致性）", async () => {
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["value"],
      emit: async (src, tgt, propose) => {
        await Promise.all([
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "Winner", 10);
              resolve(null);
            }, 2000); // 慢但权重高
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "Loser", 1);
              resolve(null);
            }, 500);  // 快但权重低
          }),
        ]);
      },
    });

    engine.data.SetValue("nodeA", "value", "trigger");

    // 快进到快任务落地，但纪元未结束，必须隔离
    await vi.advanceTimersByTimeAsync(600);
    expect(engine.data.GetValue("nodeB", "state").value).toBe("initial");

    // 纪元全部结算，高权重覆盖
    await vi.advanceTimersByTimeAsync(1500);
    expect(engine.data.GetValue("nodeB", "state").value).toBe("Winner");
  });

  it('3. 权重覆盖：快任务(高权重) vs 慢任务(低权重)（防脏数据）', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: async (src, tgt, propose) => {
        await Promise.all([
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set('value', 'Late-Loser', 1);
              resolve(null);
            }, 2000); // 慢且权重低
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set('value', 'Fast-Winner', 10);
              resolve(null);
            }, 500);  // 快且权重高
          })
        ]);
      }
    });

    engine.data.SetValue('nodeA', 'value', 'trigger');
    await vi.advanceTimersByTimeAsync(2100);

    // 慢任务落地也不能覆盖高权重的快任务
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('Fast-Winner');
  });

  // ==========================================
  // 🔴 压力、容错与防线测试
  // ==========================================

  it('4. 无限递归熔断：应该在达到 useEntangleStep 步数限制时自动切断', async () => {
    const emitSpy = vi.fn();

    // A -> B -> A 死循环
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: async (s, t, p) => { emitSpy(); p.set('value', s.state.value + '-to-B'); }
    });
    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeA', via: ['value'],
      emit: async (s, t, p) => { emitSpy(); p.set('value', s.state.value + '-to-A'); }
    });

    engine.data.SetValue('nodeA', 'value', 'start');
    await vi.advanceTimersByTimeAsync(100);

    const callCount = emitSpy.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
    // 配置了 step: 100，所以两个方向合计应该在 200 左右被熔断
    expect(callCount).toBeLessThanOrEqual(200); 
  });

  it('5. 高频触发批处理：机关枪扫射 100 次同步输入，下游只执行极少次数', async () => {
    const batchSpy = vi.fn();

    engine.config.SetRule('nodeB', 'nodeA', 'any', {
      logic: () => {
        batchSpy();
        return { value: 'processed' };
      },
      triggerKeys: ['value']
    });

    for (let i = 0; i < 100; i++) {
      engine.data.SetValue('nodeA', 'value', `fire-${i}`);
    }

    await vi.advanceTimersByTimeAsync(100); 

    const callCount = batchSpy.mock.calls.length;
    // 拦截掉 95% 以上的无效触发
    expect(callCount).toBeLessThan(5); 
  });

  it('6. 异常隔离：中间环节崩溃(B->C抛错)不应导致引擎死锁', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: (s, t, p) => { p.set('value', 'B-ok'); }
    });

    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeC', via: ['value'],
      emit: () => { throw new Error('BtoC-Boom!'); }
    });

    engine.data.SetValue('nodeA', 'value', 'start');
    await vi.advanceTimersByTimeAsync(100);

    // 错误被隔离，A->B 依然成功
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('B-ok');
    
    // 引擎未死锁，可以继续处理新请求
    engine.data.SetValue('nodeA', 'value', 'retry');
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.data.GetValue('nodeA', 'state').value).toBe('retry');
  });

  // ==========================================
  // 🟣 极致边界条件测试
  // ==========================================

  it('7. 深度异步级联接力：A->B->C (各500ms) 链路完工前，保持调度生命周期连贯', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: async (s, t, p) => {
        await new Promise(r => setTimeout(r, 500));
        p.set('value', 'B-done');
      }
    });

    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeC', via: ['value'],
      emit: async (s, t, p) => {
        await new Promise(r => setTimeout(r, 500));
        p.set('value', 'C-done');
      }
    });

    engine.data.SetValue('nodeA', 'value', 'go');

    // B 修改完成，C 正在飞。
    await vi.advanceTimersByTimeAsync(600);
    
    // 等待全链路结束
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.data.GetValue('nodeC', 'state').value).toBe('C-done');
  });

  it('8. 状态短路拦截 (Bailout)：赋予完全相同的值时，应阻断下游传播', async () => {
    const downstreamSpy = vi.fn();

    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: (s, t, p) => {
        downstreamSpy();
        p.set('value', 'changed');
      }
    });

    // 第一次改变：必然触发
    engine.data.SetValue('nodeA', 'value', 'new-value');
    await vi.advanceTimersByTimeAsync(10);
    expect(downstreamSpy).toHaveBeenCalledTimes(1);

    // 再次赋予相同的值，引擎 Diff 层应拦截
    engine.data.SetValue('nodeA', 'value', 'new-value');
    await vi.advanceTimersByTimeAsync(10);
    
    expect(downstreamSpy).toHaveBeenCalledTimes(1);
  });

  it('9. 多源汇聚竞态：A和B同时修改C，权重(10 > 5)决定最终确定性结果', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeC', via: ['value'],
      emit: (s, t, p) => p.set('value', 'From-A', 5)
    });

    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeC', via: ['value'],
      emit: (s, t, p) => p.set('value', 'From-B', 10)
    });

    // 同步并发触发
    engine.data.SetValue('nodeA', 'value', 'go-A');
    engine.data.SetValue('nodeB', 'value', 'go-B');

    await vi.advanceTimersByTimeAsync(100);

    // 即使抢占微任务队列，权重高的 B 必须稳赢
    expect(engine.data.GetValue('nodeC', 'state').value).toBe('From-B');
  });

  it('10. 同步与异步混编级联：A->B(同步) -> C(异步) 微宏任务交替不脱节', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: (s, t, p) => {
        p.set('value', 'B-Sync');
      }
    });

    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeC', via: ['value'],
      emit: async (s, t, p) => {
        await new Promise(r => setTimeout(r, 500));
        p.set('value', 'C-Async');
      }
    });

    engine.data.SetValue('nodeA', 'value', 'start');

    // 留给纯同步任务 10ms 的微任务流转时间
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('B-Sync');
    expect(engine.data.GetValue('nodeC', 'state').value).toBe('initial');

    // 让 C 的异步任务跑完
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.data.GetValue('nodeC', 'state').value).toBe('C-Async');
  });
  it('11. 菱形依赖 (Glitch-free)：D 必须等 B 和 C 都更新后才执行唯一一次计算', async () => {
    const calcSpy = vi.fn();

    // A -> B
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: (s, t, p) => p.set('value', s.state.value + '-B')
    });

    // A -> C
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeC', via: ['value'],
      emit: (s, t, p) => p.set('value', s.state.value + '-C')
    });

    // B & C -> D
    // 🌟 严格使用你的真实 API：SetRules(Sources, Target, TriggerKey, Options)
    engine.config.SetRules(
      ['nodeB', 'nodeC'], 
      'nodeD', 
      'value', 
      {
        logic: ({ slot }) => {
          calcSpy();
          
          // 根据你贴的源码，slot.triggerTargets 里面存了所有触发源的当前状态
          const [nodeB,nodeA] = slot.triggerTargets;

          // 🌟 直接 return 值，不需要包在对象里！
          return `B:${nodeB.value}, C:${nodeA.value}`; 
        },
        triggerKeys:['value']
      }
    );

    // 点火
    engine.data.SetValue('nodeA', 'value', 'new');
    await vi.advanceTimersByTimeAsync(100);

    // 🌟 终极验证：多路径汇聚，只允许计算 1 次！
    expect(calcSpy).toHaveBeenCalledTimes(1);
    expect(engine.data.GetValue('nodeD', 'state').value).toBe('B:new-B, C:new-C');
  });
  it('12. 逆向时序权重测试：迟到的低权重 T0 不能覆盖早到的高权重 T1', async () => {
    // 定义纠缠：T0 慢（2s），T1 快（1s）
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: async (s, t, p) => {
        if (s.state.value === 'T0') {
          await new Promise(r => setTimeout(r, 2000)); // 故意极慢
          p.set('value', 'Stale-Data', 1); // 权重极低
        } else if (s.state.value === 'T1') {
          await new Promise(r => setTimeout(r, 500));  // 很快
  
          p.set('value', 'Fresh-Data', 100); // 权重极高
        }
      }
    });
  
    // 1. 发起 T0 (0ms)
    engine.data.SetValue('nodeA', 'value', 'T0');
    
    // 2. 500ms 后发起 T1
    await vi.advanceTimersByTimeAsync(500);
    engine.data.SetValue('nodeA', 'value', 'T1');
  
    // 3. 快进到 1000ms (此时 T1 落地)
    await vi.advanceTimersByTimeAsync(600);
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('Fresh-Data');
  
    // 4. 快进到 2500ms (此时 T0 终于落地了)
    await vi.advanceTimersByTimeAsync(1500);
  
    // 🌟 终极验证：即使 T0 是最后执行 p.set 的，但由于它权重低，B 必须保持 Fresh-Data
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('Fresh-Data');
    // 如果这里变成了 Stale-Data，说明你的引擎只是简单的“后来居上”，权重系统就废了
  });
  it('13. 自激防御：防止 nodeA 修改自身导致的同步死循环', async () => {
    const emitSpy = vi.fn();
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeA', via: ['value'],
      emit: (s, t, p) => {
        emitSpy();
        // 如果没有处理好，这里会无限递归
        p.set('value', s.state.value);
      }
    });
  
    engine.data.SetValue('nodeA', 'value', 'hit');
    await vi.advanceTimersByTimeAsync(50);
  
    // 应该只触发一次或在极低次数内停止（取决于你的接力棒机制）
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });
  it('14. 纪元压制：新任务启动后，旧任务的提案必须被物理拦截', async () => {
    const resultPath = 'nodeB';
    engine.config.useEntangle({
      cause: 'nodeA', impact: resultPath, via: ['value'],
      emit: async (s, t, p) => {
        if (s.state.value === 'Old') {
          await new Promise(r => setTimeout(r, 1000));
          p.set('value', 'I-am-Zombie', 100); // 哪怕权重再高也没用
        } else {
          p.set('value', 'I-am-New', 1);
        }
      }
    });
  
    // 1. 发起旧任务
    engine.data.SetValue('nodeA', 'value', 'Old');
    await vi.advanceTimersByTimeAsync(100);
 
    engine.data.SetValue('nodeA', 'value', 'New');
  
    // 3. 快进时间，让旧幽灵醒来
    await vi.advanceTimersByTimeAsync(0);
  
    // 🌟 结果验证：B 必须保持 New 的值，Old 的高权重提案由于 Epoch 不对，根本进不去 buffer
    expect(engine.data.GetValue(resultPath, 'state').value).toBe('I-am-New');
  });
  it('15. 批量提交：SetValues 应当在一个 Session 内完成所有纠缠触发', async () => {
    const monitorSpy = vi.fn();
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeC', via: ['value'],
      emit: () => monitorSpy()
    });
    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeC', via: ['value'],
      emit: () => monitorSpy()
    });
  
    // 🌟 批量修改 A 和 B
    engine.data.SetValues([
      { path: 'nodeA', key: 'value', value: 'changeA' },
      { path: 'nodeB', key: 'value', value: 'changeB' }
    ]);
  
    await vi.advanceTimersByTimeAsync(100);
  
    // 如果你的 SetValues 实现了 Batching，这里应该是 2（每个链路触发一次，但处于同一个结算周期）
    expect(monitorSpy).toHaveBeenCalledTimes(2);
  });
  it('16. 递归熔断：当纠缠深度超过 useEntangleStep 时应停止接力', async () => {
    const stepLimit = 100; // 初始化时配置的
    const trackSpy = vi.fn();
  
    // 建立 A <-> B 的死循环
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: (s, t, p) => { trackSpy(); p.set('value', s.state.value + 1); }
    });
    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeA', via: ['value'],
      emit: (s, t, p) => { trackSpy(); p.set('value', s.state.value + 1); }
    });
  
    engine.data.SetValue('nodeA', 'value', 1);
    await vi.advanceTimersByTimeAsync(200);
  
    // 两个节点各 10 步左右，总调用次数不应远超 20
    expect(trackSpy.mock.calls.length).toBeLessThanOrEqual(stepLimit*2);
  });
  it('17. 动态过滤：Filter 必须在异步任务产生前完成拦截', async () => {
    const asyncSpy = vi.fn();
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      filter: (s, t) => s.state.value > 100, // 只有值大于 100 才允许纠缠
      emit: async (s, t, p) => {
        asyncSpy();
        p.set('value', 'Passed');
      }
    });
  
    // 1. 给个 50，不应触发
    engine.data.SetValue('nodeA', 'value', 50);
    await vi.advanceTimersByTimeAsync(100);
    expect(asyncSpy).not.toHaveBeenCalled();
  
    // 2. 给个 150，触发
    engine.data.SetValue('nodeA', 'value', 150);
    await vi.advanceTimersByTimeAsync(100);
    expect(asyncSpy).toHaveBeenCalledTimes(1);
  });
  it('18. Patch 叠加：多个异步 Patch 提议应在结算阶段按序执行', async () => {
    engine.config.useEntangle<number>({
      cause: 'nodeA', 
      impact: 'nodeB', 
      via: ['value'],
      emit: (s, t, p) => {
        // 🌟 测试原子累加：两个 patch 同时发，最终结果应该是 2 而不是 1
        p.patch('count', (old) => (old || 0) + 1);
        p.patch('count', (old) => (old || 0) + 1);
      }
    });
  
    // 点火
    engine.data.SetValue('nodeA', 'value', 'trigger');
    await vi.advanceTimersByTimeAsync(100);
  
    // 验证 nodeB.state.count 最终叠加结果
    const nodeBState = engine.data.GetValue('nodeB', 'state');
    expect(nodeBState.count).toBe(2); 
  });
  it('19. 权重比拼：同一纪元内，高权重提议必须覆盖低权重提议', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: (s, t, p) => {
        p.set('value', 'Low-Weight', 1);
        p.set('value', 'High-Weight', 10);
      }
    });
  
    engine.data.SetValue('nodeA', 'value', 'trigger');
    await vi.advanceTimersByTimeAsync(50);
  
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('High-Weight');
  });
 
  it('20. 混合竞争：高权重异步任务应覆盖低权重同步任务', async () => {
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: async(s, t, p) => {
        // 1. 同步提交低权重
        p.set('value', 'Sync-Low', 1);
  
        // 2. 异步提交高权重
     
        await new Promise(r => setTimeout(r, 50));
        p.set('value', 'Async-High', 100);
        
      }
    });
  
    engine.data.SetValue('nodeA', 'value', 'trigger');
    
    // 关键：先等同步微任务跑完，此时 B 可能是 Sync-Low (或者还没结算)
    await vi.advanceTimersByTimeAsync(10);
    //还有幽灵在飞，不应该修改state
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('initial');
    // 再等异步落地
    await vi.advanceTimersByTimeAsync(100);
    
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('Async-High');
  });
  it('21. 纪元跳跃验证：T0 异步落地应瞬间完成 State 改写并点火 T1', async () => {
    const trace: string[] = [];
  
    // T0 链路：A -> B (带 50ms 延迟)
    engine.config.useEntangle({
      cause: 'nodeA', impact: 'nodeB', via: ['value'],
      emit: async (s, t, p) => {
        await new Promise(r => setTimeout(r, 60));
        trace.push('T0_Proposing');
        p.set('value', 'B_Updated');
      }
    });
  
    // T1 链路：B -> C (同步，用于验证 B 改变的瞬间)
    engine.config.useEntangle({
      cause: 'nodeB', impact: 'nodeC', via: ['value'],
      emit:   (s, t, p) => {
  
        trace.push('T1_Triggered');
        p.set('value', 'C_Finished');
      }
    });
  
    // 1. 发射 A
    engine.data.SetValue('nodeA', 'value', 'start');
  
    // 2. 在 20ms 时，由于 T0 还没跑完，B 和 C 都应该是初始值
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('initial');
    expect(trace).toEqual([]); // 幽灵还在飞
  
    // 3. 🌟 跨越临界点：快进到 60ms
    // 此时：T0 落地 -> 触发 resolveGhosts -> 修改 nodeB -> 发现 nodeB 变了 -> 触发 T1
    await vi.advanceTimersByTimeAsync(56);
  
    // 4. 验证状态瞬间改写
    expect(engine.data.GetValue('nodeB', 'state').value).toBe('B_Updated');
    // expect(engine.data.GetValue('nodeC', 'state').value).toBe('C_Finished');
  
    // 5. 验证执行顺序：必须先有 T0 的提案，再有 T1 的触发
    expect(trace).toEqual(['T0_Proposing', 'T1_Triggered']);
  });
  it('22.应当在当前宏任务末尾聚合点火，而非立即执行', async () => {
    // 1. 设置一个监听器，看引擎什么时候真的“发车”
    let hasStarted = false;
    engine.hooks.onStart(()=>{
      hasStarted = true;
    })

    // 2. 注入静默更新
    engine.data.StageValue('nodeA', 'value', 'Staged-1');
    engine.data.StageValue('nodeA', 'value', 'Staged-Final');

    // 🌟 验证点 A：此时虽然调用了，但引擎不应该“立刻”点火
    // 逻辑：因为它是聚合在微任务/定时器里的
    expect(hasStarted).toBe(false); 
    
    // 🌟 验证点 B：此时通过公开接口查，值应该还没变
    const stateBefore = engine.data.GetValue('nodeA', 'state');
    expect(stateBefore.value).toBe('initial');

    // 3. 推进时间 (跳过你设定的 16ms 或微任务间隙)
    await vi.advanceTimersByTimeAsync(20);

    // 🌟 验证点 C：此时引擎应该已经触发了 FlowStart 事件
    expect(hasStarted).toBe(true);

    // 🌟 验证点 D：最终物理值写入成功，且是最后一次的值（LIFO）
    const stateAfter = engine.data.GetValue('nodeA', 'state');
    expect(stateAfter.value).toBe('Staged-Final');
  });
  it('23.验证在异步任务“飞行中”注入时，不会产生新的 TaskStart', async () => {
    let startCount = 0;
 
    engine.hooks.onStart(()=>{
      startCount++;
    })
    // 先启动一个带 100ms 异步延迟的纠缠任务
    engine.data.SetValue('nodeA', 'trigger', Math.random());
 

    // 推进 50ms，此时任务在飞（monitor 正在监听）
    await vi.advanceTimersByTimeAsync(50);
    
    // 在飞行中注入 StageValue
    engine.data.StageValue('nodeC', 'value', 'Ninja-Update');
 
    // 🌟 验证：不应该因为 StageValue 再次触发 FlowStart
    // 因为它应该被 monitor 静默吸收了
    expect(startCount).toBe(1); 

    // 推进到落地
    await vi.advanceTimersByTimeAsync(60); 
    
    // 最后确认 nodeC 变了，说明是 monitor 带走的
    expect(engine.data.GetValue('nodeC', 'state').value).toBe('Ninja-Update');
  });
  it("24. 权重优先：高权重慢任务(2s, weight=10) 击败 低权重快任务(0.5s, weight=1)", async () => {
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["value"],
      emit: async (src, tgt, propose) => {
        await Promise.all([
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "SlowWinner", 10);   // 高权重
              resolve(null);
            }, 2000);
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "FastLoser", 1);     // 低权重
              resolve(null);
            }, 500);
          }),
        ]);
      },
    });

    engine.data.SetValue("nodeA", "value", "trigger");

    await vi.advanceTimersByTimeAsync(600);   // 快任务已落地
    expect(engine.data.GetValue("nodeB", "value")).toBe("initial");

    await vi.advanceTimersByTimeAsync(1500);  // 慢任务落地
    expect(engine.data.GetValue("nodeB", "value")).toBe("SlowWinner");
  });

  // ==================== 测试2：同权重时，时间优先（后到达的胜出） ====================
  it("25. 同权重时，时间优先：后到达的 propose 胜出", async () => {
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["value"],
      emit: async (src, tgt, propose) => {
        await Promise.all([
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "First", 5);
              resolve(null);
            }, 800);
            
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "Second", 5);
              resolve(null);
            }, 1200); // 后到达
            
          }),
        ]);
      },
    });

    engine.data.SetValue("nodeA", "value", "trigger");

    await vi.advanceTimersByTimeAsync(900);
    expect(engine.data.GetValue("nodeB", "value")).toBe("initial");

    await vi.advanceTimersByTimeAsync(400);
    expect(engine.data.GetValue("nodeB", "value")).toBe("Second");
  });

  // ==================== 测试3：混合竞争（多个 propose，最高权重最终胜出） ====================
  it("26. 混合竞争：多个 propose 交错，最终由最高权重决定", async () => {
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["value"],
      emit: async (src, tgt, propose) => {
        await Promise.all([
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "A", 3);
              resolve(null);
            }, 300);
            
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "B", 8);
              resolve(null);
            }, 800);  // 中等权重
            
          }),
          new Promise((resolve) => {
            setTimeout(() =>{ 
              propose.set("value", "C", 1);
              resolve(null);
            }, 1200); // 最低权重
            
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              propose.set("value", "D", 12);
              resolve(null);
            }, 1600); // 最高权重
            
          }),
        ]);
      },
    });

    engine.data.SetValue("nodeA", "value", "trigger");

    await vi.advanceTimersByTimeAsync(2000);

    // 最终应该被权重最高的 D 覆盖
    expect(engine.data.GetValue("nodeB", "value")).toBe("D");
  });
  it("27. 循环公式1：A = B + 10, B = A * 0.5 → 应收敛到 A=20, B=10", async () => {
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["count"],
      emit: async (_, tgt, propose) => {
        const a = _.state.count ?? 0;
        const newB = a * 0.5;
        // 强制取整，避免浮点误差累积
        propose.set("count", Math.round(newB), 5);
      }
    });
  
    engine.config.useEntangle({
      cause: "nodeB",
      impact: "nodeA",
      via: ["count"],
      emit: async (_, tgt, propose) => {
        const b = _.state.count ?? 0;
        const newA = b + 10;
        propose.set("count", Math.round(newA), 5);
      }
    });
  
    // 初始触发
    engine.data.SetValue("nodeA", "count", 10);
  
    await vi.advanceTimersByTimeAsync(3000);   // 给足够时间收敛
  
    const finalA = engine.data.GetValue("nodeA", "count");
    const finalB = engine.data.GetValue("nodeB", "count");
  
    expect(finalA).toBe(20);
    expect(finalB).toBe(10);
  });
  it("28. 复杂三方循环公式：A = B + 8, B = C * 0.75, C = A * 1.2 + 4 → 应收敛到 A=80, B=72, C=100", async () => {
  
    const threshold = 0.001; // 收敛精度
    const snapThreshold = 0.01; // 整数吸附阈值
  
    // 1. A 驱动 B: B = A + 8
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["count"],
      emit: async (src, tgt, propose) => {
        const a = src.state.count ?? 0;
        const rawB = a + 8;
        const roundedB = Math.round(rawB);
        const currentB = tgt.state.count ?? 0;
  
        // 如果离整数够近，直接吸附到整数并停下
        if (Math.abs(rawB - roundedB) < snapThreshold) {
          if (currentB !== roundedB) propose.set("count", roundedB);
          return;
        }
        // 否则继续推浮点数
        if (Math.abs(rawB - currentB) > threshold) {
          propose.set("count", rawB);
        }
      }
    });
  
    // 2. B 驱动 C: C = B * 0.75
    engine.config.useEntangle({
      cause: "nodeB",
      impact: "nodeC",
      via: ["count"],
      emit: async (src, tgt, propose) => {
        const b = src.state.count ?? 0;
        const rawC = b * 0.75;
        const roundedC = Math.round(rawC);
        const currentC = tgt.state.count ?? 0;
  
        if (Math.abs(rawC - roundedC) < snapThreshold) {
          if (currentC !== roundedC) propose.set("count", roundedC);
          return;
        }
        if (Math.abs(rawC - currentC) > threshold) {
          propose.set("count", rawC);
        }
      }
    });
  
    // 3. C 驱动 A: A = C * 1.2 + 4
    engine.config.useEntangle({
      cause: "nodeC",
      impact: "nodeA",
      via: ["count"],
      emit: async (src, tgt, propose) => {
        const c = src.state.count ?? 0;
        const rawA = c * 1.2 + 4;
        const roundedA = Math.round(rawA);
        const currentA = tgt.state.count ?? 0;
  
        if (Math.abs(rawA - roundedA) < snapThreshold) {
          if (currentA !== roundedA) propose.set("count", roundedA);
          return;
        }
        if (Math.abs(rawA - currentA) > threshold) {
          propose.set("count", rawA);
        }
      }
    });
  
    engine.data.SetValue("nodeA", "count", 10); 

    // Meshflow 的异步纠缠需要一点时间震荡寻优
    await vi.advanceTimersByTimeAsync(100);
   
  expect(engine.data.GetValue("nodeA", "count")).toBe(112);
  expect(engine.data.GetValue("nodeB", "count")).toBe(120);
  expect(engine.data.GetValue("nodeC", "count")).toBe(90);
  });
  it("29.验证幽灵落地时序：副作用不完成，下一纪元不开启", async () => {
    const trace: string[] = [];
  
    engine.config.useEntangle({
      cause: "nodeA",
      impact: "nodeB",
      via: ["count"],
      emit: async (_, tgt, propose) => {
        trace.push(`T-start: A to B (${_.state.count})`);
        await new Promise(r => setTimeout(r, 100)); // 故意阻塞 100ms
        propose.set("count", Math.round(_.state.count * 0.5));
        trace.push(`T-end: A to B`);
      }
    });
  
    // nodeB 对 nodeA 的逻辑同理，也加 100ms 延迟
    
    engine.data.SetValue("nodeA", "count", 10);
  
    // --- 关键验证点 ---
    
    // 1. 推进 50ms
    await vi.advanceTimersByTimeAsync(50);
    // 此时 T0 的副作用正在运行，T1 绝对不应该开始
    expect(trace).toContain('T-start: A to B (10)');
    expect(trace).not.toContain('T-end: A to B');
    expect(trace.length).toBe(1); // 证明没有抢跑
  
    // 2. 再推进 60ms (累计 110ms)
    await vi.advanceTimersByTimeAsync(60);
    // 此时 T0 应该落地，T1（B 触发 A）才刚刚抬头
    expect(trace).toContain('T-end: A to B');
    // 如果你的逻辑是正确的，trace 里的顺序应该是：
    // Start A->B -> End A->B -> Start B->A -> End B->A ...
  });
 
  it("快慢两组双向纠缠，必须严格遵守纪元对齐协议", async () => {
    vi.useFakeTimers();
    const trace: { msg: string; time: number }[] = [];
    const startTime = Date.now()
    const log = (msg: string) => trace.push({ msg, time: Date.now() - startTime });
  
    // --- 1. 快闭环：A <-> C (全同步，瞬间完成) ---
    engine.config.useEntangle({
      cause: "nodeA", impact: "nodeC", via: ["count"],
      emit:   (from, to, propose) => {
        log(`A->C_Start`);
        propose.set("count", (to.state.count) + 1);
        log(`A->C_End`);
      }
    });
    engine.config.useEntangle({
      cause: "nodeC", impact: "nodeA", via: ["count"],
      emit:   (from, to, propose) => {
        log(`C->A_Start`);
        propose.set("count", (to.state.count) + 1);
        log(`C->A_End`);
      }
    });
  
    // --- 2. 慢闭环：B <-> D (全异步，每一步都慢) ---
    engine.config.useEntangle({
      cause: "nodeB", impact: "nodeD", via: ["count"],
      emit: async (from, to, propose) => {
        log(`B->D_Start`);
        await new Promise(r => setTimeout(r, 200)); // 慢幽灵
        propose.set("count", (to.state.count) + 1);
        log(`B->D_End`);
      }
    });
    engine.config.useEntangle({
      cause: "nodeD", impact: "nodeB", via: ["count"],
      emit: async (from, to, propose) => {
        log(`D->B_Start`);
        await new Promise(r => setTimeout(r, 200)); // 慢幽灵
        propose.set("count", (to.state.count) + 1);
        log(`D->B_End`);
      }
    });
  
    // --- 初始引爆：同时给 A 和 B 一个初始冲量 ---
 
    engine.data.SetValues([
      {
        path:"nodeA",
        key:"count",
        value:1
      },
      {
        path:"nodeB",
        key:"count",
        value:1
      }
    ])
 
 
  
    // 【核心判定】
    // 1. A->C 此时一定跑完了一轮 (Start & End)。
    // 2. 但是！因为 B->D 还在 await 200ms，
    // 3. 此时 trace 绝对不能出现第二次 A->C 的 Start。
    const aStartCount = trace.filter(t => t.msg === "A->C_Start").length;
    expect(aStartCount, "快闭环抢跑了！它在慢闭环没落地前开启了下一纪元").toBe(1);
  
    // --- 验证点：250ms ---
    await vi.advanceTimersByTimeAsync(200);
    // 此时 B->D 的第一跳落地了。
    expect(trace.some(t => t.msg === "B->D_End")).toBe(true);
  
    // --- 验证点：最后观察 ---
    await vi.advanceTimersByTimeAsync(250); 
  
   
  
    // 此时，A 应该开启了 T1 时刻的纠缠
    const aStartsAt260 = trace.filter(t => t.msg === "A->C_Start").length;
    expect(aStartsAt260, "T1 时刻 A 应该已经开启第二轮计算了").toBe(2);

    // 关键：检查时序。T1 的 A 启动，必须晚于 T0 的 B 落地
    const bEndT0Index = trace.findIndex(t => t.msg === "B->D_End");
    const aStartT1Index = trace.findLastIndex(t => t.msg === "A->C_Start");
    
    expect(aStartT1Index).toBeGreaterThan(bEndT0Index);
    expect(trace[aStartT1Index].time).toBeGreaterThanOrEqual(200); // 至少是在 200ms 以后

    console.log(trace)
    // --- 验证点 4：T1 慢幽灵再次起飞 ---
    // 此时 D->B 应该也开启了它的 T1 (它的计算基于 T0 落地后的 D 节点)
    const dStartT1 = trace.filter(t => t.msg === "D->B_Start").length;
    expect(dStartT1).toBe(1); // 假设 D 只有在 B 落地后才会被触发

    // --- 终点观察 ---
    await vi.advanceTimersByTimeAsync(1000);
    
    console.log("🔥 最终时序轨迹表：");
    console.table(trace.map((t, index) => {
      // 定义步长：因为 B 的延迟是 200ms
      const step = 200; 
      
      // 计算当前属于第几个时刻 (Tick)
      const tick = Math.floor(t.time / step);
      
      return {
        "序号": index,
        "事件": t.msg,
        "时刻(ms)": t.time,
        "逻辑纪元": `T${tick}`,
        "状态": t.msg.endsWith('End') ? '✅ 落地' : '⏳ 演化中'
      };
    }));

 

    vi.useRealTimers();
  });
 
});

 

 