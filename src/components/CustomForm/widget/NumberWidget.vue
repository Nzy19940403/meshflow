<template>
    <template v-if="!renderSchema.hidden">
 
     
        <v-number-input
        :reverse="false"
        :model-value="(renderSchema.defaultValue as number)"
        @update:model-value="handleValueChange"
        :rules="ValidatorList"
        :label="renderSchema.label"
        :required="renderSchema.required"
 
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
import type {FormFieldSchema, RenderSchemaFn,InputField} from '@/utils/schema';
import {useDebounce} from '@/utils/hooks/useDebounce';
import { formdataChangeSymbol } from '@/utils/symbols'
 

const commintFn = inject<(path:any,val:any)=>void>(formdataChangeSymbol,()=>{
    console.error('未注入方法')
})  

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


const notify = async (newValue: any,)=>{
   
    await renderSchema.value.dependOn(()=>{
        return newValue
    })
}
const debouncedCommit = useDebounce(notify, 500);

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

 

 

const handleValueChange = async (newValue:any)=>{
   
    notify(newValue)
}

watch(()=>props.dirtySignal.value,()=>{
    // console.log('监听到更新');
    renderSchema.value = updateConfig(props.fieldConfig);
 
},{
    deep:false
})
onMounted(()=>{
 
})
</script> 