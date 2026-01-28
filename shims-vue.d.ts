 

declare module "*.vue" {
    import type { DefineComponent } from "vue";
    // 定义 Vue 组件的通用类型
    const component: DefineComponent<{}, {}, any>;
    export default component;
}


declare module '@/devSchemaConfig/*' {
  export const Schema: any;
  export interface FormDataModel {
      [key: string]: any;
  }

}

 
declare module 'vuetify/lib/components' {
  import * as components from 'vuetify/components'
  export * from 'vuetify/components' // 关键：允许解构导出
}

declare const __IS_PROD__:boolean;