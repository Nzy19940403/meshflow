export type DeepWriteable<T> = T extends (...args: any[]) => any
  ? T // 💡 优先判断：如果是函数，直接返回，保留调用签名
  : T extends (infer U)[]
    ? DeepWriteable<U>[] // 处理数组
    : T extends object
      ? { -readonly [P in keyof T]: DeepWriteable<T[P]> } // 处理普通对象
      : T;
  
  /**
   * 递归将所有属性变为 readonly（用于兼容用户传入的 as const）
   */
  export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T // 💡 保持函数可调用性
  : T extends (infer U)[]
    ? readonly DeepReadonly<U>[] // 数组加上 readonly
    : T extends object
      ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
      : T;

  export type ForceIdentity<T> = T extends object 
  ? { [K in keyof T]: T[K] } 
  : T;

 
export type FinalFlatten<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;


export type GetAllPath<T,Path = ''> = T extends object
?{
  [K in keyof T]:GetAllPath<T[K],Path extends ""?K:`${Path &string}.${K & string}`>
}[keyof T]
:Path;


export type KeysOfUnion<T> = T extends any ? keyof T : never;


export const createScheduler = (config = { frameQuota: 12 }) => {
  let lastYieldTime = performance.now();
  let taskCounter = 0;
  
  // 依然需要保留这个状态，因为 flushQueue 的 getNodeQuota 需要用到它！
  let isFirstFrame = false;

  const checkInputPending = () => {
    // @ts-ignore
    return !!(navigator?.scheduling?.isInputPending?.({ includeContinuous: true }));
  };
  
  return {
    // 必须保留，flushQueue 依赖它来决定是 return 8 还是 Infinity
    getIsFirstFrame: () => {
     
      return isFirstFrame
    },
    
    reset() {
      lastYieldTime = performance.now();
      taskCounter = 0;
      isFirstFrame = true; // 标记开始
    },

    shouldYield() {
      const now = performance.now();
      
      // =================================================================
      // 简化点：不再区分首帧/非首帧的时间策略
      // 因为首帧已经被 flushQueue 里的 (count >= 8) 给锁死了，
      // 这里只需要兜底防止后续帧(Infinity)跑太久。
      // =================================================================
      
      taskCounter++;
      
      // 采样率：每 5 次查一下时间，或者首帧每一次都查（虽然首帧通常跑不到第5次就break了）
      // 如果你想极简，甚至可以去掉 taskCounter，每次都查 performance.now() 也没多大开销
      if (taskCounter >= 5 || isFirstFrame) {
          taskCounter = 0; // 重置计数
          
          const elapsed = now - lastYieldTime;

          // 统一的时间底线 (12ms)，保证 FPS
          if (elapsed > config.frameQuota) {
            return true;
          }
  
          // 输入嗅探 (有用户交互就让路)
          if (checkInputPending()) {
            return true;
          }
      }
      return false;
    },

    async yieldToMain() {
      return new Promise<void>((resolve) => {
        nextMacroTick(()=>{
          lastYieldTime = performance.now();
          taskCounter = 0;
          
         
          // 🚨 关键：切片归来，首帧保护期结束
          // 这样下一次 flushQueue 里的 getNodeQuota 就会返回 Infinity
          if (isFirstFrame) isFirstFrame = false; 
          
          resolve();
        })
      });
    }
  };
};

export const nextMacroTick = (fn: () => void) => {
  // MessageChannel 比 setTimeout(0) 快，且优先级略高，完美适合做任务切断
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = fn;
  port2.postMessage(null);
};



