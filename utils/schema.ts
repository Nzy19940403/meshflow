import { Ref, ref } from "vue";
import { DeepReadonly, DeepWriteable, FinalFlatten, KeysOfUnion } from "./util";

import { SchemaBucket, ValidatorsBucket } from "./bucket";
import { CreateRule } from "./schema-rule";
import {
  AllPath,
  FormDataModel,
} from "@/devSchemaConfig/dev.form.Schema.check";

import { HistoryActionItem } from "./hooks/useHistory";
import { symbol } from "zod";

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
  defaultValue: string | number;
};
export type CheckboxField = BaseField & {
  type: "checkbox";
  description?: string;
  required: boolean;
  defaultValue: boolean;
};
export type SelectField = BaseField & {
  type: "select";
  required: boolean;
  options: { label: string; value: any }[];
  defaultValue: any;
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
type RenderSchemaExtraCommonType = {
  path: AllPath;
  dirtySignal: any;
  uid: number;
  nodeBucket: Record<string, SchemaBucket>;
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

type Widen<T> = T extends string
  ? string
  : T extends number
  ? number
  : T extends boolean
  ? boolean
  : T;

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
    : T extends { readonly name: infer N; readonly defaultValue: infer V }
    ? N extends string
      ? { [K in N]: FinalFlatten<V> } // 💡 这里使用了 Widen，将字面量转为基础类型
      : never
    : {}
  : {};

/*----------------------------------------------------------------------------------------------------*/
/*----------------------------------------------------------------------------------------------------*/
/*----------------------------------------------------------------------------------------------------*/
export function useForm<T>(
  schema: FormFieldSchema,
  dependency:{
    GetDependencyOrder: () => AllPath[][],
    GetAllNextDependency: (path: AllPath) => AllPath[],
    GetNextDependency: (path: AllPath) => AllPath[],
    GetAllPrevDependency: (path: AllPath) => AllPath[]
  },
  // getDependencyOrder: () => AllPath[][],
  // GetNextDependency: (path: AllPath[]) => AllPath[],
  trace: {
    pushExecution: any;
    popExecution: any;
  },
  history: {
    pushIntoHistory: any;
    createHistoryAction: any;
  },
  UITrigger: {
    signalCreateor: () => T;
    signalTrigger: (signal: T) => void;
  }
) {
  //这个getDepenencyOrder是用来获取设置好rule之后的经过拓扑排序的path路径，入度从低到高，这样可以方便检测rule的设置是否有环，并且实现全量更新

  //schema内部维护的formdata，外部获取的时候调用getFormData方法
  const formData = initFormData(schema as FormFieldSchema) as FormDataModel;

  let uid: number = 0;
  const PathToUid = new Map<string, number>();
  const UidToSchemaMap = new Map<number, RenderSchema>();
  const GroupsMap = new Map<string, RenderSchema>();

  let isPending = false;
  const flushPathSet = new Set<string>();

  const currentExecutionToken:Map<string,symbol> = new Map();

  const GetRenderSchemaByPath = (path: string) => {
    const uid = PathToUid.get(path) as number;
    const targetSchema = UidToSchemaMap.get(uid) as RenderSchemaFn<
      Exclude<FormFieldSchema, GroupField>
    >;

    return targetSchema;
  };
  const GetGroupByPath = (path: string) => {
    let groupData = GroupsMap.get(path);
    return groupData;
  };

  const flushUpdate = async () => {
    console.log("批处理开始刷新");

    const paths = Array.from(flushPathSet);

    // 2. 立即清空，让 Set 变回初始状态，准备迎接下一轮（或者逻辑中意外触发的）通知
    flushPathSet.clear();

    for (let path of paths) {
      let target = GetRenderSchemaByPath(path) as RenderSchemaFn<
        Exclude<FormFieldSchema, GroupField>
      >;
      // target.dirtySignal.value++;
      UITrigger.signalTrigger(target.dirtySignal);
    }
  };

  const requestUpdate = () => {
    if (isPending) return;
    isPending = true;
    Promise.resolve().then(() => {
      try {
        while (flushPathSet.size > 0) {
          flushUpdate();
        }
      } finally {
        isPending = false;
      }
    });
  };

  const updateFormData = () => {
    const helper = (data: any, parentNode: any, list: any[]) => {
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        // 到达叶子节点，记录路径
        if (list.length > 0) {
          const lastkey = list[list.length - 1];
          parentNode[lastkey] = GetRenderSchemaByPath(
            list.join(".")
          ).defaultValue;
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

  const notifyChild = async (targetPath: AllPath, triggerPath: AllPath) => {
    const targetSchema = GetRenderSchemaByPath(targetPath) as any;

    let hasValueChanged = false;

    try {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 0);
      });

      for (let bucketName in targetSchema.nodeBucket) {
        const bucket = targetSchema.nodeBucket[bucketName] as SchemaBucket;

        const result = await bucket.evaluate({
          affectKey: bucketName, //正在更新的桶名称
          triggerPath,
          GetRenderSchemaByPath,
          GetValueByPath: (p: string) => GetRenderSchemaByPath(p).defaultValue,
        });
        // @ts-ignore
        // if(triggerPath=='cloudConsole.billing.autoRenew0'){
        //     debugger
        //   }

        if (bucketName === "options") {
          let isLegal = false;
          let val = targetSchema.defaultValue;
          for (let item of result) {
            if (item.value == val) {
              isLegal = true;
            }
          }

          if (!isLegal) {
            targetSchema["defaultValue"] = undefined;
            hasValueChanged = true;
          }
        }

        // 更新数据
        if (result !== targetSchema[bucketName]) {
          targetSchema[bucketName] = result;

          hasValueChanged = true;
        }
      }
    } catch (err) {
      console.log(err);
    } finally {
      trace.popExecution([targetPath]);
    }

    // 【核心递归】如果我变了，我作为“新触发者”去通知我的儿子
    if (hasValueChanged) {
      flushPathSet.add(targetPath);
      requestUpdate();
    }

    // trace.pushExecution(nextOrder);

    //必须全量更新，因为不能判断此path不受影响，下游的path也会不受影响
    const nextOrder = dependency.GetNextDependency(targetPath);
    trace.pushExecution(nextOrder);
    for (let grandchildPath of nextOrder) {
      notifyChild(grandchildPath, targetPath);
    }
  };

  const notifyAll = async () => {
    const paths = dependency.GetDependencyOrder().flat();

    try {
      for (let path of paths) {
        let schema = GetRenderSchemaByPath(path);

        for (let bucketName in schema.nodeBucket) {
          let result = await schema.nodeBucket[bucketName].evaluate({
            affectKey: bucketName,
            triggerPath: undefined,
            GetRenderSchemaByPath,
            GetValueByPath: (p: string) =>
              GetRenderSchemaByPath(p).defaultValue,
          });

          if (bucketName === "options") {
            let isLegal = false;
            let val = schema.defaultValue;
            for (let item of result) {
              if (item.value == val) {
                isLegal = true;
              }
            }

            if (!isLegal) {
              schema["defaultValue"] = undefined;
              requestUpdate();
            }
          }

          if (result !== schema[bucketName as keyof typeof schema]) {
            (schema as any)[bucketName] = result;

            flushPathSet.add(path);

            requestUpdate();
          }
        }
      }
    } catch (err) {
      console.log(err);
    } finally {
      // trace.popExecution([currentPath])
    }
  };

  //单个字段变化之后触发此函数，然后触发notifyChild来递归的渲染后续字段
  const notify = async (path: AllPath) => {
    if (!path) {
      throw Error("没有路径");
    }

    let inDegree = GetRenderSchemaByPath(path);

    if (!inDegree) {
      throw Error("路径错误，没有对应的节点");
    }

    //更新的路径
    flushPathSet.add(path);

    requestUpdate();

    let nextOrder = dependency.GetNextDependency(path);

    // trace.pushExecution([...nextOrder, path], true);

    runNotifyTask(nextOrder, path);

    // for (let childPath of nextOrder) {
    //   notifyChild(childPath, path);
    // }

    trace.popExecution([path], true);
  };

  async function runNotifyTask(initialNodes: AllPath[], triggerPath: AllPath) {
    const curToken = Symbol("token");
    currentExecutionToken.set(triggerPath,curToken)
 


    const processed = new Set<AllPath>();
    const processingSet = new Set<AllPath>();
    const AllAffectedPaths = new Set<AllPath>(dependency.GetAllNextDependency(triggerPath));

    //账本，记录一下在queue排队等待的path,优化一下查询速度
    const queueCountMap = new Map<AllPath, number>();

    const stagingArea = new Map<AllPath,number>();

    let lastYieldTime = performance.now();
 
    const queue: Array<{ target: AllPath; trigger: AllPath }> = Array.from(AllAffectedPaths).map((p) => {
      queueCountMap.set(p, (queueCountMap.get(p) || 0) + 1); // 记账
      return {
        target: p,
        trigger: triggerPath,
      }
    });
    trace.pushExecution([...Array.from(AllAffectedPaths),triggerPath],true);
   
    // 打印任务启动
    console.log(`%c 🚀 任务启动 | Trigger: ${triggerPath} | Token: ${curToken.description}`, "color: #67c23a; font-weight: bold;");
    while (queue.length) {
      if (currentExecutionToken.get(triggerPath) !== curToken) return;

      if(queue.length===0){
        await new Promise(r => requestAnimationFrame(r));
        continue;
      }
      const task = queue.shift()!;
      const { target: targetPath, trigger: currentTriggerPath } = task;
      const currentCount = queueCountMap.get(targetPath) || 0;
      if (currentCount <= 1) {
        queueCountMap.delete(targetPath);
      }else{
        queueCountMap.set(targetPath, currentCount - 1);
      }
      
      const parents = dependency.GetAllPrevDependency(targetPath);
      // 打印当前出队节点
      console.log(`%c 📦 出队检查: ${targetPath} (来自: ${currentTriggerPath})`, "color: #409eff;");

      
      const isAnyParentNotReady = parents.some(p => {
        // 如果父节点已处理，Ready
        if (processed.has(p)) return false;

        const isPending = queueCountMap.has(p) || processingSet.has(p);
        if (isPending) return true;

        if (AllAffectedPaths.has(p)) return true;

        return false;
      });
  
        if (isAnyParentNotReady) {
          queue.push(task);
          queueCountMap.set(targetPath, (queueCountMap.get(targetPath) || 0) + 1);
          console.log(
            `%c ⏳ [拓扑挂起] ${targetPath} 还不能执行。`, 
            "color: #e6a23c; background: #fffbe6;"
          );
          // 这里的切片是为了给那些正在 processing 的父节点腾出 Promise resolve 的机会
          await new Promise(r => setTimeout(r, 0)); 
          continue;
        }
 
          if (processed.has(targetPath)) {
          console.log(`%c ⏭️ 跳过已处理: ${targetPath}`, "color: #909399; font-style: italic;");
          // 因为这个节点在被 push 进队列时，trace 已经认为它要执行了
          // 如果跳过它，必须在这里手动把它 pop 掉，否则计数永远不会归零
          trace.popExecution([targetPath]);
          continue;
        }

      
      processingSet.add(targetPath);
      const targetSchema = GetRenderSchemaByPath(targetPath) as any;

      let hasValueChanged = false;
      let notifyNext = false;
      try {
     
        console.log(`%c ✅ 计算完成: ${targetPath}`, "color: #67c23a;");
       
        for (let bucketName in targetSchema.nodeBucket) {
          const bucket = targetSchema.nodeBucket[bucketName] as SchemaBucket;

          // 桶内部会根据自己的 version 进行判断是否真正执行
          const result = await bucket.evaluate({
            affectKey: bucketName,
            triggerPath: currentTriggerPath,
            GetRenderSchemaByPath,
            GetValueByPath: (p: string) =>
              GetRenderSchemaByPath(p).defaultValue,
          });
          processed.add(targetPath);
          processingSet.delete(targetPath);
          // Options 合法性检查
          if (bucketName === "options") {
            const isLegal = result.some(
              (item: any) => item.value == targetSchema.defaultValue
            );
            if (!isLegal) {
              targetSchema["defaultValue"] = undefined;
              hasValueChanged = true;
            }
          }

          // 数据更新检查
          if (result !== targetSchema[bucketName]) {
            targetSchema[bucketName] = result;
            hasValueChanged = true;
          }

          if(bucket.isForceNotify()){
            notifyNext = true;
          }

        }
        // --- 原 notifyChild 核心逻辑结束 ---
      } catch (err) {
        console.error(`计算路径 ${targetPath} 时出错:`, err);
      } finally {
        trace.popExecution([targetPath]);
      }
      
 
      // 如果值变了，标记需要刷新 UI
      if (hasValueChanged) {
        flushPathSet.add(targetPath);
      }
      //这里看value有没有被change，如果没有被change又没有强制notify就步把nextorder推入依赖

      if(hasValueChanged||notifyNext){
        const nextOrder = dependency.GetNextDependency(targetPath);
        const allNextOrder = dependency.GetAllNextDependency(targetPath);

        allNextOrder.forEach((path)=>{
          AllAffectedPaths.add(path); // 扩充总疆域
        })

        // 将下一层推入队列
        if (nextOrder.length > 0) {
          // const filteredNextOrder = nextOrder.filter(path=>!processed.has(path));
          // 只有确定有下游要处理时，才 push 追踪
          // trace.pushExecution(nextOrder);
        
      
          for (let nextPath of nextOrder) {
            if (!processed.has(nextPath) && !queueCountMap.has(nextPath)) {
              queue.push({ target: nextPath, trigger: targetPath });
              
              // 更新账本和追踪
              queueCountMap.set(nextPath, (queueCountMap.get(nextPath) || 0) + 1);
              trace.pushExecution([nextPath]);
            }
             
          }
        }
      }

      

      // --- 核心优化：时间片切片 ---
      // 每 16ms 让出主线程，防止阻塞渲染
      if (performance.now() - lastYieldTime > 16) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        lastYieldTime = performance.now();
        // 切片回来后再检查一次 token，防止在渲染期间有新任务抢占
        if (currentExecutionToken.get(triggerPath) !== curToken) return;
      }
      if (currentExecutionToken.get(triggerPath) === curToken) {
        requestUpdate();
      }
    }
  }
/*============================================================================================================*/ 
  const updateInputValueRuleManually = (path: string) => {
    if (!path) {
      throw Error("没有路径");
    }

    let TargetSchema = GetRenderSchemaByPath(path) as RenderSchemaFn<
      Exclude<FormFieldSchema, GroupField>
    >;

    //如果目标的defaultValue并没有被其他选项影响，那就不会创建input——value的默认rule
    if (TargetSchema.nodeBucket.defaultValue) {
      //更新__input-value__规则

      TargetSchema.nodeBucket.defaultValue.updateInputValueRule(
        TargetSchema.defaultValue
      );
    }
  };

  const convertToRenderSchema = <T extends FormFieldSchema>(
    data: T,
    path: string = ""
  ): RenderSchema => {
    const name = "name" in data ? (data as any).name : undefined;
    const currentPath = name ? (path === "" ? name : `${path}.${name}`) : path;
    // const dirtySignal = ref(0);
    const dirtySignal = UITrigger.signalCreateor();

    let _uid: number = uid++;

    //传入dependOn回调的参数
    let dependOnContext = {
      getRenderSchema: (path: string) => {
        return GetRenderSchemaByPath(path);
      },
    };

    let dependOnFn = async (cb: (data: any) => any, field: any) => {
      const newVal = cb(field);

      //首先更新最新的数据
      const schema = GetRenderSchemaByPath(field.path);
      //历史操作
      const item = history.createHistoryAction(
        [
          {
            path: field.path,
            value: schema.defaultValue,
          },
          {
            path: field.path,
            value: newVal,
          },
        ],
        async (metadata: { path: string; value: any }) => {
          let data = GetRenderSchemaByPath(metadata.path);
          data.defaultValue = metadata.value;
          updateInputValueRuleManually(metadata.path);
          await notify(metadata.path as AllPath);
        }
      );

      schema.defaultValue = newVal;

      //这边要把新的动作和旧的动作一起存入history
      history.pushIntoHistory(item);

      updateInputValueRuleManually(field.path);

      await notify(field.path);
    };
    // 这里的返回值断言为你写好的类型体操结果
    const newNode = {
      ...data,
      disabled: !!data.disabled,
      hidden: "hidden" in data ? data.hidden : false,
      readonly:'readonly' in data?data.readonly:false,
      required:'required' in data?data.required:false,
      path: currentPath,
      dirtySignal,
      uid: _uid,
      nodeBucket: {},
      // affectedArray: new Set(),
      validators: new ValidatorsBucket(currentPath), // 用来存放验证函数
      theme: "secondary",
      dependOn: async (cb) => {
        return await dependOnFn(cb, {
          ...dependOnContext,
          path: currentPath,
        });
      },
    } as RenderSchema;

    if (data.type === "group") {
      delete (newNode as any).nodeBucket;
      delete (newNode as any).validators;

      // 递归处理子节点
      (newNode as any).children = data.children.map((child) =>
        convertToRenderSchema(child, currentPath)
      );

      GroupsMap.set(newNode.path, newNode);
    }

    //用户只需要使用path去注入actions
    PathToUid.set(newNode.path, newNode.uid);
    UidToSchemaMap.set(newNode.uid, newNode as RenderSchema);

    return newNode;
  };

  const schemaData = convertToRenderSchema(schema);

  const GetFormData = () => {
    return updateFormData();
  };

  return {
    schema: schemaData,
    GetFormData,
    GetRenderSchemaByPath,
    GetGroupByPath,
    notifyAll,
    convertToRenderSchema,
  };
}
//把schema转换成formdata
export function initFormData<T>(data: T, res: any = {}): FormResultType<T> {
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
        val: data.defaultValue,
      };
    }

    throw Error("未定义的类型:" + `${data.type}`);
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
