<template>
 
    <div v-if="fieldConfig.type === 'group'" :key="dirtySignal.value"  >
        
        <CustomFormNode
        v-for="child in fieldConfig.children" 
        :key="child.path"  
        :dirty-signal="child.dirtySignal"
        :field-config="child"
        ></CustomFormNode>
    </div>
    <div v-else class="pb-1 relative">
        
        <component :is="getComponent(fieldConfig.type)" :field-config="fieldConfig"  :dirty-signal="dirtySignal" ></component>
        
        <StatusIcon :path="fieldConfig.path" :hide="!!fieldConfig.hidden"></StatusIcon>
    </div>
  
</template>

<script setup lang="ts">
import { watch ,ref,Ref,computed,onMounted,shallowRef,defineAsyncComponent} from 'vue';
import type {  RenderSchema} from '@/utils/schema';
import InputWidgetVue from './widget/InputWidget.vue';
import StatusIcon from './StatusIcon.vue';

 
 
 


const props = withDefaults(
    defineProps<{
        fieldConfig:RenderSchema,
        dirtySignal:Ref<number>
    }>(),
    {
        fieldConfig:() => {
            return {} as RenderSchema 
        },
        
    }
);

 
 

const AsyncInput = defineAsyncComponent(() => import('./widget/InputWidget.vue'));
const AsyncNumber = defineAsyncComponent(() => import('./widget/NumberWidget.vue'));
const AsyncSelect = defineAsyncComponent(() => import('./widget/SelectWidget.vue'));
const AsyncCheckbox = defineAsyncComponent(()=>import('./widget/CheckboxWidget.vue'))

const componentMap: Record<string, any> = {
    input: AsyncInput,
    number: AsyncNumber,
    select: AsyncSelect,
    checkbox:AsyncCheckbox
};

function getComponent(type: string) {
    return componentMap[type] || InputWidgetVue;
}

 
 
 
</script> 