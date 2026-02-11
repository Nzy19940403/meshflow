<template>
  <VCard>
    <VSheet>
      <div class="h-full w-full">
        <v-toolbar>
     

          <v-toolbar-title>创建表单组件</v-toolbar-title>

          <v-toolbar-items>
            <v-btn icon="mdi-close" @click="closeDialog"></v-btn>
          </v-toolbar-items>
        </v-toolbar>
        <div class="mt-4">
          <v-form ref="form">
            <v-row>
              <v-col cols="12" md="8" offset="2" class="pb-0">
                <v-text-field
                  hide-details
                  label="集合路径"
                  placeholder="选择插入的集合"
                  readonly
                  v-model="ChoosePath"
                  required
                  :rules="initRules('集合路径')"
                ></v-text-field>
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="8" offset="2" class="p-0">
                <VCard>
                  <v-treeview
                    :items="GroupData"
                    item-value="path"
                    items-registration="props"
                    open-all
                  >
                    <template v-slot:title="{ item }">
                      <div @click.stop="onNodeClick(item)">
                        {{ item.title }}
                      </div>
                    </template>
                  </v-treeview>
                </VCard>
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="8" offset="2" class="pb-0">
                <v-select
                  clearable
                  label="组件类型"
                  :items="ComponentTypes"
                  :model-value="ComponentType"
                  @update:model-value="handleComponentTypeUpdate"
                  required
                  :rules="initRules('组件类型')"
                ></v-select>
              </v-col>
            </v-row>

            <v-row v-if="ComponentType !== ''">
              <v-col md="2" offset="2">
                <v-text-field
                  label="组件名称"
                  v-model="currentForm.label"
                  required
                  :rules="initRules('组件名称')"
                ></v-text-field>
              </v-col>
              <v-col md="2">
                <v-text-field
                  label="组件键值"
                  v-model="currentForm.name"
                  required
                  :rules="initRules('组件键值')"
                ></v-text-field>
              </v-col>
              <v-col md="2">
                <v-text-field
                  label="默认值"
                  v-model="currentForm.value"
                ></v-text-field>
              </v-col>
              <v-col md="2">
                <v-text-field
                  label="占位提示"
                  v-model="currentForm.placeholder"
                ></v-text-field>
              </v-col>
            </v-row>
            <v-row v-if="ComponentType !== ''">
              <v-col md="2" offset="2">
                <v-switch
                  label="是否禁用"
                  v-model="currentForm.disabled"
                ></v-switch>
              </v-col>
              <v-col md="2">
                <v-switch
                  label="是否只读"
                  v-model="currentForm.readonly"
                ></v-switch>
              </v-col>
              <v-col md="2">
                <v-switch
                  label="是否必填"
                  v-model="currentForm.required"
                ></v-switch>
              </v-col>
              <v-col md="2" v-if="ComponentType === 'input'">
                <v-number-input
                  :reverse="false"
                  controlVariant="default"
                  label="最大值"
                  :min="1"
                  :hideInput="false"
                  :inset="false"
                  v-model="(currentForm as InputField).maxLength"
                ></v-number-input>
              </v-col>
              <v-col md="2" v-if="ComponentType === 'number'">
                <v-number-input
                  :reverse="false"
                  controlVariant="default"
                  label="最小值"
                  :min="0"
                  :hideInput="false"
                  :inset="false"
                  v-model="(currentForm as InputField).min"
                ></v-number-input>
              </v-col>
              <v-col md="2" v-if="ComponentType === 'checkbox'">
                <v-text-field
                  label="描述"
                  v-model="(currentForm as CheckboxField).description"
                ></v-text-field>
              </v-col>
            </v-row>
            <v-row v-if="ComponentType === 'select'">
              <v-col md="3" offset="2">
                <v-text-field
                  label="选项名称"
                  ref="optionsSelect"
                  v-model="selectOptionItem"
                  required
                  :rules="initRules('选项名称')"
                >
                  <template v-slot:append="{ isValid }">
                    <v-btn @click="AddOptions($refs.optionsSelect, isValid)">
                      <v-icon color="red"> mdi-plus </v-icon>
                    </v-btn>
                  </template>
                </v-text-field>
              </v-col>
              <v-col md="5">
                <v-select
                  chips
                  :model-value="optionChips"
                  label="选项"
                  :items="(currentForm as SelectField).options"
                  item-title="label"
                  item-value="value"
                  multiple
                ></v-select>
              </v-col>
            </v-row>
          </v-form>

          <v-row v-if="ComponentType !== ''">
            
            <v-col md="8" offset="2" class="pb-0">
              <v-select label="联动目标表单" :items="ruleTargetOptions" v-model="ruleConfig.targetPath"></v-select>
            </v-col>
            <v-col md="8" offset="2">
              <v-select label="联动对象属性" :items="ruleTargetKeys" v-model="ruleConfig.targetKey"></v-select>
            </v-col>

            <v-col md="4" offset="2">
              <v-select label="逻辑关系" :items="ruleCompute" v-model="ruleConfig.logicCondition"></v-select>
            </v-col>
            <v-col md="4" >
              
                <v-select label="结果" :items="ruleComputeResult" v-model="ruleConfig.logicAction"></v-select>
           
              
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="8" offset="2" class="p-0 mt-2">
              <v-btn color="#5865f2" class="w-full" @click="handleConfirm">
                确认
              </v-btn>
            </v-col>
          </v-row>
        </div>
      </div>
    </VSheet>
  </VCard>
</template>
<script setup lang="ts">
import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
import {
  FormFieldSchema,
  GroupField,
  RenderSchemaFn,
  InputField,
  CheckboxField,
  SelectField,
} from "@/utils/core/schema/schema";
import { toRaw } from "vue";
import { inject } from "vue";
import { computed } from "vue";
import { shallowRef, ref } from "vue";
import { onMounted } from "vue";
import { useEngine } from "@/utils/core/engine/useEngineManager";

const engine = useEngine('main-engine');
const AddNewSchema = inject("AddNewSchema") as (
  path: string,
  data: any
) => any;

const props = defineProps<{
  schema: any;
}>();

const emits = defineEmits<{
  (e: "close"): void;
}>();

const closeDialog = () => {
  emits("close");
};

const initRules = (fieldName: string) => {
  return [(v: any) => !!v || `${fieldName} is required`];
};

let uid = 0;
//选择group路径
const GroupData = shallowRef<Array<any>>([]);

const ChoosePath = shallowRef<AllPath | "">("");
//选择的组件类型
const ComponentType = shallowRef("");
//提供的组件类型选项
const ComponentTypes = shallowRef(["input", "number", "select", "checkbox"]);
//当前表单，根据选择的组件类型不同会切换不同的表单
const currentForm = ref<RenderSchemaFn<Exclude<FormFieldSchema, GroupField>>>(
  {} as any
);
//当选择表单组件的时候需要提供选项
const selectOptionItem = shallowRef("");
//已经提供的选项
let optionChips = shallowRef<string[]>([]);

const form = ref();
//设置联动规则，选择的下游节点选项
const ruleTargetOptions = shallowRef<any>([]);
const ruleTargetKeys = shallowRef(['defalutValue','hidden','readonly','disabled']);
const ruleCompute = shallowRef(['ifTrue','ifFalse'])
const ruleComputeResult:any = shallowRef(['SetTrue','SetFalse'])

const ruleComputeResultMap = new Map([
  ['SetTrue',()=>true],
  ['SetFalse',()=>false]
])
const ruleComputeMap = new Map<string,any>([
  ['ifTrue',(cb:Function)=>(api:any)=>{
      const [value] = api.slot.triggerTargets;
      if(value===true) return cb();
      return undefined
  }],
  ['ifFalse',(cb:Function)=>(api:any)=>{
      const [value] = api.slot.triggerTargets;
      if(value===false) return cb();
      return undefined;
  }]
])


const ruleConfig = ref({
  targetPath:'',
  targetKey:'',
  logicAction:'',
  logicCondition:''
})

const createInputForm = {
  label: "",
  name: "",
  type: "input",
  placeholder: "",
  disabled: false,
  readonly: false,
  required: false,
  value: "",
  maxLength: 20,
  validators: [],
};

const createNumberForm = {
  label: "",
  name: "",
  type: "number",
  placeholder: "",
  disabled: false,
  readonly: false,
  required: false,
  value: "",
  min: 10,
  validators: [],
};

const createCheckboxForm = {
  label: "",
  name: "",
  type: "checkbox",
  placeholder: "",
  disabled: false,
  readonly: false,
  required: false,
  value: false,
  validators: [],
  description: "",
};

const createSelectForm = {
  label: "",
  name: "",
  type: "checkbox",
  placeholder: "",
  disabled: false,
  readonly: false,
  required: false,
  value: "",
  validators: [],
  options: [] as { label: string; value: any }[],
};

const TransformSchema = (data: any) => {
 
  let list: any = [];
 
  const helper = (data: any, array: any) => {
    if (data.type === "group") {
      let obj: any = {
        id: ++uid,
        title: data.name,
        path: data.path,
      };
      let childrenList: any = [];
      if (data.children) {
        for (let child of data.children) {
          helper(child, childrenList);
        }
      }
      if (childrenList.length > 0) {
        obj.children = childrenList;
      }
      array.push(obj);
    }
  };
  helper(data, list);

  GroupData.value = list;
  console.log(list)
};

const onNodeClick = (data: any) => {
  ChoosePath.value = data.path;
};

const handleComponentTypeUpdate = (data: any) => {
  ComponentType.value = data;
  if (data == "input") {
    currentForm.value = { ...createInputForm } as RenderSchemaFn<InputField>;
  }
  if (data === "number") {
    currentForm.value = { ...createNumberForm } as RenderSchemaFn<InputField>;
  }
  if (data === "checkbox") {
    currentForm.value = {
      ...createCheckboxForm,
    } as RenderSchemaFn<CheckboxField>;
  }
  if (data === "select") {
    currentForm.value = { ...createSelectForm } as RenderSchemaFn<SelectField>;
  }
};
const handleAddNewRule = (data:any)=>{
 
  engine.config.SetRule(
    data.path,
    ruleConfig.value.targetPath as any,
    ruleConfig.value.targetKey as any,
    {
      logic:ruleComputeMap.get(ruleConfig.value.logicCondition)(ruleComputeResultMap.get(ruleConfig.value.logicAction))  
    }
  );
  
}

const handleConfirm = async () => {
  const { valid } = await form.value.validate();
  if (valid) {
    let data = toRaw(currentForm.value);

    const newNode = AddNewSchema(ChoosePath.value, data);

    handleAddNewRule(newNode);

    console.log(engine.dependency.GetAllDependency())
    

    emits("close");
  }
};

const AddOptions = async (fieldInstance: any, isValid: any) => {
  await fieldInstance.validate();
  console.log(isValid);
  if (isValid) {
    let val = selectOptionItem.value;
    if (val === "") return;

    let obj: { label: string; value: any } = {
      value: val,
      label: val,
    };
    if (optionChips.value.includes(val)) return;

    (currentForm.value as SelectField).options.push(obj);
    optionChips.value.push(val);
    selectOptionItem.value = "";
    fieldInstance.reset();
  }
};

const getFormOptions = ()=>{
  let list = engine.dependency.GetAllDependency();
 
  let array = Array.from(list.keys())
  ruleTargetOptions.value = array;
}

onMounted(() => {
  TransformSchema(props.schema);
  getFormOptions()
});
</script>
