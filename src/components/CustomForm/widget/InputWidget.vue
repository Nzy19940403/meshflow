<template>
    <template v-if="!renderSchema.hidden">
 
        <v-text-field
        :key="dirtySignal.value"
        :color="renderSchema.theme"
        :base-color="renderSchema.theme"
        :rules="ValidatorList"
        :label="renderSchema.label"
        :required="renderSchema.required"
        :model-value="renderSchema.value"
        @update:model-value="handleValueChange"
  
   
        :disabled="renderSchema.disabled"
        :readonly="renderSchema.readonly"></v-text-field>
    </template>
</template>
    
    


<script setup lang="ts">
import { shallowRef,Ref,watch} from 'vue';
import { VTextField } from 'vuetify/components';
import type {RenderSchemaFn,InputField} from '@/utils/core/schema/schema';
import { ValidatorsBucket } from '@/utils/core/engine/bucket';
import { useDebounce } from '@/utils/useDebounce';

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

const ValidatorList:any = [
    (val:any)=>{
        if(renderSchema.value.validators ){
           let t = (renderSchema.value.validators as ValidatorsBucket).evaluate(val,renderSchema.value); 
           return t;
        }
        return true;
    }
]
 
const renderSchema = shallowRef<RenderSchemaFn<InputField>>(updateConfig(props.fieldConfig));
 

function updateConfig<T extends RenderSchemaFn<InputField>>(data: T): T{
    return {
        ...data,
    }
}

  
const notify =  (newValue: any,)=>{
   
   renderSchema.value.dependOn(()=>{
       return newValue
   })
}
const debnounceCommit = useDebounce(notify,500)

const handleValueChange = async (newValue:any)=>{

    debnounceCommit(newValue)
//   notify(newValue);
}

 

watch(()=>props.dirtySignal.value,()=>{
    // console.log('监听到更新');
    renderSchema.value = updateConfig(props.fieldConfig);
},{
    deep:false
});
 
</script> 