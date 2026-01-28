// @ts-nocheck
import { onMounted, onUnmounted } from 'vue'
import Stats from 'stats.js'

export function useStats() {
  const stats = new Stats()
  
  // 设置面板模式
 
  stats.showPanel(0) 

  onMounted(() => {
    // 将监控面板添加到页面左上角
    stats.dom.style.position = 'fixed'
    stats.dom.style.top = '0px'
    stats.dom.style.left = '0px'
    stats.dom.style.zIndex = '9999'
    document.body.appendChild(stats.dom)

    const update = () => {
      stats.begin()
      // 这里的代码块就是你想要监控的“渲染循环”
      // 在 Vue 中，它会自动监控主线程的每一帧更新
      stats.end()
      window._statsId = requestAnimationFrame(update)
    }
    
    update();
  })

  onUnmounted(() => {
    // 组件卸载时销毁，防止内存泄漏
    cancelAnimationFrame(window._statsId)
    document.body.removeChild(stats.dom)
  })
}