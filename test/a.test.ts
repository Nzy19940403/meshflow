import { it, expect, vi, describe, beforeEach,afterEach } from 'vitest';
import { useMeshFlow, deleteEngine } from "../utils/core/engine/useEngineManager";
// @ts-nocheck
 
const createMockTrigger = () => ({
  UITrigger:{
    signalCreator: () => 0,
    signalTrigger: (s: any) => { s++ }
  }
});
const generateHugeMesh = (maxCount:any) => {
  const regions = ['a', 'b', 'c',  ]; // 5 个区域
  const nodesPerRegion = maxCount; // 每个区域 100 个节点
  const children = [];

  // 1. 全局开关
  children.push({
    type: "select",
    name: "global_mode",
    label: "⚡ 全厂运行模式",
    value: "auto",
    options: [
    { "label": "手动模式 (停止联动)", "value": "manual" },
    { "label": "自动生产 (全量联动)", "value": "auto" },
    { "label": "紧急制动 (快速熔断)", "value": "emergency" }
  ]
  });


  regions.forEach((region, rIdx) => {
    for (let i = 1; i <= nodesPerRegion; i++) {
      const name = `${region}${i}_val`;
      const labelMap:any = { a: '能源', b: '供给', c: '补偿', d: '储备', e: '输出' };
      
      children.push({
        type: "number",
        name: name,
        label: `[${labelMap[region]}] ${i}号节点`,
        value: 1
      });
    }
  });

  // 3. 终极统计
  children.push({
    type: "number",
    name: "total_index",
    label: "📊 全球实时效能总指数",
    value: 0,
    readonly: true
  });

  return { type: 'group', name: 'mesh', children };
};



describe('🏭 工业级海量节点压力测试 (Huge Mesh)',()=>{
  
  
    const maxCount = 5;
    const form = generateHugeMesh(maxCount);
    let engine:any =null
    // const form = { type: 'group', name: '', children:schemaList };
    
    beforeEach(async ()=>{
        
        engine = useMeshFlow('stress-test', form, createMockTrigger());;
    
        console.time('Schema Init');
        for (let i = 1; i < maxCount; i++) {
          let triggerPath = `mesh.a${i}_val` as any;
          let targetPath =  `mesh.a${i+1}_val` as any;
          engine.config.SetRule(triggerPath, targetPath, 'value', {
            // @ts-ignore
            logic: ({slot}) => {
              let [val] = slot.triggerTargets;
              return val+1
            } 
          });
        };
        
        for (let i = 2; i <= maxCount; i++) {
          const parents=  [`mesh.b${i-1}_val`, `mesh.a${i}_val`] as any;
          let targetPath =  `mesh.b${i}_val` as any;
          engine.config.SetRules(parents, targetPath, 'value', {
            // @ts-ignore
            logic: ({slot}) => {
              const [trigger1, trigger2] = slot.triggerTargets
        
              // if(targetPath==='mesh.b2_val'){
              //   return new Promise((resolve,reject)=>{
              //     setTimeout(() => {
              //       resolve(Number(trigger1) + (Number(trigger2) || 0) );
              //       console.log('等待5s再返回逻辑：'+[trigger1,trigger2])
              //     }, 2000);
              //   })
              // }else{
                // trigger1 是上一个 b 的值，trigger2 是对应 a 的值
                return Number(trigger1) + (Number(trigger2) || 0);
              // }
                
           
              
            }
          });
        }
        
         
        
        for (let i = 1; i <= maxCount; i++) {
          const target:any = `mesh.c${i}_val`;
          const parents:any = [
            `mesh.b${i}_val`,          // 近亲：同序号的 B
            `mesh.a${maxCount+1 - i}_val`     // 远亲：镜像位置的 A
          ];
        
          engine.config.SetRules(parents, target, 'value', {
            // @ts-ignore
            logic:({slot}) => {
             
              const [bVal, aMirrorVal] = slot.triggerTargets;
              console.log(bVal,aMirrorVal)
               
              // 这里的入参就是你声明的两个触发源的值
              const res = (Number(bVal) || 0) + (Number(aMirrorVal) || 0);
              // console.log(`[C区计算] ${target} 汇聚了 B 区当前值和 A 区镜像值:`, res);
              return res;
            }
          });
        }
        await engine.config.notifyAll();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      deleteEngine('stress-test')
    });

  
    /**
     * 🧪 测试组 5: 抢跑/水位线拦截验证
     * 确保 c2 不会因为 a4 变了就提前计算，必须等 b2
     */
    it('Case Intercept: C2 必须等待 B2 (虽然 A4 已经准备好了)', async () => {
     
      
      

      engine.data.SetValue('mesh.a1_val', 0);
  
      // 推导:
      // a1=0 -> a2=1 -> a3=2 -> a4=3
      
      // 立即检查: a4 应该已经好了
      await new Promise(resolve => setTimeout(resolve, 200));
    
      expect(engine.data.GetValue('mesh.a3_val')).toBe(2);
      
      // 此时 b2 还没好 (setTimeout中)
      // 如果你的水位线逻辑生效，c2 此时不应该拿到错误的 b2 值并计算
      // 或者至少在 2s 后，c2 必须更新为正确的值
      
      // await vi.advanceTimersByTimeAsync(2000);
      
      // // b2 = b1(0) + a2(1) = 1
      expect(engine.data.GetValue('mesh.b2_val')).toBe(2);
      
      // // c2 = b2(2) + a4(3) = 5
      expect(engine.data.GetValue('mesh.c2_val')).toBe(5);
  });
  it('竞态拦截：连续快速改变输入，旧任务不应覆盖新任务', async () => {
    vi.useFakeTimers();

    engine.data.SetValue('mesh.a1_val', 0); // 第一次输入
    // 立即进行第二次输入，不等待
    engine.data.SetValue('mesh.a1_val', 10); 

    await vi.runAllTimersAsync();

    // 预期结果必须完全符合第二次输入的推导值
    // 如果没有 Token 机制，第一次计算的残余任务可能会在后面悄悄执行并覆盖正确值
    expect(engine.data.GetValue('mesh.a4_val')).toBe(13); // 10+1+1+1
  });
  it('批量输入：短时间内改变两个不相关的源，下游应最终一致', async () => {
    vi.useFakeTimers();
    engine.data.SetValue('mesh.a1_val', 1);
    // engine.data.SetValue('mesh.b2_val', 2); // 紧接着改变另一个输入

    await vi.runAllTimersAsync();
    
    // 检查最终结果是否是根据最新的 a 和 b 计算出来的
    //a4+b2 = 4+2
    expect(engine.data.GetValue('mesh.a2_val')).toBe(2); 
    expect(engine.data.GetValue('mesh.a4_val')).toBe(4); 
    expect(engine.data.GetValue('mesh.b1_val')).toBe(1); 
    expect(engine.data.GetValue('mesh.b2_val')).toBe(3); 
    expect(engine.data.GetValue('mesh.c2_val')).toBe(7); 
   
    // 检查 c 的执行次数，理想情况下只跑了一次或被拦截了一次
  });
})