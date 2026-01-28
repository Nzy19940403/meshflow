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