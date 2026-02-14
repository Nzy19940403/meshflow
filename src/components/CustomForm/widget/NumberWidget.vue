<template>
    <template v-if="!renderSchema.hidden">
 
      
        <v-number-input
        :key="dirtySignal.value"
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
import type {FormFieldSchema, RenderSchemaFn,InputField} from '@/utils/core/schema/schema';
import {useDebounce} from '@/utils/useDebounce';
 
 

 

const props = withDefaults(
    defineProps<{
        fieldConfig:RenderSchemaFn<InputField>,
        dirtySignal:Ref<number>
    }>(),
    {
        fieldConfig:() => {
            return {} as any
        }
    }
);

 
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

watch(()=>props.dirtySignal.value,()=>{

    renderSchema.value = updateConfig(props.fieldConfig);
   
},{
    deep:false
})
onMounted(()=>{
 
})
</script> 