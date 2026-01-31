import { onUnmounted } from 'vue';

/**
 * 防抖 Hook
 * @param fn 需要防抖执行的函数
 * @param delay 延迟时间（毫秒）
 */
export function useDebounce<T extends (...args: any[]) => any>(
  fn: T, 
  delay: number = 300
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 清除定时器的内部函数
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // 包装后的防抖函数
  const debouncedFn = (...args: Parameters<T>) => {
    clear();
    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  };

  // 【核心格式要求】在组件销毁时自动清理，防止后台还在跑定时器
  onUnmounted(() => {
    clear();
  });

  // 返回包装后的函数
  return debouncedFn;
}