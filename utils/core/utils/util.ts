// export type DeepWriteable<T> = T extends (...args: any[]) => any
//   ? T // 💡 优先判断：如果是函数，直接返回，保留调用签名
//   : T extends (infer U)[]
//     ? DeepWriteable<U>[] // 处理数组
//     : T extends object
//       ? { -readonly [P in keyof T]: DeepWriteable<T[P]> } // 处理普通对象
//       : T;
  
//   /**
//    * 递归将所有属性变为 readonly（用于兼容用户传入的 as const）
//    */
//   export type DeepReadonly<T> = T extends (...args: any[]) => any
//   ? T // 💡 保持函数可调用性
//   : T extends (infer U)[]
//     ? readonly DeepReadonly<U>[] // 数组加上 readonly
//     : T extends object
//       ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
//       : T;

 

// 🌟 魔法 2：字面量补全保护
// 它的原理是利用 (string & {}) 让 TS 认为这不是一个单纯的 string，
// 从而保留 T 中的字面量提示，同时又因为它是 string 的子类型而允许输入任何字符串。
 
/**
 * @internal
 * */ 
export type FinalFlatten<T> = T extends infer O ? { [K in keyof O]: O[K] } : never; //展开

/**
 * @internal
 * */ 
type Unwrap<T> = T extends ReadonlyArray<infer U> ? U : T;

 
/**
 * @internal
 * */ 
export type GetAllPath<T,Path = ''> = T extends object
?{
  [K in keyof T]:GetAllPath<T[K],Path extends ""?K:`${Path &string}.${K & string}`>
}[keyof T]
:Path;
/**
 * @internal
 * */ 
export type InferLeafType<T> = 
Unwrap<T> extends infer Node
  ? Node extends { readonly path: any } // 只要是节点
    ? Node extends { readonly children: infer C }
      // 有孩子 -> 穿透递归 (只管孩子)
      ? InferLeafType<C>
      // 没孩子 -> 🌟 它是叶子节点！直接返回整个节点对象类型
      : Node
    : never
  : never;

/**
 * @internal
 * */ 
export type InferLeafPath<T, Prefix extends string = ""> = 
  Unwrap<T> extends infer Node
    ? Node extends { readonly path: infer N }
      
      // === path 是字符串 ===
      ? N extends string
        ? N extends ""
          // A1: 匿名组 -> 穿透递归 (只管孩子)
          ? Node extends { readonly children: infer C } 
            ? InferLeafPath<C, Prefix> 
            : never
          // A2: 具名节点
          : (
              // 🌟 核心判断：是否有 children？
              Node extends { readonly children: infer C }
                // 有孩子 -> 它是 Group，自己不返回，只递归孩子
                // (注意：这里依然要正确维护 Prefix，防止双点问题)
                ? InferLeafPath<C, Prefix extends "" ? N : `${Prefix}.${N}`>
                // 没孩子 -> 它是 Leaf，返回完整路径
                : (Prefix extends "" ? N : `${Prefix}.${N}`)
            )

      // === path 是数字或 Symbol ===
      : N extends number | symbol
        // 同样逻辑：没孩子才返回自己
        ? Node extends { readonly children: infer C }
          ? InferLeafPath<C, Prefix> // 数字/Symbol通常断开前缀，这里假设透传
          : N

      : never
    : never
  : never;

export type KeysOfUnion<T> = T extends any ? keyof T : never;


export const createTimeScheduler = (config = { frameQuota: 12 }) => {
  let _lastYieldTime = performance.now();
  let _taskCounter = 0;
  
  // 依然需要保留这个状态，因为 flushQueue 的 getNodeQuota 需要用到它！
  let _isFirstFrame = false;

  const _checkInputPending = () => {
    if (typeof navigator === 'undefined') {
      return false;
  }
    // @ts-ignore
    return !!(navigator?.scheduling?.isInputPending?.({ includeContinuous: true }));
  };
  
  return {
    // 必须保留，flushQueue 依赖它来决定是 return 8 还是 Infinity
    _getIsFirstFrame: () => {
     
      return _isFirstFrame
    },
    
    reset() {
      _lastYieldTime = performance.now();
      _taskCounter = 0;
      _isFirstFrame = true; // 标记开始
    },

    _shouldYield() {
 
      if (!_isFirstFrame && (++_taskCounter & 15) !== 0) {
        return false;
      }

      const now = performance.now();
      const elapsed = now - _lastYieldTime;
 
      if (elapsed > config.frameQuota) {
        return true;
      }

      if (_checkInputPending()) {
        return true;
      }

      return false;
    },

    async _yieldToMain() {
      return new Promise<void>((resolve) => {
        _nextMacroTick(()=>{
          _lastYieldTime = performance.now();
          _taskCounter = 0;
          
         
          // 🚨 关键：切片归来，首帧保护期结束
          // 这样下一次 flushQueue 里的 getNodeQuota 就会返回 Infinity
          if (_isFirstFrame) _isFirstFrame = false; 
          
          resolve();
        })
      });
    }
  };
};

// export const _nextMacroTick = (fn: () => void) => {
//   // MessageChannel 比 setTimeout(0) 快，且优先级略高，完美适合做任务切断
//   const { port1, port2 } = new MessageChannel();
//   port1.onmessage = fn;
//   port2.postMessage(null);
// };


const _isBrowser = typeof window !== 'undefined' && typeof MessageChannel !== 'undefined';

const _macroTaskQueue: Array<() => void> = [];
let _channel: MessageChannel;

if (_isBrowser) {
  // 🌟 2. 只有在浏览器环境，才去实例化这个“性能怪兽”
  _channel = new MessageChannel();
  _channel.port1.onmessage = () => {
    const task = _macroTaskQueue.shift();
    if (task) task();
  };
}

export const _nextMacroTick = (fn: () => void) => {
  if (!_isBrowser) {
    // 🌟 3. Node.js 环境 (SSR 构建阶段) 的兜底方案
    // setTimeout 跑完就会被垃圾回收，绝对不会阻止 VitePress 的进程退出！
    setTimeout(fn, 0);
    return;
  }

  // 浏览器环境的高性能通道
  _macroTaskQueue.push(fn);
  _channel.port2.postMessage(null);
};

export const safeRequestAnimationFrame = _isBrowser
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;