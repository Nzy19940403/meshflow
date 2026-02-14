import { DependOnContext, MeshEmit, MeshFlowGroupNode, MeshFlowTaskNode, MeshPath } from "./useEngineManager";
import { useMeshTask } from "./useMeshTask";



export function useScheduler<
    T, //ui trigger中定义的类型
    P extends MeshPath, // 路径类型
    S = any  //业务叶子节点元数据类型
>(
    schema: S,
    config: {
        useGreedy: boolean
    },
    dependency: {
        GetDependencyOrder: () => P[][];
        GetAllNextDependency: (path: P) => P[];
        GetNextDependency: (path: P) => P[];
        GetPrevDependency: (path: P) => P[];
        GetAllPrevDependency: (path: P) => P[];
        GetPathToLevelMap: () => Map<P, number>;
    },
    history: Partial<{
        pushIntoHistory: any;
        createHistoryAction: any;
    }>,
    hooks: {
        callOnError: any;
        callOnSuccess: any;
        callOnStart: any;
        emit: MeshEmit;
    },
    UITrigger: {
        signalCreator: () => T;
        signalTrigger: (signal: T) => void;
    }

) {

    let uid: number = 0;
    const PathToUidMap = new Map<MeshPath, number>();
    const UidToNodeMap = new Map<number, MeshFlowTaskNode<P,S>>();
    const UidToGroupMap = new Map<number, MeshFlowGroupNode>();

    let isPending = false;
    const flushPathSet = new Set<P>();

    // 标记：是否正在初始化
    let isInitializing = false;
    let forbidUserNotify = true;

    // 锁：初始化的 Promise，外部如果想 await 可以用这个
    let initializationPromise: Promise<void> | null = null;

    const flushUpdate = async () => {
        console.log("ui update");

        const paths = Array.from(flushPathSet);

        // 2. 立即清空，让 Set 变回初始状态，准备迎接下一轮（或者逻辑中意外触发的）通知
        flushPathSet.clear();

        for (let path of paths) {
            let target = GetNodeByPath(path)  ;

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

    const taskrunner = useMeshTask<P>(
        {
            useGreedy: config.useGreedy
        },
        dependency,
        {
            GetNodeByPath,
        },
        hooks,
        {
            requestUpdate,
            flushPathSet,
        }
    );

    const createNodeDependOnFn = (node:MeshFlowTaskNode<P,S>)=>{
        const dependOnContext: DependOnContext<P> = {
            path: node.path,
            getNode: (p: P) => GetNodeByPath(p),
        };

        let dependOnFn =  (cb: (data: any) => any, field: any) => {
            const newVal = cb(field);
      
            //首先更新最新的数据
            const schema = GetNodeByPath(field.path);
            //历史操作
            const item = history.createHistoryAction(
              [
                {
                  path: field.path,
                  value: schema.state.value,
                },
                {
                  path: field.path,
                  value: newVal,
                },
              ],
               (metadata: { path: P; value: any }) => {
                let data = GetNodeByPath(metadata.path);
                data.state.value = metadata.value;
             
                notify(metadata.path);
              }
            );
      
            schema.state.value = newVal;
      
            //这边要把新的动作和旧的动作一起存入history
            history.pushIntoHistory(item);
      
            // updateInputValueRuleManually(field.path);
      
            notify(field.path);
        };
        node.dependOn = (cb) => {
            return  dependOnFn(cb, {
              ...dependOnContext,
            });
        }
    }
    
    const registerNode = (nodeMeta: MeshFlowTaskNode<P,S>) => {
        if (PathToUidMap.has(nodeMeta.path)) {
            throw new Error(`[MeshFlow] Duplicate Path: ${String(nodeMeta.path)}`);
        }

        const currentId = ++uid;

        const node: MeshFlowTaskNode<P,S> = {
            ...nodeMeta,
            uid: currentId
        };

        createNodeDependOnFn(node);

        PathToUidMap.set(node.path, currentId);
        UidToNodeMap.set(currentId, node);

        return node;
    }

    const registerGroupNode = (groupMeta: MeshFlowGroupNode<P>) => {
        if (PathToUidMap.has(groupMeta.path)) {
            throw new Error(`[MeshFlow] Duplicate Path: ${String(groupMeta.path)}`);
        }

        const currentId = ++uid;

        const group: MeshFlowGroupNode<P> = {
            ...groupMeta,
            uid: currentId
        };

        PathToUidMap.set(group.path, currentId);
        UidToGroupMap.set(currentId, group);

        return group;
    };


    function GetNodeByPath(path: P): MeshFlowTaskNode<P,S> {
        const uid = PathToUidMap.get(path) as number;
        const targetSchema = UidToNodeMap.get(uid);
        if(!targetSchema){
            throw Error('wrong ID')
        }

        return targetSchema;
    };

    function GetGroupByPath(path: MeshPath) {
        const uid = PathToUidMap.get(path)!
        let groupData = UidToGroupMap.get(uid);
        return groupData;
    };

    const notify = (path: P) => {
        //notifyAll完成之前不允许操作
        if (forbidUserNotify) {
            return
        }


        let inDegree = GetNodeByPath(path);

        if (!inDegree) {
            throw Error("Node undefined");
        }

        //更新的路径
        flushPathSet.add(path);

        requestUpdate();

        let nextOrder = dependency.GetNextDependency(path);

        runNotifyTask(nextOrder, path);
    };

    function runNotifyTask(initialNodes: P[], triggerPath: P) {
        taskrunner(triggerPath, initialNodes);
    };

    return {
        registerNode,
        registerGroupNode,
        GetNodeByPath,
        GetGroupByPath,
        notify,
        UITrigger
    }

}