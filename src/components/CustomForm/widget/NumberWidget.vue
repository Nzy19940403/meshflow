<template>
    <template v-if="!renderSchema.hidden">
 
      
        <v-number-input
      
        :reverse="false"
        :model-value="(renderSchema.value as number)"
        @update:model-value="handleValueChange"
        :rules="ValidatorList"
        :label="renderSchema.label"
        :required="renderSchema.required"
 
        @blur="onBlurHandler"
        :disabled="renderSchema.disabled"
        :readonly="renderSchema.readonly"
        :hideInput="false"
        :inset="false" 
        :min="renderSchema.min "></v-number-input>
    </template>

</template>
    

 


<script setup lang="ts">
import { toRefs ,ref,computed,onMounted,shallowRef,inject,Ref,watch} from 'vue';
import { VNumberInput } from 'vuetify/components';
import type {FormFieldSchema, RenderSchemaFn,InputField} from '@/utils/forms/schema/schema';
import {useDebounce} from '@/utils/useDebounce';
 
 

 

const props = withDefaults(
    defineProps<{
        fieldConfig:RenderSchemaFn<InputField>,
        dirtySignal:Ref<number>|undefined,
        hasRenderGate:boolean
    }>(),
    {
        fieldConfig:() => {
            return {} as any
        }
    }
);

const onDirty = inject('onDirty') as Function;
// const {fieldConfig} = toRefs(props);


const notify = (newValue: any,)=>{
   
     renderSchema.value.dependOn(()=>{
        return newValue
    })
}
const debouncedCommit = useDebounce(notify,1000);

const renderSchema = shallowRef<RenderSchemaFn<InputField>>(updateConfig(props.fieldConfig));
const ValidatorList:any = [
    (val:any)=>{
        if(renderSchema.value.validators){
           return renderSchema.value.validators.evaluate(val,renderSchema.value)
        }

        return true;
    }
]

function updateConfig<T extends RenderSchemaFn<InputField>>(data: T): T{
 
    return {
        ...data,
 
     
    }
}

 
const onBlurHandler = ()=>{
    renderSchema.value
}
 

const handleValueChange = async (newValue:any)=>{
   
    notify(newValue)
    // debouncedCommit(newValue)
}
if(!props.hasRenderGate){
    watch(()=>props.dirtySignal!.value,()=>{

        renderSchema.value = updateConfig(props.fieldConfig);
    
    },{
        deep:false
    })
}else{
    onDirty((nodes: any)=>{
        const path = renderSchema.value.path;
       
        if(path in nodes){
      
            renderSchema.value = nodes[path]
            
        }
    })
}

onMounted(()=>{
 
})
</script> 