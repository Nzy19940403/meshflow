import { it, expect, vi, describe, beforeEach } from 'vitest';
import { useMeshFlow, useEngine } from "../utils/core/engine/useEngineManager";
 
import { ref } from 'vue';

const createMockTrigger = () => ({
    signalCreateor: () => ref(0),
    signalTrigger: (s: any) => { s.value++ }
});

const generateHugeMesh = (maxCount = 100) => {
    const regions = ['a', 'b', 'c']; // 简化为3个区做测试
    const children = [];
  
    // 全局开关
    children.push({ type: "select", name: "global_mode", defaultValue: "auto" });
  
    // 区域节点生成
    regions.forEach((region) => {
      for (let i = 1; i <= maxCount; i++) {
        children.push({
          type: "number",
          name: `${region}${i}_val`,
          defaultValue: 100
        });
      }
    });
  
    // 总指数
    children.push({ type: "number", name: "total_index", defaultValue: 0 });
  
    return children; // 返回打平的数组方便测试遍历
  };

describe('🏭 工业级海量节点压力测试 (Huge Mesh)',()=>{
  
    let engine:any = null;
    const NODE_COUNT = 100;
    const schemaList = generateHugeMesh(NODE_COUNT);
    const form = { type: 'group', name: '', children:schemaList }
    beforeEach(async ()=>{
        
   
        engine = useMeshFlow('stress-test', form, createMockTrigger());
        console.time('Schema Init');
        for (let i = 1; i <= NODE_COUNT; i++) {
            const aNode = `a${i}_val`;
            const bNode = `b${i}_val`;
            const cNode = `c${i}_val`;
      
            // 规则 1: B 依赖 A 和 Global Mode
            // 逻辑: 如果是 manual，B 不动；否则 B = A + 1
            engine.config.SetRules([aNode, 'global_mode'], bNode, 'defaultValue', {
                logic: (api: any) => {
                  const [aVal,global_mode] = api.slot.triggerTargets;
               
                  return aVal + 1;
                }
              });
        
              // 规则 2: C 依赖 B (深度传导)
              // 逻辑: C = B * 2
              engine.config.SetRule(bNode, cNode, 'defaultValue', {
                logic: (api: any) => {
                  const [val] = api.slot.triggerTargets
                   // 注意：这里 api.triggerTargets[bNode] 能拿到 B 的最新值
                   return val * 2;
                }
              });

          // 规则 3: Total 依赖所有 C
            const allCNodes = Array.from({ length: NODE_COUNT }, (_, i) => `c${i + 1}_val`);

            engine.config.SetRules(allCNodes, 'total_index', 'defaultValue', {
            logic: (api: any) => {
                // 1. 获取输入数组
                // 根据你的新写法，api.slot.triggerTargets 是一个数组 [c1值, c2值, ... c100值]
                const allCValues = api.slot.triggerTargets;

                // 2. 数组求和
                // 建议转一下 Number 防止字符串拼接，并处理可能的 undefined
                return allCValues.reduce((sum: number, val: any) => sum + (Number(val) || 0), 0);
            }
            });

            // engine.data.SetValue('global_mode', 'auto'); 
        
      
          }
    });

    it('🔥 全链路压力测试：修改 A1 应触发 B1->C1->Total', async () => {
        const initialForm = engine.data.GetFormData();
        if(initialForm['total_index'] !== 20200) {
            console.error('⚠️ 预热失败，当前 Total:', initialForm['total_index']);
        }

        console.time('Calculation Time');

        // 修改 A1
        engine.data.SetValue('a1_val', 200);
        engine.config.notifyAll(); 
        // 等待计算
        await new Promise(resolve => setTimeout(resolve, 20));

        console.timeEnd('Calculation Time');

        const formData = engine.data.GetFormData();
        console.log(formData)
        // 验证
        expect(formData['b1_val']).toBe(201);
        expect(formData['c1_val']).toBe(402);
        
        // 现在这里应该通过了
        expect(formData['total_index']).toBe(20400);
    });
})