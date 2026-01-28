import { createApp } from 'vue'
import CustomButtonNavigation from '../src/components/CustomButtonNavigation.vue'
import { createVuetify } from 'vuetify'
// import 'vuetify/styles'

export function mount(container) {
    const shadowRoot = container.attachShadow({ mode: 'open' })

    // 加载 Vuetify 样式
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.crossOrigin = 'anonymous'; 
    link.href = 'https://cdn.jsdelivr.net/npm/vuetify@3.5.17/dist/vuetify.min.css'
    shadowRoot.appendChild(link)
  
    // 创建一个实际挂载点
    const mountEl = document.createElement('div')
    shadowRoot.appendChild(mountEl)
  
    const vuetify = createVuetify()
    const app = createApp(CustomButtonNavigation)
    
  
    // app.mount(mountEl)
  
    link.onload = () => {
        app.use(vuetify);
        app.mount(mountEl);
    }

    link.onerror = () => {
        console.error('[Error] Failed to load Vuetify CSS')
    }

    return {
      unmount() {
        app.unmount()
        const newEl = container.cloneNode(false)
        container.replaceWith(newEl);
      }
    }
}