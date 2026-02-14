import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
import { DefaultStarategy } from "@/utils/core/engine/bucket";
import { FormFieldSchema, GroupField, InputField,CheckboxField,SelectField } from "@/utils/core/schema/schema";
import { logicApi } from "@/utils/core/dependency/useSetRule";
import { KeysOfUnion } from "@/utils/core/utils/util";
 
 

export function setupBusinessRules(
    SetRule:(outDegreePath: AllPath, inDegreePath: AllPath, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, options?: {
        value?: any;
        priority?: number | undefined;
        subscribeKey?: KeysOfUnion<InputField | CheckboxField | SelectField>[] | undefined;
        logic: (api: logicApi) => any;
        effect?:(args:any)=>any,
        effectArgs?:Array<KeysOfUnion<Exclude<FormFieldSchema, GroupField>>>
    }) => void,
    SetRules:(outDegreePaths: AllPath[], inDegreePath: AllPath, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, options?: {
        value?: any;
        priority?: number | undefined;
        subscribeKey?: KeysOfUnion<InputField | CheckboxField | SelectField>[] | undefined;
        logic: (api: logicApi) => any;
        effect?:(args:any)=>any,
        effectArgs?:Array<KeysOfUnion<Exclude<FormFieldSchema, GroupField>>>
    }) => void,
    SetStrategy:(path: AllPath, key: KeysOfUnion<Exclude<FormFieldSchema, GroupField>>, strategy: DefaultStarategy) => void,
    notifyAll:()=>void
){
    

    const calculatePrice = (api: any) => {
        const baseObj: Record<string, number> = {
          standard: 100,
          high_security: 500,
          financial: 2000,
        };
        const specsObj: Record<string, number> = {
          general: 0,
          compute: 300,
          gpu: 1500,
          high_io: 800,
        };
        const diskPriceMap: Record<string, number> = {
          hdd: 0.2, // 普通机械硬盘
          ssd: 1.0, // 标准固态硬盘
          essd: 2.5, // 增强型 SSD (通常更贵)
        };
      
        const [ region,compliance,instanceFamily,capacity,diskType,encryption] = api.slot.triggerTargets;
        
        const BasePrice =
          baseObj[compliance];
        const SpecsPrice =
          specsObj[instanceFamily];
        
        const RegionFactor =
          region === "china" ? 1 : 1.5;
      
        const unitPrice =
          diskPriceMap[diskType];
        const encryptionFactor = encryption === "yes" ? 1.1 : 1.0;
        
        let StorageCost = capacity * unitPrice * encryptionFactor;
      
        let price = (BasePrice + SpecsPrice) * RegionFactor + StorageCost;
        console.log(capacity)
        return price;
      };
      
      SetRules(
        [
          "cloudConsole.environment.region",
          "cloudConsole.environment.compliance",
          "cloudConsole.specs.instanceFamily",
          "cloudConsole.specs.storage.capacity",
          "cloudConsole.specs.storage.diskType",
          "cloudConsole.security.encryption",
        ],
        "cloudConsole.billing.totalPrice",
        "value",
        {
          logic: (api) => {
            return new Promise((resolve,reject)=>{
              setTimeout(() => {
                resolve(calculatePrice(api))
              }, 1000);
            })
            // return  calculatePrice(api);
          },
        }
      );
      
      //  当 compliance 选择 Financial (金融级) 时，diskType 必须移除 HDD 选项，且 encryption 强制锁定为 YES。
      
      //当合规性等级等于金融级的时候修改硬盘类型为hdd
      SetRule(
        "cloudConsole.environment.compliance",
        "cloudConsole.specs.storage.diskType",
        "value", //副作用影响的键值对
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
      
            return value === "financial" ? "hdd" : undefined;
          },
        }
      );
      
      //当合规性等级等于金融及的时候修改硬盘类型选项，去除ssd类型硬盘
      SetRule(
        "cloudConsole.environment.compliance",
        "cloudConsole.specs.storage.diskType",
        "options",
      
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
            const targetValue = api.slot.affectedTatget;
      
            if (value === "financial") {
              const list = targetValue.slice();
      
              return list.filter((item: any) => item.value !== "ssd");
            }
            return undefined;
          },
          
        },
      );
      
      //当合规性等级为金融级的时候修改全盘加密为开启加密
      
      SetRule(
        "cloudConsole.environment.compliance",
        "cloudConsole.security.encryption",
        "value",
      
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
            if (value === "financial") {
              return "yes";
            }
            return undefined;
          },
        }
      );
      
      //当合规性等级为金融级的时候设置全盘加密为disabled，不允许用户修改
      SetRule(
        "cloudConsole.environment.compliance",
        "cloudConsole.security.encryption",
        "disabled",
      
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
            if (value === "financial") {
              return true;
            }
      
            return undefined;
          },
        }
      );
      
      // 当开启全盘加密的时候，显示密钥ID输入框，暂不开启的时候隐藏密钥ID输入框
      
      SetRule(
        "cloudConsole.security.encryption",
        "cloudConsole.security.kmsKey",
        "hidden",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
            if (value === "yes") {
              return false;
            } else {
              return true;
            }
          },
        }
      );
      // 当开启全盘加密的时候， 密钥ID输入框是required了
      SetRule(
        "cloudConsole.security.encryption",
        "cloudConsole.security.kmsKey",
        "required",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
      
            if (value === "yes") {
              return true;
            } else {
              return false;
            }
          },
        }
      );
      
      //价格超过2000显示，成本预警
      SetRule(
        "cloudConsole.billing.totalPrice",
        "cloudConsole.billing.priceDetail",
        "value",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
      
            if (value > 2000) {
              return "当前配置属于【高能耗规格】，建议联系客户经理获取大客户折扣。";
            }
      
            return undefined;
          },
        }
      );
      SetRule(
        "cloudConsole.billing.totalPrice",
        "cloudConsole.billing.priceDetail",
        "theme",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
      
            if (value > 2000) {
              return "warning";
            }
      
            return undefined;
          },
        }
      );
      
      //默认返回这个
      SetRule(
        "cloudConsole.billing.totalPrice",
        "cloudConsole.billing.priceDetail",
        "value",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
      
            if (value > 0) {
              return "计费周期：按量计费。当前配置已包含基础 DDOS 防护能力。";
            }
            return undefined;
          },
        }
      );
      
       

      // 强约束：当处于“中国区 + 标准合规”时，为了备案或资源调度策略，禁用 GPU 实例选项。
      
      SetRules(
        ["cloudConsole.environment.region", "cloudConsole.environment.compliance"],
        "cloudConsole.specs.instanceFamily",
        "options",
        {
          logic: (api) => {
            const [region, compliance] = api.slot.triggerTargets;
      
            if (region === "china" && compliance === "standard") {
              let affectedValue = api.slot.affectedTatget;
      
            
              let list = affectedValue.slice();
      
              return list.filter((item: any) => item.value !== "gpu");
            }
      
            return undefined;
          },
          effect:(args)=>{
            const {options,value} = args;
            let isLegal = options.some((item: any) => item.value == value);
            
            return isLegal?undefined:{
              value:undefined
            }
          },
          effectArgs:['options','value']
        }
      );
      
      //设置实例家族如果是计算型，系统盘容量最小值应该是100
      
      SetRule(
        "cloudConsole.specs.instanceFamily",
        "cloudConsole.specs.storage.capacity",
        "min",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
             
            if (value === "compute") {
              return 100;
            }
      
            return undefined;
          },
          effect:(vals)=>{
        
            const {min,value} = vals;
            const val = value<min?min:value;
            
            return {
              value:val,
            
            }
          },
          effectArgs:['min','value']
        }
      );

   
      
      // 设置影响自动扣费的disabled属性相关的字段
      SetRule(
        "cloudConsole.environment.compliance",
        "cloudConsole.billing.autoRenew",
        "disabled",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
            if (value === "financial") {
              return true;
            }
      
            return undefined;
          },
          value: true,
          effect:(args)=>{
            const {disabled} = args;
            if(disabled){
              return {
                value:false
              }
            }
          },
        }
      );
      
      SetRule(
        "cloudConsole.environment.region",
        "cloudConsole.billing.autoRenew",
        "disabled",
        {
          logic: (api) => {
            const [value] = api.slot.triggerTargets;
            if (value === "global") {
              return true;
            }
            return undefined;
          },
          value: true,
          effect:(args)=>{
            const {disabled} = args;
            if(disabled){
              return {
                value:false
              }
            }
          },
        }
      );
      
      SetStrategy("cloudConsole.billing.autoRenew", "disabled", DefaultStarategy.OR);
      
      //设置影响自动扣费的description属性相关的字段
      // 目前的问题是，descript受地区和合规性的影响，所以比如我修改合规性的时候，触发了description的桶计算，但是triggerPath应该是合规性，
      // 不应该会触发地区设置的rule的检测，目前这一块需要调整
      // SetRule(
      //   "cloudConsole.environment.compliance",
      //   "cloudConsole.billing.autoRenew",
      //   "description",
      //   {
      //     logic: (api) => {
      //       const [value] = api.slot.triggerTargets;
             
      //       if (value === "financial") return true;
      //       return undefined;
      //     },
      //     value: "金融级合规要求人工确认订单",
      //   }
      // );
      // 如果有订阅就不会走全量计算的路，只有对应的path下的value变更的时候才会触发logic计算
      SetRules(
        ["cloudConsole.environment.region","cloudConsole.environment.compliance"],
        "cloudConsole.billing.autoRenew",
        "description",
        {
          logic: async (api) => {
            const [region,compliance] = api.slot.triggerTargets;
            
            if(region=='global'&&compliance==='financial') return '跨境金融场景：需人工确认订单且不支持自动扣款'

            if (region === "global") return "海外机房暂不支持自动扣款";

            if(compliance==='financial') return "金融级合规要求人工确认订单"

            return undefined
            
          },
          // value: "海外机房暂不支持自动扣款",
        }
      );
      
      // SetStrategy(
      //   "cloudConsole.billing.autoRenew",
      //   "description",
      //   DefaultStarategy.OR
      // );
      // 设置完rule之后设置是否有环
  
      notifyAll();
}

 