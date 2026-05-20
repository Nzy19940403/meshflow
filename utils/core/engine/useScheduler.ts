 import { DependOnContext, InternalMeshFlowHistory, MeshEmit, MeshError, MeshFlowGroupNode, MeshFlowHistory, MeshFlowTaskNode, MeshPath, StandardUITrigger, SuggestKey, TransactionArray, notifyArgs } from "../types/types";
import { useMeshTask } from "./useMeshTask";
import { createMeshNode } from './useMeshNode';
import { KeysOfUnion, createTimeScheduler } from "../utils/util";
import { UseSetEntangle } from "../dependency/useSetEntangle";
import { SchemaBucket } from "./bucket";
import { createTransactionScheduler } from './useTransactionSchduler';

/**
 * 🌟 核心重构：MeshScheduler 类
 * 将所有局部变量提升为类属性，所有局部函数提升为原型方法 (Prototype Methods)
 * 彻底消灭闭包引起的 Context 内存泄漏
 */
export class MeshScheduler<
    T,
    P extends MeshPath,
    B extends Record<string, any> = StandardUITrigger<T>,
    NM = any
> {
    public uid: number = 0;
    public PathToUidMap = new Map<MeshPath, number>();
    public UidToNodeMap: MeshFlowTaskNode<P, any, NM>[] = [];
    public UidToGroupMap: MeshFlowGroupNode[] = [];
    public UidToPathMap: Array<P> = [];
    public AllBuckets: Array<SchemaBucket<P>> = [];

    public isPending = false;
    public flushPathSet = new Set<number>();

    public useEntangle: any;
    public updateEntangleLevel: any;
    public dispose: ()=>void;
    public stageValueFn: typeof this.meshTaskSystem.stageValueFn;
    public SettleTasks: typeof this.taskSchduler.settleTasks;

    // 子系统实例
    public timeScheduler: ReturnType<typeof createTimeScheduler>;
    public taskSchduler: ReturnType<typeof createTransactionScheduler<P,NM>>;
    public entangleSystem: any;
    public meshTaskSystem: ReturnType<typeof useMeshTask<P,NM>>;

    constructor(
        public config: { useGreedy: boolean, useEntangleStep: number, NODE_QUOTA_PER_FRAME: number },
        public dependency: any, // 保持你的完整类型
        public history:InternalMeshFlowHistory,
        public hooks: { callOnError: any; callOnSuccess: any; callOnStart: any; emit: MeshEmit; },
        public UITrigger: B
    ) {
        this.timeScheduler = createTimeScheduler();
        
        // 使用箭头函数代理，确保 this 指向，同时避免 bind 产生的额外对象
        this.taskSchduler = createTransactionScheduler<P,NM>(
            () => (updates: notifyArgs<P,NM>[]) => this.batchNotify(updates), 
            () => (path: P,key:SuggestKey<NM>) => this.notify(path,key),
            {
                emit: this.hooks.emit,
                callOnError: this.hooks.callOnError
            }
        );
 
        // 🌟 初始化子系统，全部传入绑定了 this 的方法
        this.entangleSystem = UseSetEntangle<P, NM>(
            { useEntangleStep: this.config.useEntangleStep },
            this.timeScheduler,
            this.dependency.GetUidToLevelMap,
            (p: P) => this.GetNodeByPath(p),
            // (u: number) => this.GetNodeByUid(u),
            // (u: number) => this.GetPathByUid(u),
            { emit: this.hooks.emit, onError: this.hooks.callOnError },
            history
        );
        this.useEntangle = this.entangleSystem.useEntangle;  
        this.updateEntangleLevel = this.entangleSystem.updateEntangleLevel;

        this.meshTaskSystem = useMeshTask<P, NM>(
            { useGreedy: this.config.useGreedy, NODE_QUOTA_PER_FRAME: this.config.NODE_QUOTA_PER_FRAME },
            this.dependency,
            {
                GetNodeByPath: (p: P) => this.GetNodeByPath(p),
                GetNodeByUid: (u: number) => this.GetNodeByUid(u),
                GetPathByUid: (u: number) => this.GetPathByUid(u),
                GetBucket: (b: number) => this.GetBucket(b),
                GetMaxUid: () => this.GetMaxUid(),
                Turnstile: this.entangleSystem.Turnstile
            },
            this.hooks,
            {
                requestUpdate: () => this.requestUpdate(),
                flushPathSet: this.flushPathSet,
            },
            this.timeScheduler,
            this.taskSchduler,
            this.history
        );
        this.dispose = ()=>{
            this.meshTaskSystem.CancelTask();
            for (let i = 0; i < this.UidToNodeMap.length; i++) {
                const node = this.UidToNodeMap[i];
                if (node) {
                    (node as any).dispose();
                }
            }
        
            // 2. 【清空容器】使用物理清空法
            this.UidToNodeMap.length = 0;   // 物理清空数组
            this.UidToGroupMap.length = 0;  
            this.UidToPathMap.length = 0;
            this.AllBuckets.length = 0;
        
            // 3. 【清空集合与映射】
            this.PathToUidMap.clear();      // Map 必须用 clear()
            this.flushPathSet.clear();      // Set 必须用 clear()
        
            // 4. 【重置状态】
            this.uid = 0;
            this.isPending = false;
            console.log('清理成功')

        }; // 压平
        this.stageValueFn = this.meshTaskSystem.stageValueFn; // 压平
        this.SettleTasks = this.taskSchduler.settleTasks;
    }

    public flushUpdate = async () => {
        const uids = Array.from(this.flushPathSet);
        this.flushPathSet.clear();

        // 🌟 完全保留你的双轨触发设计
        if ('signalTrigger' in this.UITrigger && typeof this.UITrigger.signalTrigger === 'function') {
            for (let uid of uids) {
                let target = this.GetNodeByUid(uid);
                this.UITrigger.signalTrigger(target.dirtySignal);
            }
        } else if ('emit' in this.UITrigger) {
            this.UITrigger.emit(uids);
        }
    };

    public requestUpdate = ()=> {
        if (this.isPending) return;
        this.isPending = true;
        requestAnimationFrame(() => {
            try {
                while (this.flushPathSet.size > 0) {
                    this.flushUpdate();
                }
            } finally {
                this.isPending = false;
            }
        });
    }

    // 🌟 提取原先闭包内的 dependOn 逻辑，作为原型方法
    // 这样 24万 个节点复用的都是这一个函数逻辑
    private _executeDependOn = (uid: number, path: P, cb: (data: any) => any, key: KeysOfUnion<NM> | (string & {}) = 'value')=> {
        // 只有执行时才创建 context，极轻量，用完即毁
        const dependOnContext: DependOnContext<P> = {
            path: path,
            getNode: (p: P) => this.GetNodeByPath(p),
        };

        const newVal = cb(dependOnContext);
        const schemaNode = this.GetNodeByUid(uid);
        const oldVal = schemaNode.state[key];
        if (Object.is(oldVal, newVal)) return;

        // if (this.history.createHistoryAction && this.history.pushIntoHistory) {
        //     const item = this.history.createHistoryAction(
        //         [
        //             { path: path, value: schemaNode.state[key as string] },
        //             { path: path, value: newVal },
        //         ],
        //         (metadata: { path: P; value: any }) => {
        //             let data = this.GetNodeByPath(metadata.path);
        //             data.state[key as string] = metadata.value;
        //             this.notify(metadata.path);
        //         }
        //     );
        //     this.history.pushIntoHistory(item);
        // }
        
        if( this.history.StartTransaction){
            this.history.StartTransaction();  
        }
        if (this.history.RecordMutation) {
             
            this.history.RecordMutation(
                path, 
                key, 
                oldVal, 
                newVal
            );
        }

        schemaNode.state[key] = newVal;
        this.notify(path,key);
    }

    public registerNode =  (nodeMeta: Omit<MeshFlowTaskNode<P>, 'createView' | 'proxy' | 'dependOn' | 'calledBy' | 'uid' | 'dirtySignal' | 'nodeBucket'|'syncCache'>)=> {
        if (this.PathToUidMap.has(nodeMeta.path)) {
            throw new Error(MeshError.DuplicatePath(String(nodeMeta.path)))
        }

        const currentId = ++this.uid;

        // 🌟 闭包极致压缩：只捕获 this, currentId, nodeMeta.path

        const dependOnFn = (cb: (data: any) => any, key?: string) => this._executeDependOn(currentId, nodeMeta.path, cb, key);

        const nodeInstance = createMeshNode<P, NM>({
            uid: currentId,
            type: nodeMeta.type,
            path: nodeMeta.path,
            state: nodeMeta.state,
            meta: nodeMeta.meta,
            nodeBucket: {},
            // 🌟 保留双轨制支持：
            dirtySignal: 'signalCreator' in this.UITrigger ? this.UITrigger.signalCreator() : undefined,
            notifyKeys: nodeMeta.notifyKeys,
            dependOn: dependOnFn,
        }) as MeshFlowTaskNode<P, typeof nodeMeta.state, NM>;

        this.PathToUidMap.set(nodeInstance.path, currentId);
        this.UidToPathMap[currentId] = nodeInstance.path;
        this.UidToNodeMap[currentId] = nodeInstance;

        return nodeInstance;
    }

    public registerGroupNode = (groupMeta: Omit<MeshFlowGroupNode<P>, 'createView' | 'calledBy' | 'uid' | 'dirtySignal'>)=> {
        if (this.PathToUidMap.has(groupMeta.path)) {
            throw new Error(MeshError.DuplicatePath(String(groupMeta.path)))
        }

        const currentId = ++this.uid;
        const groupInstance = createMeshNode<P, NM>({
            uid: currentId,
            type: groupMeta.type,
            path: groupMeta.path,
            state: {}, 
            meta: groupMeta as any,
            nodeBucket: {},
            children: groupMeta.children,
        }) as MeshFlowGroupNode<P>;

        this.PathToUidMap.set(groupInstance.path, currentId);
        this.UidToGroupMap[currentId] = groupInstance;

        return groupInstance;
    }

    public GetNodeByPath = (path: P): MeshFlowTaskNode<P, any, NM>=> {
        const uid = this.PathToUidMap.get(path);
        if (uid === undefined) {
        
            throw Error(MeshError.WrongId)
         
        };
        const targetSchema = this.UidToNodeMap[uid];
        if (!targetSchema) throw Error(MeshError.WrongId);
        return targetSchema;
    }

    public GetNodeByUid = (uid: number): MeshFlowTaskNode<P, any, NM> => {
        const targetSchema = this.UidToNodeMap[uid];
        if (!targetSchema) throw Error(MeshError.WrongId);
        return targetSchema;
    }

    public GetPathByUid = (uid: number): P =>{
        return this.UidToPathMap[uid];
    }

    public GetGroupByPath = (path: MeshPath)=> {
        const uid = this.PathToUidMap.get(path)!;
        return this.UidToGroupMap[uid];
    }

    public SetBucket = (newBucket: SchemaBucket<P>)=>{
        return this.AllBuckets.push(newBucket) - 1;
    }

    public GetBucket = (bucketId: number)=> {
        const bucket = this.AllBuckets[bucketId];
        if (!bucket) throw Error(MeshError.WrongId);
        return bucket;
    }

    public GetMaxUid = ()=> {
        return this.uid;
    }

    public notify = (path: P,key:SuggestKey<NM>)=>{
        let inDegree = this.GetNodeByPath(path);
        if (!inDegree) throw Error(MeshError.WrongId);

        this.flushPathSet.add(inDegree.uid);
        this.requestUpdate();

        let nextOrder = this.dependency.GetNextDependency(inDegree.uid);

        this.meshTaskSystem.TaskRunner(inDegree.uid, nextOrder,[{uid:inDegree.uid,key}]);
    }

    public notifyAll = async () => {
        Promise.resolve().then(async () => {
            const order = this.dependency.GetDependencyOrder();
            if (!order || order.length === 0) return;
            const roots = order[0];
            try {
                this.meshTaskSystem.TaskRunner(null, roots,[]);
            } catch (error) {
                this.hooks.callOnError(error);
                throw error;
            } finally {
                this.requestUpdate();
            }
        });
    }
    private _dedupeScratchpad = new Uint8Array(1024);
    public batchNotify = (updates: { path: P; key: SuggestKey<NM>; value: any }[]) => {
        // if (!updates || updates.length === 0) return;
 
        // const updateRoots = new Set<number>();
        // updates.forEach(update => {
        //     let node = this.GetNodeByPath(update.path);
        //     const oldVal = (node.state as any)[update.key as string];
        //     const newVal = update.value;

        //     if (this.history.RecordMutation) {
        //         this.history.RecordMutation(
        //             update.path, 
        //             update.key, 
        //             oldVal, 
        //             newVal
        //         );
        //     }

        //     // 3. 真正修改节点的值
        //     (node.state as any)[update.key as string] = newVal;
            
        //     // 4. 收集脏节点，准备触发推演
        //     this.flushPathSet.add(node.uid);
        //     updateRoots.add(node.uid);
        // });
         
        // this.requestUpdate();
       
        // if (updateRoots.size > 0) {
        //     this.meshTaskSystem.TaskRunner(null, Array.from(updateRoots),updates);
        // }

        const updateLen = updates.length;
        if (updateLen === 0) return;

        // 1. 扩容去重刮刮卡（如果节点数超过当前容量）
        const maxUid = this.GetMaxUid();
        if (this._dedupeScratchpad.length <= maxUid) {
            this._dedupeScratchpad = new Uint8Array(maxUid + 1);
        } else {
            // 物理清零，比清空 Set 快得多
            this._dedupeScratchpad.fill(0);
        }

        const updateRoots: number[] = [];
        const keysPayload: { uid: number; key: string }[] = new Array(updateLen);
        
        // 2. 使用高性能 for 循环替代 forEach
        for (let i = 0; i < updateLen; i++) {
            const update = updates[i];
            const node = this.GetNodeByPath(update.path);
            const uid = node.uid;
            const key = update.key as string;

            // A. 记录历史 & 修改状态
            if (this.history.RecordMutation) {
                this.history.RecordMutation(update.path, key, (node.state as any)[key], update.value);
            }
            (node.state as any)[key] = update.value;

            // B. 填充 Keys 载荷 (统一使用 UID)
            keysPayload[i] = { uid, key };

            // C. 极速去重收集 Roots
            if (this._dedupeScratchpad[uid] === 0) {
                this._dedupeScratchpad[uid] = 1; // 标记已访问
                updateRoots.push(uid);
                this.flushPathSet.add(uid);
            }
        }
        
        // 3. 触发调度
        this.requestUpdate();
        if (updateRoots.length > 0) {
            // 第三个参数现在是 [{uid, key}, ...] 的扁平结构，不再有 Path
            this.meshTaskSystem.TaskRunner(null, updateRoots, keysPayload);
        }
    }

    public SilentSet = (path: P,key:SuggestKey<NM>, value: any)=>{
     
        const node = this.GetNodeByPath(path);
        if (!node) {
            return false;
        }
        const oldVal = node.state[key];
        if (Object.is(oldVal, value)) return false;
       
        if (this.history.RecordSilentMutation) {
            this.history.RecordSilentMutation(path as string, key as string, oldVal, value);
        }
        // 3. 物理覆写（不触碰任何引擎核心依赖）
        node.state[key] = value;
       
        this.flushPathSet.add(node.uid);
        return true; 
    }
 
}

/**
 * 🌟 暴露给外部的兼容 API 层
 * 保证外部业务代码完全不需要修改，无缝切换到 Class 引擎！
 */
export function useScheduler<
    T,
    P extends MeshPath,
    B extends Record<string, any> = StandardUITrigger<T>,
    NM = any
>(
    config: { useGreedy: boolean, useEntangleStep: number, NODE_QUOTA_PER_FRAME: number },
    dependency: any,
    // history: Partial<{ pushIntoHistory: any; createHistoryAction: any; }>,
    history:InternalMeshFlowHistory,
    hooks: { callOnError: any; callOnSuccess: any; callOnStart: any; emit: MeshEmit; },
    UITrigger: B
) {
    const scheduler = new MeshScheduler<T, P, B, NM>(config, dependency, history, hooks, UITrigger);
    return scheduler
 
}