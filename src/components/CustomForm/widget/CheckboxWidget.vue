<template>
    <template v-if="!renderSchema.hidden" >
        
        <div class="flex items-center">
            <VCheckbox
            hide-details
            :model-value="renderSchema.defaultValue"
            @update:model-value="handleValueChange"
            :rules="ValidatorList"
            :disabled="renderSchema.disabled">
                <template v-slot:label>
                    {{ renderSchema.label }} 
                </template>
            </VCheckbox> 
            <VTooltip v-if="renderSchema.disabled"  >
                <template v-slot:activator="{props}">
                    <v-icon v-bind="props"  icon="mdi-help-circle" class="ms-2"></v-icon> 
                </template>
                <span>{{ (renderSchema as any).description }}</span>
            </VTooltip>
            <v-btn @click="handleTest">
                test
            </v-btn>
        </div>
    </template>
</template>

<script setup lang="ts">
import { shallowRef, Ref, watch } from 'vue';
import { VCheckbox,VIcon,VTooltip } from 'vuetify/components';
import type { RenderSchemaFn, CheckboxField } from '@/utils/core/schema/schema';
import { ref } from 'vue';

const props = withDefaults(
    defineProps<{
        fieldConfig: RenderSchemaFn<CheckboxField>,
        dirtySignal: Ref<number>
    }>(),
    {
        fieldConfig: () => {
            return {} as any
        }
    }
);

const ValidatorList: any = [
    (val: any) => {
        if (renderSchema.value.validators) {
            let t = renderSchema.value.validators.evaluate(val, renderSchema.value);
            return t;
        }
        return true;
    }
]

const isUpdating = ref(true)

const renderSchema = shallowRef<RenderSchemaFn<CheckboxField>>(updateConfig(props.fieldConfig));


function updateConfig<T extends RenderSchemaFn<CheckboxField>>(data: T): T {
    return {
        ...data,
    }
}

const handleValueChange = async (newValue: any) => {
    await renderSchema.value.dependOn(() => {
        return newValue
    })
}
const handleTest = async ()=>{
     
    await renderSchema.value.dependOn(() => {
        return renderSchema.value.defaultValue
    })
}
watch(() => props.dirtySignal.value, () => {
    // console.log('监听到更新');
    renderSchema.value = updateConfig(props.fieldConfig);
}, {
    deep: false
});
</script>