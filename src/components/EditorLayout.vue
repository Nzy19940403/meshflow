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

// import { useMeshFlow,deleteEngine } from "@/utils/core/engine/useEngineManager";
import {useLogger} from '@/utils/plugins/logger/useLogger'

// import {useLogger} from '@meshflow/logger'
// import { useMeshFlow ,deleteEngine} from "@meshflow/core";

import { ref, Ref } from "vue";
import { setupBusinessRules } from "@/src/formRules/FormRules";
 
import {usePerfetto} from '@/utils/plugins/prefetto/usePrefetto'
import { onUnmounted,  } from "vue";
// import {useHistory} from '@/utils/plugins/history/useHistory'

import { useHistory } from "@meshflow/history";

 
 
import { clonedschema } from "@/devSchemaConfig/dev.form.Schema.data";

import {useMeshForm,deleteEngine} from '@/utils/forms/useMeshForm'

// import {useMeshForm,deleteEngine } from '@meshflow/form';


// import {useMeshRenderGate} from '@/utils/plugins/meshRenderGate/useMeshRenderGate'
import {useMeshRenderGate} from '@/utils/plugins/meshRenderGate/useMeshRenderGate';

const maxCount = 3
const generateHugeMesh = () => {
  const regions = ['a', 'b', 'c',  ]; // 5 个区域
  const nodesPerRegion = maxCount; // 每个区域 100 个节点
  const children = [];

  // 1. 全局开关
  // children.push({
  //   type: "select",
  //   name: "global_mode",
  //   label: "⚡ 全厂运行模式",
  //   value: "auto",
  //   options: [
  //   { "label": "手动模式 (停止联动)", "value": "manual" },
  //   { "label": "自动生产 (全量联动)", "value": "auto" },
  //   { "label": "紧急制动 (快速熔断)", "value": "emergency" }
  // ]
  // });


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

const TransformSchema = (data:any)=>{
  
  let children = data.children[3].children;
 
  for(let i = 0;i<10;i++){
    let obj =  {
      type: 'checkbox', // UI 对应 Vuetify 的 v-checkbox 或 v-switch
      name: 'autoRenew'+i,
      label: '开启自动续费'+i,
      value: false, // 默认不开启
      // disabled: i==0?false:true, 
      disabled:false,
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
    children.push({ type: "select", name: "global_mode", value: "auto" });
  
    // 区域节点生成
    regions.forEach((region) => {
      for (let i = 1; i <= maxCount; i++) {
        children.push({
          type: "number",
          name: `${region}${i}_val`,
          value: 100
        });
      }
    });
  
    // 总指数
    children.push({ type: "number", name: "total_index", value: 0 });
  
    return { type: 'group', name: '', children };  
  };

let newdata = generateHugeMesh();
// let newdata2 = generateHugeMesh2(100)
// let newdata = TransformSchema(JSON.parse(JSON.stringify(clonedschema)));

 
const engine = useMeshForm('main-engine',newdata,{
  config:{
    useGreedy:true,
 
  },
  UITrigger:{
    signalCreator: () => ref(0),
    signalTrigger(signal) {
      signal.value++;
    },
  },
  modules:{
    useHistory: useHistory(10),
    useMeshRenderGate
  }
});

//  engine.config.useEntangle([
//   {
//     path:''
//   }
//  ])
 
// const engine = useEngine('main-engine');
const logger = useLogger()
let cancel = engine.config.usePlugin(logger)
const perfetto = usePerfetto()
 
// engine.config.usePlugin(perfetto);

 
 

const setupfactoryformrule = ()=>{
  for (let i = 1; i < maxCount; i++) {
  let triggerPath = `mesh.a${i}_val` as any;
  let targetPath =  `mesh.a${i+1}_val` as any;
  engine.config.SetRule(triggerPath, targetPath, 'value', {
    logic: ({slot}) => {
  
      let [trigger] = slot.triggerTargets;
      return trigger.value+1
    } 
  });
};

for (let i = 2; i <= maxCount; i++) {
  const parents=  [`mesh.b${i-1}_val`, `mesh.a${i}_val`] as any;
  let targetPath =  `mesh.b${i}_val` as any;
  engine.config.SetRules(parents, targetPath, 'value', {
    logic: ({slot}) => {
   
      const [trigger1, trigger2] = slot.triggerTargets;

      if(i%7==0){
        
        return new Promise((resolve,reject)=>{
          setTimeout(() => {
            resolve(Number(trigger1.value) + (Number(trigger2.value) || 0) );
            // console.log('等待0.2s再返回逻辑：'+[trigger1,trigger2])
          }, 100);
        })
      }else{
        // trigger1 是上一个 b 的值，trigger2 是对应 a 的值
        return Number(trigger1.value) + (Number(trigger2.value) || 0);
      }
    },
     
  });
}

 

for (let i = 1; i <= maxCount; i++) {
  const target:any = `mesh.c${i}_val`;
  const parents:any = [
    `mesh.b${i}_val`,          // 近亲：同序号的 B
    `mesh.a${maxCount+1 - i}_val`     // 远亲：镜像位置的 A
  ];

  engine.config.SetRules(parents, target, 'value', {
    logic:({slot}) => {
    
  
      const [bVal, aMirrorVal] = slot.triggerTargets;
   
      // console.log(bVal,aMirrorVal)
       
      // 这里的入参就是你声明的两个触发源的值
      const res = (Number(bVal.value) || 0) + (Number(aMirrorVal.value) || 0);
      // console.log(`[C区计算] ${target} 汇聚了 B 区当前值和 A 区镜像值:`, res);
      return res;
    }
  });
}
const allCPaths = new Array(maxCount).fill(0).map((item,index)=>{
  return `mesh.c${index+1}_val`
})
engine.config.SetRules(
  allCPaths as any,      // 依赖 C 区所有节点
  'mesh.total_index',    // 目标节点
  'value',
  {
    logic: ({ slot }) => {
      // 获取所有 C 区当前计算出的值
      const cValues = slot.triggerTargets  ;
      
      // 执行求和逻辑
      const sum = cValues.reduce((acc, val) => acc + (Number(val.value) || 0), 0);
      
      // 为了让数值更好看，可以做一个归一化或取平均值
      const average = sum / maxCount;
     
      return average; // 保留两位小数
    }
  }
);

engine.config.notifyAll();
 
}
setupfactoryformrule();
 
 
 
//设置rule连线
// setupBusinessRules(
//   engine.config.SetRule as any,
//   engine.config.SetRules as any,
//   engine.config.SetStrategy as any,
//   engine.config.notifyAll
// );
 
const setupRules = ()=>{
  for(let i = 1;i<10;i++){
    let prevPath = 'cloudConsole.billing.autoRenew'+(i-1) as any;
    let path = 'cloudConsole.billing.autoRenew'+i as any
    engine.config.SetRule(
      prevPath,
      path,
      'disabled',
      {
        logic:( {slot })=>{
          
          const [val] = slot.triggerTargets;
           
          if(val.value){
            return true
          } 
         
        },
        triggerKeys:['value']
      }
    )
  }


}
// setupRules()

// setTimeout(() => {
//   engine.data.SetValue('mesh.a1_val',10)
// }, 10000);

onUnmounted(()=>{
 
  deleteEngine('main-engine')
})

// onMounted(() => {
//   setTimeout(() => {
//     engine.config.notifyAll()
//   }, 100);
  
// });

</script>
