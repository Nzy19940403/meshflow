import { FinalFlatten } from "../useForm";

import { SchemaBucket } from "@meshflow/core";


export type FormItemValidationFn = (value: any) => boolean | string;
export type FormItemValidationFns = readonly FormItemValidationFn[];

type BaseField = {
  label: string;
  name: string;
  placeholder?: string;
  disabled: boolean;
  readonly: boolean;
  hidden?: boolean;
  validators?: any;
  theme?: string;
};

export type InputField = BaseField & {
  type: "input" | "number";
  required: boolean;
  min?: number;
  maxLength: number;
 
  value:string|number
};
export type CheckboxField = BaseField & {
  type: "checkbox";
  description?: string;
  required: boolean;
 
  value:boolean
};
export type SelectField = BaseField & {
  type: "select";
  required: boolean;
  options: { label: string; value: any }[];
 
  value:any
};

// 注意这里：GroupField 必须定义为 type 才能在递归中正常分发
export type GroupField = Omit<
  BaseField,
  "label" | "name" | "placeholder" | "validators"
> & {
  type: "group";
  name?: string;
  children: FormFieldSchema[];
};
export type FormFieldSchema =
  | InputField
  | CheckboxField
  | SelectField
  | GroupField;

//一些额外的共同属性，属于渲染时的schema，不属于基础的schema
type RenderSchemaExtraCommonType<P = any> = {
  path: P;
  dirtySignal: any;
  uid: number;
  nodeBucket: Record<string, SchemaBucket<P>>;
  // affectedArray: Set<string>; //用来记录哪些path会被本属性值影响
  dependOn: (cb: (...args: any) => void) => void;
};

export type RenderSchemaFn<T> = FinalFlatten<
  T extends GroupField
    ? Omit<T, "children"> &
        RenderSchemaExtraCommonType & {
          // 关键：强制让 children 里面的每一项都是转换后的 RenderSchema
          children: Array<RenderSchemaFn<FormFieldSchema>>;
        }
    : T & RenderSchemaExtraCommonType
>;

export type RenderSchema = RenderSchemaFn<FormFieldSchema>;

 

type CollapseChildren<T> = T extends readonly [infer First, ...infer Rest]
  ? FormResultType<First> & CollapseChildren<Rest>
  : {};

// 3. 核心推导逻辑
export type FormResultType<T> = T extends any
  ? T extends {
      readonly type: "group";
      readonly name: infer N;
      readonly children: infer C;
    }
    ? N extends string
      ? N extends ""
        ? FinalFlatten<CollapseChildren<C>>
        : { [K in N]: FinalFlatten<CollapseChildren<C>> }
      : FinalFlatten<CollapseChildren<C>>
    : T extends { readonly name: infer N; readonly value: infer V }
    ? N extends string
      ? { [K in N]: FinalFlatten<V> } // 💡 这里使用了 Widen，将字面量转为基础类型
      : never
    : {}
  : {};

 
