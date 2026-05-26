// core/engine/useMeshNode.ts

import { MeshFlowGroupNode, MeshFlowTaskNode, MeshPath, MeshNodeProxy, SuggestKey } from "../types/types";
import { SchemaBucket } from "./bucket";

 
const IMPORTANT_KEYS = ['path', 'uid', 'type', 'dependOn', 'nodeBucket'];

 
class MeshNodeBase<P extends MeshPath, V = any, NM = any> {
    public path: P;
    public uid: number;
 
    public meta: NM  ;
    public dirtySignal: any;
    
    // Task 专属属性，但在基类声明以方便 Proxy 统一读取
    public state: V ;
    // public dependOn?: (cb: (val: V) => V, key?: SuggestKey<NM> | undefined) => void;

    // 内部私有变量代替原本的闭包变量
    protected _proxyView: any = null;
    protected _isDisposed = false;
    protected _cachedOwnKeys: (string | symbol)[] | null = null;

    constructor(config: any) {
        this.path = config.path;
        this.uid = config.uid;
       
        this.meta = config.meta;
        this.dirtySignal = config.dirtySignal;
        this.state = config.state;
 
    }

    // 挂载在原型链上的核心视图工厂
    public createView = <E extends Record<string, any> = {}>(extraProps: E = {} as E): any => {
        if (this._proxyView && Object.keys(extraProps).length === 0) return this._proxyView;

        const self = this; // 仅捕获 this 引用，不捕获庞大的 config 闭包

        const proxy = new Proxy(extraProps, {
            get(target, prop) {
                if (self._isDisposed) return undefined; // 安全阀：销毁后拒绝读取

                const key = prop as string;
                if (Reflect.has(target, prop)) return Reflect.get(target, prop);

                const state = self.state
                // 尝试从 state 读
                if (self.state && key in (self.state as any)) return (self.state as any)[key];
                
                // 从实例本身读 (path, uid, type)
                if (key in self) return (self as any)[key];
                
                // 尝试从 meta 读
                if (self.meta && key in (self.meta as any)) return (self.meta as any)[key];

                return Reflect.get(target, prop);
            },
            set(target, prop, value) {
                return false;
            },
            ownKeys(target) {
                if (self._isDisposed) return Reflect.ownKeys(target);
                if (self._cachedOwnKeys) {
                    return self._cachedOwnKeys;
                }

                // 🌟 3. 慢速通道（整个生命周期只走一次）：手动的高性能去重
                const uniqueKeys: (string | symbol)[] = [];
                // 使用无原型链的纯净对象作为极其轻量的 Hash Map
                const seen: Record<string | symbol, boolean> = Object.create(null);

                const addKey = (k: string | symbol) => {
                    if (!seen[k]) {
                        seen[k] = true;
                        uniqueKeys.push(k);
                    }
                };

                // 老老实实地用 for 循环，绝对不要用 ... 展开语法
                const targetKeys = Reflect.ownKeys(target);
                for (let i = 0; i < targetKeys.length; i++) addKey(targetKeys[i]);

                if (self.state) {
                    const stateKeys = Object.keys(self.state);
                    for (let i = 0; i < stateKeys.length; i++) addKey(stateKeys[i]);
                }

                if (self.meta) {
                    const metaKeys = Object.keys(self.meta);
                    for (let i = 0; i < metaKeys.length; i++) addKey(metaKeys[i]);
                }

                for (let i = 0; i < IMPORTANT_KEYS.length; i++) addKey(IMPORTANT_KEYS[i]);

                // 🌟 4. 锁定缓存
                self._cachedOwnKeys = uniqueKeys;

                return uniqueKeys;
            },
            getOwnPropertyDescriptor(target, prop) {
                if (self._isDisposed) return Reflect.getOwnPropertyDescriptor(target, prop);

                const key = prop as string;
                if (
                    Reflect.has(target, prop) || 
                    (self.state && key in (self.state as any)) || 
                    (self.meta && key in (self.meta as any)) ||
                    IMPORTANT_KEYS.includes(key) 
                ) {
                    return { enumerable: true, configurable: true };
                }
                return Reflect.getOwnPropertyDescriptor(target, prop);
            }
        });

        this._proxyView = proxy;
        return proxy;
    };

    // 保留 Getter 的设计，保护 proxy 不被篡改
    public get proxy() {
        return this._proxyView;
    }

    // 🌟 优化 3：内置的一键自毁程序，完美解决内存泄漏和闭包死锁
    public dispose() {
        this._isDisposed = true;
        this._proxyView = null; // 释放 Proxy
 
        this._cachedOwnKeys = null;
        (this.meta as any) = null;       // 释放元数据
    }
}

/**
 * 具体的 Task 节点实现
 */
export class MeshTaskNodeImpl<P extends MeshPath, V = any, NM = any> extends MeshNodeBase<P, V, NM> implements MeshFlowTaskNode<P, V, NM> {
    public nodeBucket: any;
    public notifyKeys: Set<SuggestKey<NM>>;
    public calledBy: number = 0;
    public type:string
    
 
    public dependOn:(cb: (val: V) => V, key?: SuggestKey<NM> ) => void;

    constructor(config: any) {
        super(config);
        this.nodeBucket = config.nodeBucket;
        this.notifyKeys = config.notifyKeys;
        this.calledBy = 0;
        this.type = config.type
        this.dependOn = (cb: (val: V) => V, key?: SuggestKey<NM>)=>{
            config.dependOn(cb,key)
        }
    }

    // 复写基类 dispose，增加自身容器的清理
    public dispose() {
        super.dispose();
        this.nodeBucket = null;
        (this as any).state = null;
        (this.dependOn as any) = null; 

        if (this.notifyKeys) {
            this.notifyKeys.clear();  
        }
    }

    // 类型补充
    public get proxy(): MeshNodeProxy<MeshFlowTaskNode<P, V, NM>, V, NM> {
        return this._proxyView;
    }
    public _syncCache(bucket:SchemaBucket<P>,val:any ){
         
        bucket._syncCache(val);
    }
}

/**
 * 具体的 Group 节点实现
 */
export class MeshGroupNodeImpl<P extends MeshPath> extends MeshNodeBase<P> implements MeshFlowGroupNode<P> {
    public children: P[];
    public type: "group" = 'group';

    constructor(config: any) {
        super(config);
        this.children = config.children;
    }

    public dispose() {
        super.dispose();
        this.children = [];
    }
}

/**
 * 🌟 核心兼容：保持工厂函数签名不变
 * Scheduler 等其他地方调用 `createMeshNode` 的逻辑完全不需要改！
 */
export function createMeshNode<P extends MeshPath, NM = any, V = any>(config: any) {
    if ("children" in config) {
        return new MeshGroupNodeImpl<P>(config) as unknown as MeshFlowGroupNode<P>;
    } else {
        return new MeshTaskNodeImpl<P, V, NM>(config) as unknown as MeshFlowTaskNode<P, V, NM>;
    }
}


