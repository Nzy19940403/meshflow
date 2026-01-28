<template>
  <div
    class="w-8 absolute h-14 right-full top-0 flex items-center justify-center"
  >
    <v-icon
      size="20"
      :icon="iconRef"
      :class="iconClass"
      v-if="!props.hide"
    ></v-icon>
    <!-- <div  v-if="!props.hide">
      {{ iconStatus }}
    </div> -->
     
  </div>
</template>

<script setup lang="ts">
import { shallowRef } from "vue";
import { onMounted } from "vue";
import { inject } from "vue";
 
import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
 

const iconRef = shallowRef("idle");

const iconClass = shallowRef("");

const iconStatus = shallowRef("idle");

// const show = shallowRef(true);

const props = defineProps<{
  path: AllPath;
  hide: boolean;
}>();

// const inited = shallowRef(false);

const SetTrace = inject("SetTrace") as Function;

onMounted(() => {
  SetTrace(props.path, (status: any) => {
    //检查是否显示
 
    iconStatus.value = status;

    const baseIcon: any = {
      pending: "mdi-dots-horizontal",
      idle: "",
      calculated: "mdi-check-outline",
      calculating: "mdi-loading",
      error:"mdi-close-octagon",
      canceled:"mdi-cancel"
    };

    const baseAnimation: any = {
      pending: "",
      idle: "",
      calculated: "",
      calculating: "animate-spin",
      error:"",
      canceled:""
    };
     
    iconClass.value = baseAnimation[iconStatus.value];
    iconRef.value = baseIcon[iconStatus.value];
  });
});
</script>
