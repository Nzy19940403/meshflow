import { DependOnContext, MeshEmit, MeshFlowGroupNode, MeshFlowTaskNode, MeshPath, StandardUITrigger } from "../types/types";
import { useMeshTask } from "./useMeshTask";
import { createMeshNode } from './useMeshNode';
import { KeysOfUnion, createScheduler } from "../utils/util";
import { UseSetEntangle } from "../dependency/useSetEntangle";

export function useScheduler<
    T, //ui trigger中定义的类型
    P extends MeshPath, // 路径类型
    B extends Record<string, any> = StandardUITrigger<T>,
    NM = any  //业务叶子节点元数据类型
>(
 
    config: {
        useGreedy: boolean,
        useEntangleStep:number
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
    UITrigger:  B , 
) {

    const timeScheduler = createScheduler();

    let uid: number = 0;
    const PathToUidMap = new Map<MeshPath, number>();
    // const UidToNodeMap = new Map<number, MeshFlowTaskNode<P, any, NM>>();
    // const UidToGroupMap = new Map<number, MeshFlowGroupNode>();

    const UidToNodeMap: MeshFlowTaskNode<P, any, NM>[] = [];
    const UidToGroupMap: MeshFlowGroupNode[] = [];


    let isPending = false;
    const flushPathSet = new Set<P>();
 
    let isInitializing = false;

    // let forbidUserNotify = true;

    // 锁：初始化的 Promise，外部如果想 await 可以用这个
    // let initializationPromise: Promise<void> | null = null;

    const flushUpdate = async () => {
        // console.log("ui update");

        const paths = Array.from(flushPathSet);

        // 2. 立即清空，让 Set 变回初始状态，准备迎接下一轮（或者逻辑中意外触发的）通知
        flushPathSet.clear();
 
        if ('signalTrigger' in UITrigger && typeof UITrigger.signalTrigger === 'function') {
            // --- 走原来的 Vue/React 触发逻辑 ---
            for (let path of paths) {
                let target = GetNodeByPath(path);
    
                UITrigger.signalTrigger(target.dirtySignal);
            }
        }else if('emit' in UITrigger){
            UITrigger.emit(paths);
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

    const { useEntangle,updateEntangleLevel, Turnstile } = UseSetEntangle<P, NM>(
        {
            useEntangleStep:config.useEntangleStep
        },
        timeScheduler,
        dependency.GetPathToLevelMap,
        GetNodeByPath,
        {
            emit: hooks.emit,
            onError: hooks.callOnError
        }
        
    );

    const taskrunner = useMeshTask<P,NM>(
        {
            useGreedy: config.useGreedy
        },
        dependency,
        {
            GetNodeByPath,
            Turnstile 
        },
        hooks,
        {
            requestUpdate,
            flushPathSet,
        },
        timeScheduler
    );
 
    const DuplicatePathError = (path:string)=>{
        throw new Error(`[MeshFlow] Duplicate Path: ${path}`)
    }

    const registerNode = (nodeMeta: Omit<MeshFlowTaskNode<P>, 'createView'|'proxy'|'dependOn'|'calledBy'|'uid'|'dirtySignal'|'nodeBucket' >) => {
        if (PathToUidMap.has(nodeMeta.path)) {
            DuplicatePathError(String(nodeMeta.path))
            // throw new Error(`[MeshFlow] Duplicate Path: ${String(nodeMeta.path)}`);
        }

        const currentId = ++uid;

        const dependOnContext: DependOnContext<P> = {
            path: nodeMeta.path,
            getNode: (p: P) => GetNodeByPath(p) ,
        };

        const dependOn = (cb: (data: any) => any,key:KeysOfUnion<NM> | (string & {}) = 'value') => {
            const newVal = cb({ ...dependOnContext });
            const schemaNode = GetNodeByPath(nodeMeta.path);

            // 处理历史记录 (兼容 history 为空的情况)
            if (history.createHistoryAction && history.pushIntoHistory) {
                const item = history.createHistoryAction(
                    [
                        { path: nodeMeta.path, value: schemaNode.state[key] },
                        { path: nodeMeta.path, value: newVal },
                    ],
                    (metadata: { path: P; value: any }) => {
                        let data = GetNodeByPath(metadata.path);
                        data.state[key] = metadata.value;
                        notify(metadata.path);
                    }
                );
                history.pushIntoHistory(item);
            }

            // 更新状态并触发调度
            schemaNode.state[key] = newVal;
            notify(nodeMeta.path);
        };

        // if(nodeMeta.notifyKeys.size==0){
        //     nodeMeta.notifyKeys.add('value');
        // }

        

        // 2. 调用工厂函数，生成 MeshNode 实例
        const nodeInstance = createMeshNode<P,NM>({
            uid: currentId,
            type:nodeMeta.type,
            path: nodeMeta.path,
            state: nodeMeta.state, // 注意：useInternalForm 传过来的应该包含 value 等状态
            meta: nodeMeta.meta,
            nodeBucket: {},
            dirtySignal:  'signalCreator' in UITrigger?UITrigger.signalCreator():undefined,
            notifyKeys:nodeMeta.notifyKeys,
            dependOn: dependOn,
          
        }) as MeshFlowTaskNode<P,typeof nodeMeta.state,NM>;
        
  

        // 3. 存入调度映射
        PathToUidMap.set(nodeInstance.path, currentId);
        // UidToNodeMap.set(currentId, nodeInstance);
 
        UidToNodeMap[currentId] = nodeInstance;

        return nodeInstance;
    }

    const registerGroupNode = (groupMeta: Omit<MeshFlowGroupNode<P>, 'createView'|'calledBy'|'uid'|'dirtySignal'>) => {
        if (PathToUidMap.has(groupMeta.path)) {
            DuplicatePathError(String(groupMeta.path))
            // throw new Error(`[MeshFlow] Duplicate Path: ${String(groupMeta.path)}`);
        }

        const currentId = ++uid;

        // Group 节点没有复杂的状态逻辑，但也用工厂统一管理
        const groupInstance = createMeshNode<P,NM>({
            uid: currentId,
            type:groupMeta.type,
            path: groupMeta.path,
            state: {}, // Group 无状态
            meta: groupMeta,
            nodeBucket: {},
            children: groupMeta.children,
 
        }) as MeshFlowGroupNode<P>;

        PathToUidMap.set(groupInstance.path, currentId);
        // UidToGroupMap.set(currentId, groupInstance);
        UidToGroupMap[currentId] = groupInstance;

        return groupInstance;
    };


    function GetNodeByPath(path: P): MeshFlowTaskNode<P, any, NM> {
        const uid = PathToUidMap.get(path) as number;
        // const targetSchema = UidToNodeMap.get(uid);
        const targetSchema = UidToNodeMap[uid];
        if (!targetSchema) {
            throw Error('wrong ID')
        }
        return targetSchema;
    };

    function GetGroupByPath(path: MeshPath) {
        const uid = PathToUidMap.get(path)!
        // let groupData = UidToGroupMap.get(uid);
        let groupData = UidToGroupMap[uid];
        return groupData;
    };

    const notify = (path: P) => {
        //notifyAll完成之前不允许操作
        // if (forbidUserNotify) {
        //     return
        // }


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

    const notifyAll = async () => {
       
        // 1. 获取完整的拓扑分层
        Promise.resolve().then(async () => {
            const order = dependency.GetDependencyOrder();

            // 如果没有节点，直接返回
            if (!order || order.length === 0) return;

            // 2. order[0] 就是所有入度为 0 的节点（整个依赖网的所有源头）
            const roots = order[0];

            // 初始化期间，可以加上你之前的防打扰锁
            isInitializing = true;

            try {
                
                // 🌟 3. 神奇的魔法在这里：
                // triggerPath 传 null -> 开启“上帝模式”，它会把 roots 当作起点去计算整个图
                // 不会跳过任何 roots，并且完美的复用了你那套阻力拦截、背压控制、防卡顿机制
                // Promise.resolve()
                // .then(()=>{
                    taskrunner(null, roots);
                // })
                

            } catch (error) {
                hooks.callOnError(error);
                throw error; // 继续抛出或者根据业务吞掉
            } finally {
                isInitializing = false;

                // 4. 全部算完后，发起一次性的 UI 刷新
                requestUpdate();
            }
        })

    }
    const batchNotify = (updates: { path: P; key: KeysOfUnion<NM> | (string & {}); value: any }[]) => {
        if (!updates || updates.length === 0) return;
    
        // 1. 🌟 历史记录打包（不变）
        if (history.createHistoryAction && history.pushIntoHistory) {
            const item = history.createHistoryAction(
                [
                    updates.map(u => ({ path: u.path, key: u.key, value: (GetNodeByPath(u.path).state as any)[u.key] })),
                    updates.map(u => ({ path: u.path, key: u.key, value: u.value }))
                ],
                (metadataArray: any[]) => {
                    const undoRoots = new Set<P>();
                    metadataArray.forEach(meta => {
                        let data = GetNodeByPath(meta.path);
                        (data.state as any)[meta.key] = meta.value;
                        flushPathSet.add(meta.path);
                        // 撤销时，也把这些节点作为源头收集起来
                        undoRoots.add(meta.path);
                    });
                    requestUpdate();
                    if (undoRoots.size > 0) {
                        taskrunner(null, Array.from(undoRoots)); // 撤销也是一波流！
                    }
                }
            );
            history.pushIntoHistory(item);
        }
    
        // 2. 🌟 状态更新 & 收集这一波的“触发源”
        const updateRoots = new Set<P>();
    
        updates.forEach(update => {
            let node = GetNodeByPath(update.path);
            
            // 更新内存状态
            (node.state as any)[update.key] = update.value;
            
            // 加入 UI 刷新队列
            flushPathSet.add(update.path);
    
            // 🌟 核心突破：不去找下游，直接把被修改的节点本身记下来！
            updateRoots.add(update.path);
        });
    
        // 3. 触发 UI 批量更新
        requestUpdate();
    
        // 4. 🌟 真正的上帝模式：一波流推平 DAG！
        if (updateRoots.size > 0) {
            // 把所有被修改的节点，作为同一个 Task 的起点，一次性输入！
            taskrunner(null, Array.from(updateRoots)); 
        }
    };
 

    return {
        registerNode,
        registerGroupNode,
        GetNodeByPath,
        GetGroupByPath,
        notify,
        notifyAll,
        batchNotify,
        useEntangle,
        updateEntangleLevel,
        UITrigger,
        UidToNodeMap
    }

}