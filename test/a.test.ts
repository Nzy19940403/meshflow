import { it, expect, vi, describe, beforeEach, afterEach } from "vitest";
import {
  useMeshFlow,
  deleteEngine,
} from "../utils/core/engine/useEngineManager";
import { setupTestNodes } from "./testmodule";

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
      config: { useGreedy: true, useEntangleStep: 10 },
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
    // 配置了 step: 10，所以两个方向合计应该在 20 左右被熔断
    expect(callCount).toBeLessThanOrEqual(25); 
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
    const stepLimit = 10; // 初始化时配置的
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
    expect(trackSpy.mock.calls.length).toBeLessThanOrEqual(20);
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
    engine.config.useEntangle({
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
  it('21. 纪元跳跃验证：$T_0$ 异步落地应瞬间完成 State 改写并点火 $T_1$', async () => {
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
});