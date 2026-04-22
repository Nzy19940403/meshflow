// core/engine/useMeshNode.ts

import { MeshFlowGroupNode, MeshFlowTaskNode, MeshPath, MeshNodeProxy, SuggestKey } from "../types/types";

// 🌟 优化 1：将常量提到模块作用域，全网 48W 节点只创建一次该数组，不再是每次闭包都生成
const IMPORTANT_KEYS = ['path', 'uid', 'type', 'dependOn', 'nodeBucket'];

/**
 * 🌟 优化 2：抽离基类
 * 将公共逻辑和极其昂贵的 Proxy 生成逻辑放在基类原型链上
 */
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
 

    constructor(config: any) {
        this.path = config.path;
        this.uid = config.uid;
       
        this.meta = config.meta;
        this.dirtySignal = config.dirtySignal;
        this.state = config.state;
 
    }

    // 🌟 挂载在原型链上的核心视图工厂
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

                const keys = new Set([
                    ...Reflect.ownKeys(target),
                    ...Object.keys(self.state || {}),
                    ...Object.keys(self.meta || {}),
                    ...IMPORTANT_KEYS
                ]);
                return Array.from(keys);
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
        this.dependOn = config.dependOn
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


