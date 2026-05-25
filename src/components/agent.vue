<template>
    <div class="agent-container">
        <div class="header">
            <h2>MeshFlow 旅游策划 / AI Agent</h2>
            <span class="status-badge" :class="{ 'is-loading': isLoading }">
                {{ isLoading ? "正在规划路线..." : "规划师已就绪" }}
            </span>
        </div>

        <form @submit.prevent="handleSubmit" class="input-group">
            <textarea v-model="input" placeholder="告诉我你想去哪？比如：我想去大理玩3天，预算3000..." :disabled="isLoading"
                @keydown.enter.ctrl="handleSubmit"></textarea>

            <div class="actions">
                <button type="submit" :disabled="isLoading || !input">
                    {{ isLoading ? "深度演算中" : "生成方案" }}
                </button>
            </div>
        </form>

        <div v-if="completion || isLoading" class="result-box">
            <div class="label">AI回答：</div>
            <div class="content markdown-body" v-html="renderedMarkdown"></div>
        </div>

        <div v-if="error" class="error-msg">
            🚨 演算故障: {{ error.message }}
            <!-- <button @click="handleSubmit">重试</button> -->
        </div>
    </div>
</template>
  
<script setup lang="ts">
import { ref, computed ,onMounted} from "vue";
// @ts-ignore
import MarkdownIt from "markdown-it";

import {useMeshFlow} from '@/utils/core/engine/useEngineManager'

import {agentSchema,useTravalAgent,ReasonType} from '@/src/formRules/agent'
// 1. 初始化 Markdown 解析器
// 开启 html: true 是关键，这样我们插入的 <span class="cursor"> 才能生效
const md = new MarkdownIt({
    html: true,
    breaks: true,
    linkify: true,
});

const input = ref("");
const completion = ref<any>(null);
const isLoading = ref(false);
const error = ref<any>(null);
// 2. 👑 核心逻辑：将光标注入 Markdown 字符串
const renderedMarkdown = computed(() => {
    let source = JSON.stringify(completion.value);

    if (isLoading.value) {
        // 在字符串末尾直接拼入 HTML 标签
        // 这样 markdown-it 渲染出的最后一个 <p> 标签内部会包含这个闪烁的 span
        source += '<span class="typing-cursor"></span>';
    }

    return md.render(source || "等待输入...");
});

const auditsuggestionForMaterialpoll = ref<any>(null)

//初始化engine逻辑

const engine = useMeshFlow('agentengine',agentSchema,{
    config:{
        useGreedy:true
    },
    UITrigger: { signalCreator: () => ref(0), signalTrigger: (signal) => signal.value++ },
    modules:{
        useTravalAgent
    }
})

engine.config.SetRule(
    'userInput',
    'materialPool',
    'value',
    {
        triggerKeys:['version'],
        logic:async({slot})=>{
       
            // const [trigger] = slot.triggerTargets;
        
            // const reasonType = trigger.proxy.reasonType
            const target = slot.targetMeta
            
            // if(reasonType===ReasonType.INTENT_DRIVEN){
                const brief = {
                    meta:{
                        ...target
                    } ,
                    data:{
                        ...completion.value,
                        
                    },
                    type:'materialPool'
                }
                // const agentJson = await callAgent(brief);

                // const json = await agentJson.json()
               
                const json = {
    "success": true,
    "data": {
        "planName": "成都巅峰蜀韵·大熊猫与古蜀文明极致2日之旅",
        "attractions": [
            {
                "name": "成都大熊猫繁育研究基地",
                "price": 55,
                "openHours": "07:30-18:00",
                "coordinates": {
                    "lat": 30.7335,
                    "lng": 104.1441
                },
                "reason": "全球唯一近距离观察大熊猫繁育的顶级科研机构，是体验国宝魅力的不二之选。"
            },
            {
                "name": "三星堆博物馆",
                "price": 72,
                "openHours": "08:30-18:00",
                "coordinates": {
                    "lat": 31.0051,
                    "lng": 104.2212
                },
                "reason": "20世纪人类最伟大的考古发现之一，其青铜神树与黄金面具展现了古蜀文明的神秘震撼。"
            },
            {
                "name": "武侯祠博物馆",
                "price": 50,
                "openHours": "09:00-18:00",
                "coordinates": {
                    "lat": 30.6455,
                    "lng": 104.0481
                },
                "reason": "中国唯一的君臣合祀祠庙，三国文化的朝圣之地，红墙竹影极具东方美学价值。"
            },
            {
                "name": "杜甫草堂",
                "price": 50,
                "openHours": "09:00-18:00",
                "coordinates": {
                    "lat": 30.6601,
                    "lng": 104.0285
                },
                "reason": "中国文学史上的圣地，在清幽的川西园林中感悟诗圣的家国情怀与极致雅趣。"
            },
            {
                "name": "都江堰景区",
                "price": 80,
                "openHours": "08:00-18:00",
                "coordinates": {
                    "lat": 31.0012,
                    "lng": 103.6115
                },
                "reason": "全世界唯一留存并仍在使用的宏大无坝引水工程，人类智慧与自然和谐的巅峰之作。"
            },
            {
                "name": "成都远洋太古里",
                "price": 0,
                "openHours": "10:00-22:00",
                "coordinates": {
                    "lat": 30.6548,
                    "lng": 104.0815
                },
                "reason": "传统川西建筑与现代奢华商业的完美融合，代表了成都最顶尖的时尚生活方式。"
            }
        ],
        "totalEstimatedTicketCost": 307
    }
}

                if(json.success){
                    return json.data
                }
            
            // }
            
            
        },
        effect:(data)=>{
            return {
                version:data.version++
            }
        },
        effectArgs:['version']
        
    }
);
//通知管家进行查询
engine.config.SetRule(
    'userInput',
    'schedule',
    'value',
    {   
        triggerKeys:[
            'version'
        ],
        logic:async({slot})=>{
            const target = slot.targetMeta
            
         
            const brief = {
                meta:{
                    ...target
                } ,
                data:completion.value,
                type:'schedule'
            }
        
            // const agentJson = await callAgent(brief);

            // const json = await agentJson.json()

            const json = 
{
    "success": true,
    "data": {
        "centerGravityAnalysis": "鉴于未提供具体景点坐标，基于成都核心旅游资源（如太古里、宽窄巷子、武侯祠及大熊猫基地）的分布规律，地理重心精准锁定在‘春熙路/天府广场’核心商圈。该区域作为成都的几何与交通双重中心，可确保前往东西南北各向景点的通勤时间均等且最短，从物理空间上彻底杜绝了跨城区的‘折返跑’，为雇主争取到每日额外的深度睡眠时间。",
        "hotelOptions": {
            "luxury": {
                "name": "成都博舍 (The Temple House)",
                "pricePerNight": 3500,
                "coordinates": {
                    "lat": 30.6582,
                    "lng": 104.0815
                }
            },
            "comfort": {
                "name": "成都春熙路亚朵S酒店",
                "pricePerNight": 580,
                "coordinates": {
                    "lat": 30.6551,
                    "lng": 104.0789
                }
            },
            "budget": {
                "name": "汉庭酒店 (成都春熙路步行街中心店)",
                "pricePerNight": 280,
                "coordinates": {
                    "lat": 30.6605,
                    "lng": 104.0842
                }
            }
        }
    }
}
            
            if(json.success){
                return json.data
            }
       
        },
        effect:(data)=>{
            return {
                version: (data.version || 0) + 1
            }
        },
        effectArgs:['version']   
    }
)
//通知司机进行规划
engine.config.SetRule(
    'userInput',
    'transport',
    'value',
    {   
        triggerKeys:[
            'version'
        ],
        logic:async({slot})=>{
            const target = slot.targetMeta
            
         
            const brief = {
                meta:{
                    ...target
                } ,
                data:completion.value,
                type:'transport'
            }

            const json =  {
    "success": true,
    "data": {
        "optimizedRoute": [
            "春熙路/太古里区域酒店",
            "大熊猫繁育研究基地(Day1上午)",
            "文殊院(Day1下午)",
            "宽窄巷子(Day1晚上)",
            "杜甫草堂(Day2上午)",
            "武侯祠/锦里(Day2下午)",
            "返回春熙路酒店"
        ],
        "routeReasoning": "作为20年老司机，我建议你把大本营扎在春熙路。第一天趁早走北边看熊猫，避开北新干道的早高峰，下午顺路回城逛文殊院；第二天主攻西边的文化线，草堂和武侯祠都在西二环附近，不走回头路。这套方案避开了成都最堵的南边天府大道，主打一个顺滑。",
        "estimatedCost": {
            "taxiOrCar": 260,
            "publicTransit": 48
        },
        "transportAdvice": "成都早晚高峰（7:30-9:30, 17:30-19:30）二环高架和天府大道是‘重灾区’。去熊猫基地千万别打车，地铁3号线直达最稳；去宽窄巷子和锦里，地铁4号线和3号线比出租车快得多。打车建议选在中午或晚上20点以后。"
    }
}
     
            // const agentJson = await callAgent(brief);

            // const json = await agentJson.json()
           
            if(json.success){
                return json.data
            }
           
        },
        effect:(data)=>{
           
            return {
                version: (data.version || 0) + 1
            }
        },
        effectArgs:['version']   
    }
);

engine.config.SetRules(
    ['materialPool','schedule','transport'],
    'audit',
    'value',
    {
        triggerKeys:['version'],
        logic:  async({slot})=>{
         
            const [materialPool,schedule,transport] = slot.triggerTargets
            const target = slot.targetMeta;
        
            const brief = {
                meta:{
                    ...target
                } ,
                data:completion.value,
                situation: {
                    ticketCost: materialPool.proxy.value.totalEstimatedTicketCost || 0,
                    
                    // 🌟 核心修改：不替财务做决定！把高中低三档酒店打包全发过去！
                    hotelOptions: schedule.proxy.value.hotelOptions || {}, 
                    
                    // 交通费用也全发过去
                    transportLuxuryCost: transport.proxy.value.estimatedCost.taxiOrCar || 0,
                    transportPublicCost: transport.proxy.value.estimatedCost.publicTransit || 0
                },
                type:'audit'
            }
             
     
           
            const agentJson = await callAgent(brief);
          
            const json = await agentJson.json();

            if(json.success){
                return json.data
            }
        },
        effect:(data)=>{
            return {
                version: (data.version || 0) + 1
            }
        },
        effectArgs:['version']   
    }
);
engine.config.useEntangle({
    cause:'audit',
    impact:'materialPool',
    isProxy:true,
    via:['value'],
    emit:(cause,impact,propose)=>{
        auditsuggestionForMaterialpoll.value  = cause.value
        debugger
    }
})

const handleSubmit = async (e?: Event) => {
    if (e) e.preventDefault();
    if (!input.value.trim() || isLoading.value) return;

    isLoading.value = true;
    completion.value = "";
    error.value = null;
    auditsuggestionForMaterialpoll.value = null;

    try {
        const meta = engine.data.GetValue('userInput','meta');
     
        const response = await fetch("http://localhost:8787/api/analyse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: input.value,systemPrompt: `${meta.persona}\n${meta.instruction}` }),
        });
        

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const result = await response.json();
      
        completion.value = result.data;

        const version = engine.data.GetValue('userInput','version');
              
        engine.data.SetValues([
            {
                path:'userInput',key:'version',value:version+1
            },
            {
                path:'userInput',key:'reasonType',value:ReasonType.INTENT_DRIVEN
            }
        ])

 
    } catch (err: any) {
        error.value = err;
    } finally {
        isLoading.value = false;
    }
};

const callAgent = async (brief:any)=>{
   
    const response = fetch("http://localhost:8787/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
    });
    return response;
}

onMounted(() => {
    // callAgent({
    //     meta:engine.data.GetValue('materialPool','meta'),
    //     data:{"destination":"北京","days":3,"budget":5000,"requirement":null},
    //     type:'materialPool'
    // })
})
</script>
  
<style scoped>
/* 3. 👑 核心样式：让光标跳动起来 */

/* 必须使用 :deep，因为这些 HTML 是由 v-html 动态插入的，scoped 样式默认管不到 */
.markdown-body :deep(.typing-cursor) {
    display: inline-block;
    width: 8px;
    height: 18px;
    background: #4a90e2;
    margin-left: 4px;
    vertical-align: middle;
    /* 使用 steps 动画让它看起来更有“打字”的机械感 */
    animation: blink 0.8s steps(2, start) infinite;
}

@keyframes blink {
    0% {
        opacity: 0;
    }

    50% {
        opacity: 1;
    }

    100% {
        opacity: 0;
    }
}

/* 以下是基础 UI 样式 */
.agent-container {
    padding: 20px;
    max-width: 800px;
    margin: auto;
    font-family: sans-serif;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #eee;
    padding-bottom: 10px;
}

.status-badge {
    font-size: 12px;
    color: #999;
}

.status-badge.is-loading {
    color: #4a90e2;
    font-weight: bold;
}

.input-group {
    margin: 20px 0;
}

textarea {
    width: 100%;
    height: 100px;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-sizing: border-box;
}

button {
    padding: 10px 20px;
    background: #1a1a1a;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    float: right;
    margin-top: 10px;
}

.result-box {
    margin-top: 80px;
    background: #fdfdfd;
    padding: 20px;
    border-radius: 12px;
    border: 1px solid #f0f0f0;
}

.label {
    color: #888;
    font-size: 13px;
    margin-bottom: 15px;
    font-weight: bold;
}

/* Markdown 内部排版样式微调 */
.markdown-body {
    line-height: 1.8;
    color: #2c3e50;
}

.markdown-body :deep(h2) {
    border-bottom: 2px solid #4a90e2;
    display: inline-block;
    padding-bottom: 4px;
}

.markdown-body :deep(p) {
    margin-bottom: 1em;
}

.markdown-body :deep(strong) {
    color: #e67e22;
}</style>