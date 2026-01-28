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
import { Schema } from "@/devSchemaConfig/test.form.Schema";
import { useEngineManager, useEngine } from "@/utils/hooks/useEngineManager";
import { ref, Ref } from "vue";
import { setupBusinessRules } from "@/src/formRules/FormRules";

const maxCount = 3
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

// const TransformSchema = (data:any)=>{
   
//   let children = data.children[3].children;
 
//   for(let i = 0;i<500;i++){
//     let obj =  {
//       type: 'checkbox', // UI 对应 Vuetify 的 v-checkbox 或 v-switch
//       name: 'autoRenew'+i,
//       label: '开启自动续费'+i,
//       defaultValue: false, // 默认不开启
//       disabled: i==0?false:true, 
//       description: '暂不支持自动续费'
//     }
//     children.push(obj)
//   }
//   return data
// }

let newdata = generateHugeMesh()
// let newdata = TransformSchema(Schema);
console.log(newdata)
useEngineManager('main-engine',newdata, {
  signalCreateor: () => ref(0),
  signalTrigger(signal) {
    signal.value++;
  },
});
const engine = useEngine('main-engine');

console.log(engine.data.schema)



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
   
      // trigger1 是上一个 b 的值，trigger2 是对应 a 的值
      return Number(trigger1) + (Number(trigger2) || 0);
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
      if(target==='mesh.c3_val'){
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
