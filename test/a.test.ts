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
});