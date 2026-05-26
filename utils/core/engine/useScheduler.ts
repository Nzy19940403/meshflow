 import { DependOnContext, InternalMeshFlowHistory, MeshEmit, MeshError, MeshFlowGroupNode, MeshFlowHistory, MeshFlowTaskNode, MeshPath, StandardUITrigger, SuggestKey, TransactionArray, notifyArgs } from "../types/types";
import { useMeshTask } from "./useMeshTask";
import { createMeshNode } from './useMeshNode';
import { KeysOfUnion, createTimeScheduler } from "../utils/util";
import { UseSetEntangle } from "../dependency/useSetEntangle";
import { SchemaBucket } from "./bucket";
import { createTransactionScheduler } from './useTransactionSchduler';

/**
 *  
 */
export class MeshScheduler<
    T,
    P extends MeshPath,
    B extends Record<string, any> = StandardUITrigger<T>,
    NM = any
> {
    public uid: number = 0;
    private _PathToUidMap = new Map<MeshPath, number>();
    private _UidToNodeMap: MeshFlowTaskNode<P, any, NM>[] = [];
    private _UidToGroupMap: MeshFlowGroupNode[] = [];
    private _UidToPathMap: Array<P> = [];
    private _AllBuckets: Array<SchemaBucket<P>> = [];

    private _isPending = false;
    /**
     * @internal
     **/ 
    // public _flushPathSet = new Set<number>();

    /**
     * @internal
    */
    public _flushPathArray:Array<number> = []
    public _flushPathPendingMap:Array<number> = []
    /**
     * @internal
     * */ 
    public _useEntangle;
    /**
     * @internal
     * */ 
    public _updateEntangleLevel;
    public dispose: ()=>void;
    /**
     * @internal
     * */ 
    public _stageValueFn: typeof this._meshTaskSystem._stageValueFn;
    public SettleTasks: typeof this._taskSchduler.settleTasks;

    // 子系统实例
    public _timeScheduler: ReturnType<typeof createTimeScheduler>;
    private _taskSchduler: ReturnType<typeof createTransactionScheduler<P,NM>>;
    private _entangleSystem: ReturnType<typeof UseSetEntangle<P, NM>>;
    private _meshTaskSystem: ReturnType<typeof useMeshTask<P,NM>>;

    /**
     * @internal
     * */ 
    public _addToRender = (uid:number)=>{
        if(!this._flushPathPendingMap[uid]){
            this._flushPathArray.push(uid);
            this._flushPathPendingMap[uid] = 1;
        }
    }

    constructor(
        public config: { useGreedy: boolean, useEntangleStep: number, NODE_QUOTA_PER_FRAME: number },
        public dependency:{
            _GetAllNextDependency: (targetUid: number) => number[];
            _GetAllPrevDependency: (targetUid: number) => number[];
            _GetPrevDependency: (targetUid: number) => number[];
            _GetNextDependency: (targetUid: number) => number[];
            GetDependencyOrder: () => number[][];
            _GetUidToLevelMap: () => Map<number, number>;
        }, // 保持你的完整类型
        public history:InternalMeshFlowHistory,
        public hooks: { callOnError: any; callOnSuccess: any; callOnStart: any; emit: MeshEmit; },
        public UITrigger: B
    ) {
        this._timeScheduler = createTimeScheduler();
        
        // 使用箭头函数代理，确保 this 指向，同时避免 bind 产生的额外对象
        this._taskSchduler = createTransactionScheduler<P,NM>(
            () => (updates: notifyArgs<P,NM>[]) => this._batchNotify(updates), 
            () => (path: P,key:SuggestKey<NM>) => this.notify(path,key),
            {
                emit: this.hooks.emit,
                callOnError: this.hooks.callOnError
            }
        );
 
        // 🌟 初始化子系统，全部传入绑定了 this 的方法
        this._entangleSystem = UseSetEntangle<P, NM>(
            { useEntangleStep: this.config.useEntangleStep },
            this._timeScheduler,
            this.dependency._GetUidToLevelMap,
            (p: P) => this.GetNodeByPath(p),
            // (u: number) => this.GetNodeByUid(u),
            // (u: number) => this.GetPathByUid(u),
            { emit: this.hooks.emit, onError: this.hooks.callOnError },
            history
        );
        this._useEntangle = this._entangleSystem._useEntangle;  
        this._updateEntangleLevel = this._entangleSystem._updateEntangleLevel;

        this._meshTaskSystem = useMeshTask<P, NM>(
            { useGreedy: this.config.useGreedy, NODE_QUOTA_PER_FRAME: this.config.NODE_QUOTA_PER_FRAME },
            this.dependency,
            {
                GetNodeByPath: (p: P) => this.GetNodeByPath(p),
                GetNodeByUid: (u: number) => this.GetNodeByUid(u),
                GetPathByUid: (u: number) => this.GetPathByUid(u),
                GetBucket: (b: number) => this.GetBucket(b),
                GetMaxUid: () => this.GetMaxUid(),
                Turnstile: this._entangleSystem.Turnstile
            },
            this.hooks,
            {
                _requestUpdate: () => this._requestUpdate(),
                // _flushPathSet: this._flushPathSet,
                _addToRender:(uid:number)=>this._addToRender(uid)
            },
            this._timeScheduler,
            this._taskSchduler,
            this.history
        );
        this.dispose = ()=>{
            this._meshTaskSystem._CancelTask();
            this._entangleSystem._dispose();
            for (let i = 0; i < this._UidToNodeMap.length; i++) {
                const node = this._UidToNodeMap[i];
                if (node) {
                    (node as any).dispose();
                }
            }
        
            // 2. 【清空容器】使用物理清空法
            this._UidToNodeMap.length = 0;   // 物理清空数组
            this._UidToGroupMap.length = 0;  
            this._UidToPathMap.length = 0;
            this._AllBuckets.length = 0;
        
            // 3. 【清空集合与映射】
            this._PathToUidMap.clear();      // Map 必须用 clear()
            // this._flushPathSet.clear();      // Set 必须用 clear()
        
            // 4. 【重置状态】
            this.uid = 0;
            this._isPending = false;

            this._flushPathPendingMap.length = 0;
            this._flushPathArray.length = 0;
            // console.log('清理成功')

        }; // 压平
        this._stageValueFn = this._meshTaskSystem._stageValueFn; // 压平
        this.SettleTasks = this._taskSchduler.settleTasks;
    }
    public flushUpdate = async () => {
        // const uids = Array.from(this._flushPathSet);
        // this._flushPathSet.clear();
        const uids = this._flushPathArray;
        const len = uids.length;
        if (len === 0) return;

        // 🌟 完全保留你的双轨触发设计
        if ('signalTrigger' in this.UITrigger && typeof this.UITrigger.signalTrigger === 'function') {
            for (let uid of uids) {
                let target = this.GetNodeByUid(uid);
                this.UITrigger.signalTrigger(target.dirtySignal);
                this._flushPathPendingMap[uid] = 0;
            }
        } else if ('emit' in this.UITrigger) {
            const safeUidsCopy = uids.slice();
            this.UITrigger.emit(safeUidsCopy);
            for (let i = 0; i < len; i++) {
                this._flushPathPendingMap[uids[i]] = 0;
            }
        }
        this._flushPathArray.length = 0;
    };

    public _requestUpdate = ()=> {
        if (this._isPending) return;
        this._isPending = true;
        requestAnimationFrame(() => {
            try {
                while (this._flushPathArray.length > 0) {
                    this.flushUpdate();
                }
            } finally {
                this._isPending = false;
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

    public registerNode =  (nodeMeta: Omit<MeshFlowTaskNode<P>, 'createView' | 'proxy' | 'dependOn' | 'calledBy' | 'uid' | 'dirtySignal' | 'nodeBucket'|'_syncCache'>)=> {
        if (this._PathToUidMap.has(nodeMeta.path)) {
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

        this._PathToUidMap.set(nodeInstance.path, currentId);
        this._UidToPathMap[currentId] = nodeInstance.path;
        this._UidToNodeMap[currentId] = nodeInstance;

        return nodeInstance;
    }

    public registerGroupNode = (groupMeta: Omit<MeshFlowGroupNode<P>, 'createView' | 'calledBy' | 'uid' | 'dirtySignal'>)=> {
        if (this._PathToUidMap.has(groupMeta.path)) {
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

        this._PathToUidMap.set(groupInstance.path, currentId);
        this._UidToGroupMap[currentId] = groupInstance;

        return groupInstance;
    }

    public GetNodeByPath = (path: P): MeshFlowTaskNode<P, any, NM>=> {
        const uid = this._PathToUidMap.get(path);
        if (uid === undefined) {
        
            throw Error(MeshError.WrongId)
         
        };
        const targetSchema = this._UidToNodeMap[uid];
        if (!targetSchema) throw Error(MeshError.WrongId);
        return targetSchema;
    }

    public GetNodeByUid = (uid: number): MeshFlowTaskNode<P, any, NM> => {
        const targetSchema = this._UidToNodeMap[uid];
        if (!targetSchema) throw Error(MeshError.WrongId);
        return targetSchema;
    }

    public GetPathByUid = (uid: number): P =>{
        return this._UidToPathMap[uid];
    }

    public GetGroupByPath = (path: MeshPath)=> {
        const uid = this._PathToUidMap.get(path)!;
        return this._UidToGroupMap[uid];
    }
    /**
     * @Internal
    */
    public SetBucket = (newBucket: SchemaBucket<P>)=>{
        return this._AllBuckets.push(newBucket) - 1;
    }

    public GetBucket = (bucketId: number)=> {
        const bucket = this._AllBuckets[bucketId];
        if (!bucket) throw Error(MeshError.WrongId);
        return bucket;
    }

    public GetMaxUid = ()=> {
        return this.uid;
    }

    public notify = (path: P,key:SuggestKey<NM>)=>{
        let inDegree = this.GetNodeByPath(path);
        if (!inDegree) throw Error(MeshError.WrongId);

        // this._flushPathSet.add(inDegree.uid);
        this._addToRender(inDegree.uid)
        this._requestUpdate();

        let nextOrder = this.dependency._GetNextDependency(inDegree.uid);

        this._meshTaskSystem.TaskRunner(inDegree.uid, nextOrder,[{uid:inDegree.uid,key}]);
    }
    /**
     * @internal
     * */ 
    public _notifyAll = async () => {
        Promise.resolve().then(async () => {
            const order = this.dependency.GetDependencyOrder();
            if (!order || order.length === 0) return;
            const roots = order[0];
            try {
                this._meshTaskSystem.TaskRunner(null, roots,[]);
            } catch (error) {
                this.hooks.callOnError(error);
                throw error;
            } finally {
                this._requestUpdate();
            }
        });
    }
    private _dedupeScratchpad = new Uint8Array(1024);
    public _batchNotify = (updates: { path: P; key: SuggestKey<NM>; value: any }[],source:number = 0) => {
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
                // this._flushPathSet.add(uid);
                this._addToRender(uid);
            }
        }
        
        // 3. 触发调度
        this._requestUpdate();
        if (updateRoots.length > 0) {
            // 第三个参数现在是 [{uid, key}, ...] 的扁平结构，不再有 Path
            this._meshTaskSystem.TaskRunner(null, updateRoots, keysPayload,source);
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
       
        // this._flushPathSet.add(node.uid);
        this._addToRender(node.uid)
        return true; 
    }
 
}

/**
 * @internal
 */
export function useScheduler<
    T,
    P extends MeshPath,
    B extends Record<string, any> = StandardUITrigger<T>,
    NM = any
>(
    config: { useGreedy: boolean, useEntangleStep: number, NODE_QUOTA_PER_FRAME: number },
    dependency: {
        _GetAllNextDependency: (targetUid: number) => number[];
        _GetAllPrevDependency: (targetUid: number) => number[];
        _GetPrevDependency: (targetUid: number) => number[];
        _GetNextDependency: (targetUid: number) => number[];
        GetDependencyOrder: () => number[][];
        _GetUidToLevelMap: () => Map<number, number>;
    },
    // history: Partial<{ pushIntoHistory: any; createHistoryAction: any; }>,
    history:InternalMeshFlowHistory,
    hooks: { callOnError: any; callOnSuccess: any; callOnStart: any; emit: MeshEmit; },
    UITrigger: B
) {
    const scheduler = new MeshScheduler<T, P, B, NM>(config, dependency, history, hooks, UITrigger);
    return scheduler
 
}