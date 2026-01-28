<template>
  <v-form ref="formRef" v-if="isLoaded">
    <CustomFormNode
      :field-config="internalSchema"
      :dirty-signal="internalSchema.dirtySignal"
    ></CustomFormNode>
  </v-form>

  <div class="flex flex-row-reverse">
    <v-btn variant="tonal" color="secondary" @click="handleSubmit" size="large">
      提交
    </v-btn>
  </div>

  <v-fab size="large" icon="mdi-history" location="top right" :absolute="true">
    <v-icon icon="mdi-history"></v-icon>
    <v-speed-dial
      location="left center"
      transition="slide-y-reverse-transition"
      activator="parent"
    >
      <v-btn key="redo" icon="mdi-redo-variant" @click="handleRedo" :disabled="redoSize<=0"></v-btn>
      <v-btn key="undo" icon="mdi-undo-variant" @click="handleUndo" :disabled="undoSize<=0"> </v-btn>
    </v-speed-dial>
  </v-fab>
</template>

<script setup lang="ts">
import { ref, onMounted, shallowRef, inject } from "vue";

import CustomFormNode from "./CustomFormNode.vue";
import { RenderSchema } from "@/utils/schema";

import { FormDataModel } from "@/devSchemaConfig/dev.form.Schema.check";

import { watch } from "vue";

const props = defineProps<{
  schema: any;
  traceData: boolean;
}>();

const emits = defineEmits<{
  (e: "submit", data: FormDataModel): void;
}>();

const undoAction = inject('undoAction') as Function;

const redoAction = inject('redoAction') as Function;
 
const historyStatus = inject<{
    initCanUndo:(cb:(value:number)=>void)=>void ,
    initCanRedo:(cb:(value:number)=>void)=>void
}>('historyStatus') ;

const undoSize = shallowRef(0);

const redoSize = shallowRef(0);

const formRef = ref();

let internalSchema = shallowRef<RenderSchema>(props.schema);

const isLoaded = shallowRef(false);

const GetFormData = inject("GetFormData") as () => FormDataModel;


historyStatus!.initCanUndo((value:number)=>{
    undoSize.value = value;
});
historyStatus!.initCanRedo((value:number)=>{
    redoSize.value = value;
});

onMounted(() => {});

 

const handleSubmit = async () => {
  const { valid } = await formRef.value.validate();
  console.log(valid);

  let formdata = GetFormData();

  if (valid) {
    emits("submit", formdata);
  }
};

watch(
  () => props.schema,
  (newSchema) => {
    if (newSchema) {
      if (typeof newSchema === "object" && newSchema !== null) {
        internalSchema.value = newSchema;
        isLoaded.value = true;
      }
    }
  },
  { immediate: true }
);


const handleUndo = ()=>{
    console.log('undo');
    undoAction();
}
const handleRedo = ()=>{
    console.log('redo');
    redoAction();
}

</script>
