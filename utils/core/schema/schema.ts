import { FinalFlatten } from "../utils/util";

import { SchemaBucket, ValidatorsBucket } from "../engine/bucket";

import { MeshEmit } from "../plugins/usePlugin";

import { HistoryActionItem } from "../plugins/useHistory";

import { useMeshTask } from "../engine/useMeshTask";

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
export function useForm<T, P extends string>(
  schema: FormFieldSchema,
  config:{
    useGreedy:boolean
  },
  dependency: {
    GetDependencyOrder: () => P[][];
    GetAllNextDependency: (path: P) => P[];
    GetNextDependency: (path: P) => P[];
    GetPrevDependency: (path: P) => P[];
    GetAllPrevDependency: (path: P) => P[];
    GetPathToLevelMap: () => Map<P, number>;
  },

  history: {
    pushIntoHistory: any;
    createHistoryAction: any;
  },
  hooks: {
    callOnError: any;
    callOnSuccess: any;
    callOnStart: any;
    emit: MeshEmit;
  },
  UITrigger: {
    signalCreateor: () => T;
    signalTrigger: (signal: T) => void;
  }
) {
  //这个getDepenencyOrder是用来获取设置好rule之后的经过拓扑排序的path路径，入度从低到高，这样可以方便检测rule的设置是否有环，并且实现全量更新

  //schema内部维护的formdata，外部获取的时候调用getFormData方法
  const formData = initFormData(schema as FormFieldSchema) as any;

  let uid: number = 0;
  const PathToUid = new Map<P, number>();
  const UidToSchemaMap = new Map<number, RenderSchema>();
  const GroupsMap = new Map<string, RenderSchema>();

  let isPending = false;
  const flushPathSet = new Set<P>();

  // 标记：是否正在初始化
  let isInitializing = false;
  let forbidUserNotify = true;

  // 锁：初始化的 Promise，外部如果想 await 可以用这个
  let initializationPromise: Promise<void> | null = null;

  // const currentExecutionToken: Map<string, symbol> = new Map();

  const GetRenderSchemaByPath = (path: P) => {
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
    requestAnimationFrame(() => {
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
            list.join(".") as any
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

  const taskrunner = useMeshTask<P>(
    {
      useGreedy:config.useGreedy
    },
    dependency,
    {
      GetRenderSchemaByPath,
    },
    hooks,
    //UITrigger
    {
      requestUpdate,
      flushPathSet,
    }
  );

  const notifyAll = async () => {
    // 1. 防重入
    if (isInitializing && initializationPromise) {
      return initializationPromise;
    }

    isInitializing = true;

    initializationPromise = (async () => {
      // 获取分层依赖 [[Level0], [Level1]...]，利用并发
      const levels = dependency.GetDependencyOrder();
      const startTime = performance.now();
      let lastYieldTime = performance.now();

      try {
        // --- 分层遍历 ---
        for (let i = 0; i < levels.length; i++) {
          const currentLevelNodes = levels[i];

          // ⚡️ 并发：同一层的节点同时计算
          await Promise.all(
            currentLevelNodes.map(async (path) => {
              let schema = GetRenderSchemaByPath(path);
              let nodeHasChanged = false;

              // 遍历桶
              for (let bucketName in schema.nodeBucket) {
                let result = await schema.nodeBucket[bucketName].evaluate({
                  affectKey: bucketName,
                  triggerPath: undefined,
                  GetRenderSchemaByPath,
                  GetValueByPath: (p: P) =>
                    GetRenderSchemaByPath(p).defaultValue,
                  // 初始化通常拥有最高权限，建议这里设为 true，或者保持你原来的逻辑
                  isSameToken: () => true,
                });

                // Options 校验逻辑 (原样保留)
                if (bucketName === "options") {
                  let isLegal = false;
                  let val = schema.defaultValue;
                  // 你的原始逻辑
                  for (let item of result) {
                    if (item.value == val) {
                      isLegal = true;
                      break;
                    }
                  }
                  if (!isLegal) {
                    schema["defaultValue"] = undefined;
                    nodeHasChanged = true; // 标记变更
                  }
                }

                // 赋值
                if (result !== schema[bucketName as keyof typeof schema]) {
                  (schema as any)[bucketName] = result;
                  nodeHasChanged = true; // 标记变更
                  
                }
              }

              // 如果有变动，加入待更新集合
              if (nodeHasChanged) {
                flushPathSet.add(path);
              }
            })
          );

          // --- ⏳ 时间切片 ---
          // 每算完一层，如果耗时超过 12ms，让出主线程，防止页面卡死
          if (performance.now() - lastYieldTime > 12) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            lastYieldTime = performance.now();
          }
        }

        // --- 统一提交 UI ---
        // 跑完(或分片间隙)再触发 UI 更新，比在循环里每次都调要快得多
        if (flushPathSet.size > 0) {
          requestUpdate();
        }

        // 等待 Vue/React 渲染一帧，确保状态同步
        // if (typeof nextTick !== "undefined") await nextTick();
        forbidUserNotify = false
        const endTime = performance.now();
        hooks.emit("flow:success", {
          duration: (endTime - startTime).toFixed(2) + "ms",
        });
        hooks.callOnSuccess();
        
      } catch (err: any) {
        hooks.emit("node:error", {
          path: err.path,
          error: err.error,
        });
        hooks.callOnError(err);
        throw err;
      } finally {
        // 🎉 解锁
        isInitializing = false;
        initializationPromise = null;
        forbidUserNotify = false;
      }
    })();

    return initializationPromise;
  };

  //单个字段变化之后触发此函数，然后触发notifyChild来递归的渲染后续字段
  const notify = async (path: P) => {
    //notifyAll完成之前不允许操作
    if(forbidUserNotify){
      return
    }
    // if (!path) {
    //   throw Error("没有路径");
    // }

    let inDegree = GetRenderSchemaByPath(path);

    if (!inDegree) {
      throw Error("路径错误，没有对应的节点");
    }

    //更新的路径
    flushPathSet.add(path);

    requestUpdate();

    let nextOrder = dependency.GetNextDependency(path);

    runNotifyTask(nextOrder, path);
  };

  async function runNotifyTask(initialNodes: P[], triggerPath: P) {
    taskrunner(triggerPath, initialNodes);
  }

  const updateInputValueRuleManually = (path: P) => {
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
      getRenderSchema: (path: P) => {
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
        async (metadata: { path: P; value: any }) => {
          let data = GetRenderSchemaByPath(metadata.path);
          data.defaultValue = metadata.value;
          updateInputValueRuleManually(metadata.path);
          await notify(metadata.path);
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
      readonly: "readonly" in data ? data.readonly : false,
      required: "required" in data ? data.required : false,
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
    PathToUid.set(newNode.path as P, newNode.uid);
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
