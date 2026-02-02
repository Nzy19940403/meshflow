<template>
  <div class="flex w-full h-full">
    <VNavigationDrawer  :width="400" v-model="showDrawer">
      <div class="flex flex-col flex-grow">
        <Card class="mb-4">
          <template #content>
            <VBtn @click="openDialog"> 新增表单 </VBtn>

            <VBtn @click="openBottomSheet"> 运行日志 </VBtn>

            <VBtn @click="goToDependency"> 依赖图 </VBtn>
          </template>
        </Card>

        <Card class="text-gray-100 mb-4">
          <template #title>联动规则</template>
          <template #content>
            <ul>
              <li>
                1,当合规性等级等于金融级的时候修改硬盘类型为hdd。当合规性等级等于金融级的时候修改硬盘类型选项，去除ssd类型硬盘
              </li>
              <li>
                2,当合规性等级为金融级的时候修改数据盘加密为开启加密,并且设置为disabled，不允许用户修改
              </li>
              <li>
                3,当开启加密的时候，显示密钥ID输入框，暂不开启的时候隐藏密钥ID输入框
              </li>
              <li>
                4,修改部署地域，修改合规性等级，修改实例类型，设置系统盘类型，开启关闭落盘加密，修改存储容量都会影响预估费用
              </li>
              <li>5,价格超过2000显示，成本预警</li>
              <li>
                6,合规提示
                如果地区是全球海外并且合规性等级是金融级的时候显示特定文案"
              </li>
              <li>
                7,如果是中国区并且合规性等级是标准的时候禁用 GPU 实例选项。
              </li>
              <li>8,实例家族如果是计算型，系统盘容量最小值应该是100</li>
            </ul>
          </template>
        </Card>

        <Card class="mb-4">
          <template #title>自定义的验证规则</template>
          <template #content>
            开启数据盘加密，KMS密钥ID就会required,并且最大长度不超过8，由输入的schema的maxLength控制
          </template>
        </Card>
      </div>
    </VNavigationDrawer>

    <VContainer>
      <div class="animate-fadeinup animate-duration-300 pt-4">
        <CustomForm
          :schema="schema"
          @submit="handleFormSubmit"
          :trace-data="true"
        ></CustomForm>
      </div>
    </VContainer>
  </div>
  <VBottomSheet v-model="showBottomSheet">
    <v-card class="text-center" height="200">
        <v-card-text>
          <div>
            <v-btn @click="handleTest">
              测试
            </v-btn>
            This is a bottom sheet that is using the inset prop
          </div>
        </v-card-text>
      </v-card>
  </VBottomSheet>

  <VDialog v-model="showDialog" fullscreen transition="dialog-bottom-transition">
      <component 
      :is="dialogContent" 
      @close="showDialog = !showDialog"
      :schema="schema"
      ></component>
  </VDialog>

</template>
<script setup lang="ts">
import Card from "primevue/card";
import CustomForm from "./CustomForm/CustomForm.vue";
import { Schema } from "@/devSchemaConfig/dev.form.Schema";
 
import {
  AllPath,
  FormDataModel,
} from "@/devSchemaConfig/dev.form.Schema.check";
import { provide } from "vue";

 
import {
  VBtn,
  VContainer,
  VNavigationDrawer,
  VBottomSheet,
  VCard
} from "vuetify/lib/components";
 
import { shallowRef,defineAsyncComponent } from "vue";

import {setupBusinessRules} from '../formRules/FormRules';
import {  useRouter } from "vue-router";
import { useEngine } from "@/utils/core/engine/useEngineManager";
 

defineOptions({
  name:'EditorForm'
})

const showBottomSheet = shallowRef(false)
const showDialog = shallowRef(false);
const showDrawer = shallowRef(true)

const dialogContent = defineAsyncComponent(()=>import('./AddNewSchema.vue'))

const engine = useEngine('main-engine');

const schema = engine.data.schema;
  
 

const router = useRouter();

const goToDependency = ()=>{
  router.push('/Editor/Dependency')
}

 
 


provide("GetFormData",  engine.data.GetFormData);

provide("SetTrace", engine.config.SetTrace);

provide('AddNewSchema',engine.data.AddNewSchema);

provide('undoAction',engine.history.Undo);

provide('redoAction',engine.history.Redo);

provide('historyStatus',{
  initCanUndo:engine.history.initCanUndo,
  initCanRedo:engine.history.initCanRedo
})

const handleFormSubmit = (data: FormDataModel) => {
  console.log(data);
};

const handleTest = ()=>{
   
  engine.data.SetValue('mesh.a1_val',50)
}

const openDialog = () => {
  showDialog.value = !showDialog.value
};

const openBottomSheet = ()=>{
  showBottomSheet.value = true
  console.log(showBottomSheet)
};

let cancel = engine.hooks.onError((error)=>{
  console.log(error.info)
})

 
 

</script>
