import { SchemaBucket } from "../core/engine/bucket";
import { useScheduler } from "../core/engine/useScheduler";
import { MeshPath } from "../core/types/types";
import { FinalFlatten } from "../core/utils/util";


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

    value: string | number
};
export type CheckboxField = BaseField & {
    type: "checkbox";
    description?: string;
    required: boolean;

    value: boolean
};
export type SelectField = BaseField & {
    type: "select";
    required: boolean;
    options: { label: string; value: any }[];

    value: any
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

/*----------------------------------------------------------------------------------------------------*/
/*----------------------------------------------------------------------------------------------------*/
/*----------------------------------------------------------------------------------------------------*/


export function useInternalForm<T, P extends MeshPath>(
    scheduler: ReturnType<typeof useScheduler<T, P>>,
    rootSchema: any
) {
    const formData = initFormData(rootSchema as FormFieldSchema) as any;

    // 🌟 核心转换函数：Raw JSON -> RenderSchema (同时注册进 Scheduler)
    const convertAndRegister = (
        data: FormFieldSchema,
        parentPath: string = ""
    ): RenderSchema => { // 返回值类型是你原本定义的 RenderSchema

        // 1. 计算路径
        const name = "name" in data ? (data as any).name : undefined;
        const currentPath = name
            ? (parentPath === "" ? name : `${parentPath}.${name}`)
            : parentPath;

        // 2. 创建 UI 信号 (Dirty Signal)
        const dirtySignal = scheduler.UITrigger.signalCreator();

        // === 分支 A: 处理 Group ===
        if (data.type === "group") {
            const groupData = data as GroupField;

            // 递归转换子节点 (这里生成了 RenderSchema 的子树)
            const renderedChildren = groupData.children.map(child =>
                convertAndRegister(child, currentPath)
            );

            // 构造 Group 的 RenderSchema 对象
            // 注意：这里我们构造的对象，既给 UI 用，也部分信息给 Scheduler 用
            const groupNode: any = {
                ...groupData,
                type: 'group',
                path: currentPath,
                dirtySignal,
                uid: 0, // 占位，注册后会更新
                children: renderedChildren // 🌟 UI 需要这个树状结构
            };

            // 向 Scheduler 注册
            // Scheduler 会分配 UID，并把这个 Group 存入内部 Map
            const registeredGroup = scheduler.registerGroupNode({
                path: currentPath as P,
                type: 'group',
                uid: 0,
                // Scheduler 只需要知道子节点的路径索引，不需要整个对象树
                children: renderedChildren.map(c => c.path),
                meta: groupData as any
            });

            // 回填 UID 到 UI 对象
            groupNode.uid = registeredGroup.uid;

            return groupNode as RenderSchema;
        }

        // === 分支 B: 处理 Task (Input, Select...) ===

        // 1. 准备 Buckets
        const buckets: Record<string, any> = {};


        // 2. 准备 State (这是数据源头)
        const state = {
            value: data.value
        };

        // 3. 向 Scheduler 注册
        // 注意：scheduler.registerNode 返回的是引擎内部的 Node 对象
        // 这个对象里包含了 dependOn, notifyKeys 等逻辑
        const registeredNode = scheduler.registerNode({
            path: currentPath as P,
            type: data.type,
            uid: 0,
            state: state, // 引用传递
            meta: data,
            buckets: buckets,
            notifyKeys: new Set(['value']),
            dirtySignal,
            dependOn: null as any // Scheduler 会填充
        });

        // 4. 构造 UI 用的 RenderSchema
        // 这里我们要把 Scheduler 返回的强大能力 (registeredNode) 
        // 和原始 UI 属性 (data) 结合起来
        const uiNode: any = {
            ...data, // label, placeholder 等
            path: currentPath,
            type: data.type,
            uid: registeredNode.uid, // 使用 Scheduler 分配的 ID
            dirtySignal, // UI 监听这个

            // 🌟 关键：RenderSchema 的 value 必须是指向 Scheduler state 的引用
            // 或者通过 getter/setter 代理。
            // 既然你的 RenderSchema 定义里有 value，我们这里直接透传引用
            // (注意：这里取决于你是否希望 UI 直接改 state，还是必须走 dependOn)

            // 为了兼容旧代码，我们让 uiNode.value 实际上是 state.value 的快照
            // 但因为这是对象引用，所以其实是一致的
            get value() { return registeredNode.state.value },
            set value(v) { registeredNode.state.value = v }, // ⚠️ UI 直接赋值不会触发 notify，必须走 dependOn

            // 注入 buckets 以便 UI 或插件访问
            nodeBucket: registeredNode.buckets,

            // 🌟 把 Scheduler 注入的 dependOn 暴露给 UI (如果有需要)
            dependOn: registeredNode.dependOn,

            // 绑定 meta
            meta: registeredNode.meta
        };

        return uiNode as RenderSchema;
    };

    function initFormData<T>(data: T, res: any = {}): FormResultType<T> {
        const handler: (data: any) => Record<"key" | "val" | "isGroup", any> = (
          data: RenderSchema
        ) => {
          if (data.type == "group") {
            return {
              key: data.name || "",
              isGroup: true,
      
              val: data.children.reduce((prev: Array<any>, cur: RenderSchema) => {
                return [...prev, handler(cur)];
              }, []),
            };
          }
      
          if (
            data.type == "input" ||
            data.type == "number" ||
            data.type == "select" ||
            data.type == "checkbox"
          ) {
            return {
              key: data.name,
              isGroup: false,
              val: data.value,
            };
          }
      
          throw Error("undefined type:" + `${data.type}`);
        };
      
        const merge = (target: any, obj: Record<"key" | "val" | "isGroup", any>) => {
          if (obj.isGroup) {
            let curTarget = {};
      
            if (obj.key === "") {
              curTarget = target;
            } else {
              target[obj.key] = curTarget;
            }
      
            obj.val.forEach((child: any) => {
              merge(curTarget, child);
            });
          } else {
            target[obj.key] = obj.val;
          }
        };
      
        let obj = handler(data);
      
        merge(res, obj);
      
        return res;
    }

    const updateFormData = () => {
        const helper = (data: any, parentNode: any, list: any[]) => {
          if (typeof data !== "object" || data === null || Array.isArray(data)) {
            // 到达叶子节点，记录路径
            if (list.length > 0) {
              const lastkey = list[list.length - 1];
              parentNode[lastkey] = scheduler.GetNodeByPath(
                list.join(".") as any
              ).state.value;
            }
            return;
          }
    
          const keys = Object.getOwnPropertyNames(data);
    
          for (let key of keys) {
            list.push(key);
            helper(data[key], data, list);
            list.pop();
          }
        };
    
        helper(formData, null, []);
    
        return formData;
    };

    const GetFormData = () => {
        return updateFormData();
    };

    const uiSchema = convertAndRegister(rootSchema);
    
    return {
        uiSchema,
        GetFormData
    }
}