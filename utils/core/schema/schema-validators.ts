// import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
import { FormFieldSchema,GroupField} from "./schema";
 

export const useSchemaValidators = <P>(Finder: any)=>{
    let GetByPath = Finder ? Finder : undefined;
    //用finder抓取schema设置validators

    const SetValidators = (path:P,options:{logic:(val:any,GetByPath:any)=>any,condition:(data:any)=>boolean})=>{
        let schema = GetByPath(path) as Exclude<FormFieldSchema, GroupField>;
        const fn = (cb:any,newVal:any,GetByPath:any)=>{ 
           return cb(newVal,GetByPath)
        };

        const conditionFn = (cb:any,data:any,GetByPath:any)=>{
            return cb(data,GetByPath)
        }

        if(!schema.validators){
            throw Error('validator init error');
        }
        schema.validators.setValidators({
            logic:(newVal:any)=>{
           
                return fn(options.logic,newVal,GetByPath)
            },
            condition:typeof options.condition === 'function'
            ? (data:any)=>{
                return conditionFn(options.condition,data,GetByPath)
            } 
            :()=>true
        });  
    };

    return {SetValidators}
}