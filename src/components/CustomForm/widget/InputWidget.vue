<template>
    <template v-if="!renderSchema.hidden">
 
        <v-text-field
        ref="inputref"
        :key="dirtySignal.value"
        :color="renderSchema.theme"
        :base-color="renderSchema.theme"
        :rules="ValidatorList"
        :label="renderSchema.label"
        :required="renderSchema.required"
        :model-value="_value"
        @update:model-value="handleValueChange"
        validate-on="lazy"
        @blur="handleBlur"
        :disabled="renderSchema.disabled"
        :readonly="renderSchema.readonly"></v-text-field>
    </template>
</template>
    
    


<script setup lang="ts">
import { shallowRef,Ref,watch,ref,nextTick} from 'vue';
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
const inputref:Ref<any> = ref(null);
const _value = shallowRef(renderSchema.value.value);
const allowToCommit = shallowRef(false)
  
const notify =  (newValue: any,)=>{
   
   renderSchema.value.dependOn(()=>{
       return newValue
   })
}
const changeValue = (val:any)=>{
    _value.value = val;
    nextTick(async()=>{
        const valid = await inputref.value.validate();
        //没错就允许提交
        if(valid.length===0){
            allowToCommit.value = true;
        }
    })
    
   
}
const debnounceCommit = useDebounce(changeValue,800)

const handleValueChange = async (newValue:any)=>{
    allowToCommit.value = false;
    debnounceCommit(newValue)
     
}
const handleBlur = ()=>{
     
    if(allowToCommit.value){
        notify(_value.value)
    }
    
}
 

watch(()=>props.dirtySignal.value,()=>{
    
    renderSchema.value = updateConfig(props.fieldConfig);
    _value.value =  renderSchema.value.value
},{
    deep:false
});
 
</script> 