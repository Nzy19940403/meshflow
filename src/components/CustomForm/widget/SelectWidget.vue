<template>
    <template v-if="!renderSchema.hidden">
     
         
        <VSelect
        :model-value="renderSchema.value"
        @update:model-value="handleValueChange"
        :items="renderSchema.options"
        item-title="label"
        item-value="value"
        :rules="ValidatorList"
        persistent-hint
        :label="renderSchema.label" 
        :disabled="renderSchema.disabled"
        :readonly="renderSchema.readonly"></VSelect>
    </template>
</template>
    
    

<script setup lang="ts">
import { VSelect } from 'vuetify/components';
import {toRefs,shallowRef,inject,watch,Ref} from 'vue';
import type {  RenderSchemaFn,SelectField} from '@/utils/core/schema/schema';
 
const props = withDefaults(
    defineProps<{
        fieldConfig:RenderSchemaFn<SelectField> ,
        dirtySignal:Ref<number>
    }>(),
    {
        fieldConfig:() => {
            return {
          
            } as any
        }
    }
);
 
const renderSchema = shallowRef<RenderSchemaFn<SelectField>>(updateConfig(props.fieldConfig));

const ValidatorList:any = [
    (val:any)=>{
        if(renderSchema.value.validators){
            
           return renderSchema.value.validators.evaluate(val,renderSchema.value)
        }

        return true;
    }
];

 

function updateConfig(data:RenderSchemaFn<SelectField> ):RenderSchemaFn<SelectField> {
    return {
        ...data,
    }
}
 

const handleValueChange =  (newValue:any)=>{
 

     renderSchema.value.dependOn((field)=>{
        return newValue
    });
 
}

watch(()=>props.dirtySignal.value,()=>{
    // console.log('监听到更新');
    renderSchema.value = updateConfig(props.fieldConfig);
  
},{
    deep:false
})
</script>

 