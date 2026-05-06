// import { DependOnContext, MeshEmit, MeshError, MeshFlowGroupNode, MeshFlowTaskNode, MeshPath, StandardUITrigger, SuggestKey } from "../types/types";
// import { useMeshTask } from "./useMeshTask";
// import { createMeshNode } from './useMeshNode';
// import { KeysOfUnion,   createTimeScheduler } from "../utils/util";
// import { UseSetEntangle } from "../dependency/useSetEntangle";
// import { SchemaBucket } from "./bucket";
// import {createTransactionScheduler} from './useTransactionSchduler';

// /**
//  * @group Core Api
//  * @category 内部实现
//  * 
// */
// export function useScheduler<
//     T, //ui trigger中定义的类型
//     P extends MeshPath, // 路径类型
//     B extends Record<string, any> = StandardUITrigger<T>,
//     NM = any  //业务叶子节点元数据类型
// >(
 
//     config: {
//         useGreedy: boolean,
//         useEntangleStep:number
//         NODE_QUOTA_PER_FRAME:number
//     },
//     dependency: {
//         GetDependencyOrder: () => number[][];
//         GetAllNextDependency: (targetUid: number) => number[];
//         GetNextDependency: (targetUid: number) => number[];
//         GetPrevDependency: (targetUid: number) => number[];
//         GetAllPrevDependency: (targetUid: number) => number[];
//         GetUidToLevelMap: () => Map<number, number>;
//     },
//     history: Partial<{
//         pushIntoHistory: any;
//         createHistoryAction: any;
//     }>,
//     hooks: {
//         callOnError: any;
//         callOnSuccess: any;
//         callOnStart: any;
//         emit: MeshEmit;
//     },
//     UITrigger:  B , 
// ) {

//     const timeScheduler = createTimeScheduler();
//     const taskSchduler = createTransactionScheduler(
//         ()=>batchNotify,
//         ()=>notify,
//         {
//             emit: hooks.emit,
//             callOnError:hooks.callOnError
//         }
//     );

//     let uid: number = 0;
//     const PathToUidMap = new Map<MeshPath, number>();
 

//     const UidToNodeMap: MeshFlowTaskNode<P, any, NM>[] = [];
//     const UidToGroupMap: MeshFlowGroupNode[] = [];
//     const UidToPathMap:Array<P> = []

//     const AllBuckets:Array<SchemaBucket<P>> = []

//     let isPending = false;
//     const flushPathSet = new Set<number>();
 
//     // let isInitializing:boolean = false;
 

//     const flushUpdate = async () => {
//         // console.log("ui update");

//         const uids = Array.from(flushPathSet);

//         // 2. 立即清空，让 Set 变回初始状态，准备迎接下一轮（或者逻辑中意外触发的）通知
//         flushPathSet.clear();
 
//         if ('signalTrigger' in UITrigger && typeof UITrigger.signalTrigger === 'function') {
//             // --- 走原来的 Vue/React 触发逻辑 ---
//             for (let uid of uids) {
//                 let target = GetNodeByUid(uid);
    
//                 UITrigger.signalTrigger(target.dirtySignal);
//             }
//         }else if('emit' in UITrigger){
//             UITrigger.emit(uids);
//         }
        
//     };

//     const requestUpdate = () => {
//         if (isPending) return;
//         isPending = true;
//         requestAnimationFrame(() => {
//             try {
//                 while (flushPathSet.size > 0) {
//                     flushUpdate();
//                 }
//             } finally {
//                 isPending = false;
//             }
//         });
//     };

//     const { useEntangle,updateEntangleLevel, Turnstile } = UseSetEntangle<P, NM>(
//         {
//             useEntangleStep:config.useEntangleStep,
//         },
//         timeScheduler,
//         dependency.GetUidToLevelMap,
//         GetNodeByPath,
//         GetNodeByUid,
//         GetPathByUid,
//         {
//             emit: hooks.emit,
//             onError: hooks.callOnError
//         }
        
//     );

//     const {TaskRunner,CancelTask,stageValueFn} = useMeshTask<P,NM>(
//         {
//             useGreedy: config.useGreedy,
//             NODE_QUOTA_PER_FRAME:config.NODE_QUOTA_PER_FRAME
//         },
//         dependency,
//         {
//             GetNodeByPath,
//             GetNodeByUid,
//             GetPathByUid,
//             GetBucket,
//             GetMaxUid,
//             Turnstile 
//         },
//         hooks,
//         {
//             requestUpdate,
//             flushPathSet,
//         },
//         timeScheduler,
//         taskSchduler
//     );
 
//     const DuplicatePathError = (path:string)=>{
//         throw new Error(`[MeshFlow] Duplicate Path: ${path}`)
//     }

//     const registerNode = (nodeMeta: Omit<MeshFlowTaskNode<P>, 'createView'|'proxy'|'dependOn'|'calledBy'|'uid'|'dirtySignal'|'nodeBucket' >) => {
//         if (PathToUidMap.has(nodeMeta.path)) {
//             DuplicatePathError(String(nodeMeta.path))
//             // throw new Error(`[MeshFlow] Duplicate Path: ${String(nodeMeta.path)}`);
//         }

//         const currentId = ++uid;
 

//         const dependOnContext: DependOnContext<P> = {
//             path: nodeMeta.path,
//             getNode: (p: P) => GetNodeByPath(p) ,
//         };

//         const dependOn = (cb: (data: any) => any,key:KeysOfUnion<NM> | (string & {}) = 'value') => {
//             const newVal = cb({ ...dependOnContext });
//             const schemaNode = GetNodeByPath(nodeMeta.path);
//             if (Object.is(schemaNode.state[key], newVal)) {
//                 return; 
//             }
//             // 处理历史记录 (兼容 history 为空的情况)
//             if (history.createHistoryAction && history.pushIntoHistory) {
//                 const item = history.createHistoryAction(
//                     [
//                         { path: nodeMeta.path, value: schemaNode.state[key] },
//                         { path: nodeMeta.path, value: newVal },
//                     ],
//                     (metadata: { path: P; value: any }) => {
//                         let data = GetNodeByPath(metadata.path);
//                         data.state[key] = metadata.value;
//                         notify(metadata.path);
//                     }
//                 );
//                 history.pushIntoHistory(item);
//             }

//             // 更新状态并触发调度
//             schemaNode.state[key] = newVal;
//             notify(nodeMeta.path);
//         };

//         // if(nodeMeta.notifyKeys.size==0){
//         //     nodeMeta.notifyKeys.add('value');
//         // }

        

//         // 2. 调用工厂函数，生成 MeshNode 实例
//         const nodeInstance = createMeshNode<P,NM>({
//             uid: currentId,
//             type:nodeMeta.type,
//             path: nodeMeta.path,
//             state: nodeMeta.state, // 注意：useInternalForm 传过来的应该包含 value 等状态
//             meta: nodeMeta.meta,
//             nodeBucket: {},
//             dirtySignal:  'signalCreator' in UITrigger?UITrigger.signalCreator():undefined,
//             notifyKeys:nodeMeta.notifyKeys,
//             dependOn: dependOn,
          
//         }) as MeshFlowTaskNode<P,typeof nodeMeta.state,NM>;
        
  

//         // 3. 存入调度映射
//         PathToUidMap.set(nodeInstance.path, currentId);
//         //把叶子节点的uid和它的path映射起来
//         UidToPathMap[currentId]=nodeInstance.path;
 
//         UidToNodeMap[currentId] = nodeInstance;

//         return nodeInstance;
//     }

//     const registerGroupNode = (groupMeta: Omit<MeshFlowGroupNode<P>, 'createView'|'calledBy'|'uid'|'dirtySignal'>) => {
//         if (PathToUidMap.has(groupMeta.path)) {
//             DuplicatePathError(String(groupMeta.path))
//             // throw new Error(`[MeshFlow] Duplicate Path: ${String(groupMeta.path)}`);
//         }

//         const currentId = ++uid;

//         // Group 节点没有复杂的状态逻辑，但也用工厂统一管理
//         const groupInstance = createMeshNode<P,NM>({
//             uid: currentId,
//             type:groupMeta.type,
//             path: groupMeta.path,
//             state: {}, // Group 无状态
//             meta: groupMeta,
//             nodeBucket: {},
//             children: groupMeta.children,
 
//         }) as MeshFlowGroupNode<P>;

//         PathToUidMap.set(groupInstance.path, currentId);
       
//         UidToGroupMap[currentId] = groupInstance;

//         return groupInstance;
//     };


//     function GetNodeByPath(path: P): MeshFlowTaskNode<P, any, NM> {
//         const uid = PathToUidMap.get(path) as number;
//         // const targetSchema = UidToNodeMap.get(uid);
//         const targetSchema = UidToNodeMap[uid];
//         if (!targetSchema) {
//             throw Error(MeshError.WrongId)
//         }
//         return targetSchema;
//     };

//     function GetNodeByUid(uid:number):MeshFlowTaskNode<P, any, NM>{
//         const targetSchema = UidToNodeMap[uid];
//         if (!targetSchema) {
//             throw Error(MeshError.WrongId)
//         }
//         return targetSchema;
//     }
//     function GetPathByUid(uid:number):P{
//         const path = UidToPathMap[uid];
//         return path;
//     }

//     function GetGroupByPath(path: MeshPath) {
//         const uid = PathToUidMap.get(path)!
//         // let groupData = UidToGroupMap.get(uid);
//         let groupData = UidToGroupMap[uid];
//         return groupData;
//     } 

//     function SetBucket(newBucket:SchemaBucket<P>){
//         const bucketId = AllBuckets.push(newBucket) - 1;
//         return bucketId;
//     }

//     function GetBucket(bucketId:number){

//         const bucket = AllBuckets[bucketId];
//         if(!bucket){
//             throw Error(MeshError.WrongId)
//         }
//         return bucket;
//     }

//     function GetMaxUid(){
//         return uid 
//     }

//     const notify = (path: P) => {
 
//         let inDegree = GetNodeByPath(path);

//         if (!inDegree) {
//             throw Error(MeshError.WrongId);
//         }

//         //更新的路径
//         flushPathSet.add(inDegree.uid);

//         requestUpdate();

//         let nextOrder = dependency.GetNextDependency(inDegree.uid);
        
        
//         // runNotifyTask( inDegree.uid,nextOrder);
//         TaskRunner(inDegree.uid, nextOrder);
 
//     };

//     // function runNotifyTask( triggerUid: number,initialNodes: number[]) {

//     //     TaskRunner(triggerUid, initialNodes);
//     // };

//     const notifyAll = async () => {
       
//         // 1. 获取完整的拓扑分层
//         Promise.resolve().then(async () => {
//             const order = dependency.GetDependencyOrder();

//             // 如果没有节点，直接返回
//             if (!order || order.length === 0) return;

//             // 2. order[0] 就是所有入度为 0 的节点（整个依赖网的所有源头）
//             const roots = order[0];

//             // 初始化期间，可以加上你之前的防打扰锁
//             // isInitializing = true;
           
//             try {
                
//                 // 🌟 3. 神奇的魔法在这里：
//                 // triggerPath 传 null -> 开启“上帝模式”，它会把 roots 当作起点去计算整个图
//                 // 不会跳过任何 roots，并且完美的复用了你那套阻力拦截、背压控制、防卡顿机制
//                 // Promise.resolve()
//                 // .then(()=>{
//                     TaskRunner(null, roots);
//                 // })
                

//             } catch (error) {
//                 hooks.callOnError(error);
//                 throw error; // 继续抛出或者根据业务吞掉
//             } finally {
//                 // isInitializing = false;

//                 // 4. 全部算完后，发起一次性的 UI 刷新
//                 requestUpdate();
//             }
//         })

//     }
//     const batchNotify = (updates: { path: P; key: SuggestKey<NM>; value: any }[]) => {
//         if (!updates || updates.length === 0) return;
    
//         // 1. 🌟 历史记录打包（不变）
//         if (history.createHistoryAction && history.pushIntoHistory) {
//             const item = history.createHistoryAction(
//                 [
//                     updates.map(u => ({ path: u.path, key: u.key, value: (GetNodeByPath(u.path).state as any)[u.key] })),
//                     updates.map(u => ({ path: u.path, key: u.key, value: u.value }))
//                 ],
//                 (metadataArray: any[]) => {
//                     const undoRoots = new Set<number>();
//                     metadataArray.forEach(meta => {
//                         let data = GetNodeByPath(meta.path);
//                         (data.state as any)[meta.key] = meta.value;
//                         flushPathSet.add(data.uid);
//                         // 撤销时，也把这些节点作为源头收集起来
//                         undoRoots.add(data.uid);
//                     });
//                     requestUpdate();
//                     if (undoRoots.size > 0) {
//                         TaskRunner(null, Array.from(undoRoots)); // 撤销也是一波流！
//                     }
//                 }
//             );
//             history.pushIntoHistory(item);
//         }
    
//         // 2. 🌟 状态更新 & 收集这一波的“触发源”
//         const updateRoots = new Set<number>();
    
//         updates.forEach(update => {
//             let node = GetNodeByPath(update.path);
            
//             // 更新内存状态
//             (node.state as any)[update.key] = update.value;
            
//             // 加入 UI 刷新队列
//             flushPathSet.add(node.uid);
    
//             // 🌟 核心突破：不去找下游，直接把被修改的节点本身记下来！
//             updateRoots.add(node.uid);
//         });
    
//         // 3. 触发 UI 批量更新
//         requestUpdate();
    
//         // 4. 🌟 真正的上帝模式：一波流推平 DAG！
//         if (updateRoots.size > 0) {
//             // 把所有被修改的节点，作为同一个 Task 的起点，一次性输入！
//             TaskRunner(null, Array.from(updateRoots)); 
//         }
//     };
    
//     const refresTarget = (uid:number)=>{
//         flushPathSet.add(uid)
//     }

//     return {
//         registerNode,
//         registerGroupNode,
//         GetNodeByPath,
//         GetNodeByUid,
//         GetGroupByPath,
//         notify,
//         notifyAll,
//         batchNotify,
//         useEntangle,
//         updateEntangleLevel,

//         SetBucket,
//         GetBucket,

//         CancelTask,
//         stageValueFn,
//         refresTarget,
//         SettleTasks:taskSchduler.settleTasks,

//         UITrigger,
//         UidToNodeMap
//     }

// }


import { DependOnContext, InternalMeshFlowHistory, MeshEmit, MeshError, MeshFlowGroupNode, MeshFlowHistory, MeshFlowTaskNode, MeshPath, StandardUITrigger, SuggestKey, TransactionArray } from "../types/types";
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
    public taskSchduler: ReturnType<typeof createTransactionScheduler>;
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
        this.taskSchduler = createTransactionScheduler(
            () => (updates: any) => this.batchNotify(updates), 
            () => (path: P) => this.notify(path),
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
            (u: number) => this.GetNodeByUid(u),
            (u: number) => this.GetPathByUid(u),
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
        this.notify(path);
    }

    public registerNode =  (nodeMeta: Omit<MeshFlowTaskNode<P>, 'createView' | 'proxy' | 'dependOn' | 'calledBy' | 'uid' | 'dirtySignal' | 'nodeBucket'>)=> {
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

    public notify = (path: P)=>{
        let inDegree = this.GetNodeByPath(path);
        if (!inDegree) throw Error(MeshError.WrongId);

        this.flushPathSet.add(inDegree.uid);
        this.requestUpdate();

        let nextOrder = this.dependency.GetNextDependency(inDegree.uid);

        this.meshTaskSystem.TaskRunner(inDegree.uid, nextOrder);
    }

    public notifyAll = async () => {
        Promise.resolve().then(async () => {
            const order = this.dependency.GetDependencyOrder();
            if (!order || order.length === 0) return;
            const roots = order[0];
            try {
                this.meshTaskSystem.TaskRunner(null, roots);
            } catch (error) {
                this.hooks.callOnError(error);
                throw error;
            } finally {
                this.requestUpdate();
            }
        });
    }

    public batchNotify = (updates: { path: P; key: SuggestKey<NM>; value: any }[]) => {
        if (!updates || updates.length === 0) return;
 
        const updateRoots = new Set<number>();
        updates.forEach(update => {
            let node = this.GetNodeByPath(update.path);
            const oldVal = (node.state as any)[update.key as string];
            const newVal = update.value;

            if (this.history.RecordMutation) {
                this.history.RecordMutation(
                    update.path, 
                    update.key, 
                    oldVal, 
                    newVal
                );
            }

            // 3. 真正修改节点的值
            (node.state as any)[update.key as string] = newVal;
            
            // 4. 收集脏节点，准备触发推演
            this.flushPathSet.add(node.uid);
            updateRoots.add(node.uid);
        });
         
        this.requestUpdate();
       
        if (updateRoots.size > 0) {
            this.meshTaskSystem.TaskRunner(null, Array.from(updateRoots));
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