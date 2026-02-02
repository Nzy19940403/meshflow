<template>
  <div class="flex w-full h-full">
    <router-view v-slot="{ Component }">
      <KeepAlive :include="['EditorForm']">
        <component :is="Component" />
      </KeepAlive>
    </router-view>
  </div>
</template>
<script setup lang="ts">
import { provide } from "vue";
// import { Schema } from "@/devSchemaConfig/dev.form.Schema";
// import { Schema } from "@/devSchemaConfig/test.form.Schema";
import { useEngineManager, useEngine } from "@/utils/core/engine/useEngineManager";
import { ref, Ref } from "vue";
import { setupBusinessRules } from "@/src/formRules/FormRules";
import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";

const maxCount = 2
const generateHugeMesh = () => {
  const regions = ['a', 'b', 'c',  ]; // 5 个区域
  const nodesPerRegion = maxCount; // 每个区域 100 个节点
  const children = [];

  // 1. 全局开关
  children.push({
    type: "select",
    name: "global_mode",
    label: "⚡ 全厂运行模式",
    defaultValue: "auto",
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
        defaultValue: 100
      });
    }
  });

  // 3. 终极统计
  children.push({
    type: "number",
    name: "total_index",
    label: "📊 全球实时效能总指数",
    defaultValue: 0,
    readonly: true
  });

  return { type: 'group', name: 'mesh', children };
};

const TransformSchema = (data:any)=>{
   
  let children = data.children[3].children;
 
  for(let i = 0;i<500;i++){
    let obj =  {
      type: 'checkbox', // UI 对应 Vuetify 的 v-checkbox 或 v-switch
      name: 'autoRenew'+i,
      label: '开启自动续费'+i,
      defaultValue: false, // 默认不开启
      disabled: i==0?false:true, 
      description: '暂不支持自动续费'
    }
    children.push(obj)
  }
  return data
}

const generateHugeMesh2 = (maxCount = 100) => {
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
  
    return { type: 'group', name: '', children };  
  };

let newdata = generateHugeMesh();
// let newdata2 = generateHugeMesh2(100)
// let newdata = TransformSchema(Schema);
// console.log(newdata)
const engine = useEngineManager<Ref<number,number>,AllPath>('main-engine',newdata, {
  signalCreateor: () => ref(0),
  signalTrigger(signal) {
    signal.value++;
  },
});
// const engine = useEngine('main-engine');

console.log(engine.data.schema)

const setupfactoryformrule = ()=>{
  for (let i = 1; i < maxCount; i++) {
  let triggerPath = `mesh.a${i}_val` as any;
  let targetPath =  `mesh.a${i+1}_val` as any;
  engine.config.SetRule(triggerPath, targetPath, 'defaultValue', {
    logic: ({slot}) => {
      let [val] = slot.triggerTargets;
      return val+1
    } 
  });
};

for (let i = 2; i <= maxCount; i++) {
  const parents=  [`mesh.b${i-1}_val`, `mesh.a${i}_val`] as any;
  let targetPath =  `mesh.b${i}_val` as any;
  engine.config.SetRules(parents, targetPath, 'defaultValue', {
    logic: ({slot}) => {
      const [trigger1, trigger2] = slot.triggerTargets

      if(targetPath==='mesh.b2_val'){
        return new Promise((resolve,reject)=>{
          setTimeout(() => {
            reject(Number(trigger1) + (Number(trigger2) || 0) );
            console.log('等待5s再返回逻辑：'+[trigger1,trigger2])
          }, 2000);
        })
      }else{
        // trigger1 是上一个 b 的值，trigger2 是对应 a 的值
        return Number(trigger1) + (Number(trigger2) || 0);
      }
        
   
      
    }
  });
}

 

for (let i = 1; i <= maxCount; i++) {
  const target:any = `mesh.c${i}_val`;
  const parents:any = [
    `mesh.b${i}_val`,          // 近亲：同序号的 B
    `mesh.a${maxCount+1 - i}_val`     // 远亲：镜像位置的 A
  ];

  engine.config.SetRules(parents, target, 'defaultValue', {
    logic:({slot}) => {
     
      const [bVal, aMirrorVal] = slot.triggerTargets;
      if(target===`mesh.c${maxCount}_val`){
        console.log([bVal, aMirrorVal])
      }
       
      // 这里的入参就是你声明的两个触发源的值
      const res = (Number(bVal) || 0) + (Number(aMirrorVal) || 0);
      // console.log(`[C区计算] ${target} 汇聚了 B 区当前值和 A 区镜像值:`, res);
      return res;
    }
  });
}
engine.config.notifyAll();
}
setupfactoryformrule();



const setrules = ()=>{
  for (let i = 1; i <= 100; i++) {
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

              // // 规则: Total 依赖所有 C
              const allCNodes = Array.from({ length: 100 }, (_, i) => `c${i + 1}_val`);

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
        
      
          }
         
          engine.config.notifyAll()
}
// setrules()

//设置rule连线
// setupBusinessRules(
//   engine.config.SetRule,
//   engine.config.SetRules,
//   engine.config.SetStrategy,
//   engine.config.notifyAll
// );
 

const setupRules = ()=>{
  for(let i = 1;i<500;i++){
    let prevPath = 'cloudConsole.billing.autoRenew'+(i-1) as any;
    let path = 'cloudConsole.billing.autoRenew'+i as any
    engine.config.SetRule(
      prevPath,
      path,
      'disabled',
      {
        logic:(api)=>{
         
          const [val] = api.slot.triggerTargets;
           
          if(val){
            return false
          }
          return undefined
        }
      }
    )
  }
}
// setupRules()
</script>
