<template>

  <div v-if="fieldConfig.type === 'group'" :key="dirtySignal?dirtySignal.value:1"  >
    <template v-if="fieldConfig.children && fieldConfig.children.length > 1000">
      <v-virtual-scroll
        :items="fieldConfig.children"
        height="80vh"
        width="100%"
        class="virtual-scroll-area pl-8"
        item-height="60"
        style="position: relative;"
      >
        <template v-slot:default="{ item }">
          <div class="pa-1">
            <CustomFormNode
              :key="item.path"
              :dirty-signal="item.dirtySignal"
              :field-config="item"
              :has-render-gate="props.hasRenderGate"
            ></CustomFormNode>
          </div>
        </template>
      </v-virtual-scroll>
    </template>

    <template v-else>
      <CustomFormNode
        v-for="child in fieldConfig.children"
        :key="child.path"
        :dirty-signal="child.dirtySignal"
        :field-config="child"
        :has-render-gate="props.hasRenderGate"
      ></CustomFormNode>
    </template>
  </div>
  <div v-else class="pb-1 relative">
    <component
      :is="getComponent(fieldConfig.type)"
      :field-config="fieldConfig"
      :dirty-signal="dirtySignal"
      :has-render-gate="props.hasRenderGate"
    ></component>

    <StatusIcon
      :path="fieldConfig.path"
      :hide="!!fieldConfig.hidden"
    ></StatusIcon>
  </div>
</template>

<script setup lang="ts">
import {
  Ref,
  defineAsyncComponent,
} from "vue";
import type { RenderSchema } from "@/utils/forms/schema/schema";
import InputWidgetVue from "./widget/InputWidget.vue";
import StatusIcon from "./StatusIcon.vue";

const props = withDefaults(
  defineProps<{
    fieldConfig: RenderSchema;
    dirtySignal: Ref<number>|undefined;
    hasRenderGate:boolean
  }>(),
  {
    fieldConfig: () => {
      return {} as RenderSchema;
    },
  }
);

const AsyncInput = defineAsyncComponent(
  () => import("./widget/InputWidget.vue")
);
const AsyncNumber = defineAsyncComponent(
  () => import("./widget/NumberWidget.vue")
);
const AsyncSelect = defineAsyncComponent(
  () => import("./widget/SelectWidget.vue")
);
const AsyncCheckbox = defineAsyncComponent(
  () => import("./widget/CheckboxWidget.vue")
);

const componentMap: Record<string, any> = {
  input: AsyncInput,
  number: AsyncNumber,
  select: AsyncSelect,
  checkbox: AsyncCheckbox,
};

function getComponent(type: string) {
  return componentMap[type] || InputWidgetVue;
}
</script>
