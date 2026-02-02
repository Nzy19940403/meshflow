
 

      // 自动生成，请勿手动修改
        import { FormResultType } from '@/utils/core/schema/schema';  // 假设你的基础类型在这里
        import {clonedschema} from './dev.form.Schema.data';
        import { GetAllPath } from '@/utils/core/utils/util';
 

        export type FormDataModel = FormResultType<typeof clonedschema>
        export type AllPath = GetAllPath<FormDataModel> | (string & {});
     
      