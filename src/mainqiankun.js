if (window.__POWERED_BY_QIANKUN__) {
    // 动态设置 Webpack 异步加载资源的前缀
    __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__;
}
import { createApp } from 'vue';
import App from './App.vue';
 
import PrimeVue from 'primevue/config';
import Lara from '@primeuix/themes/lara';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';

import "./styles/main.css"

import { createWebHistory, createRouter ,createWebHashHistory} from 'vue-router'
import AboutComponet from './components/About.vue'
import HomeComponet from './components/Home.vue'
import AnimateOnScroll from 'primevue/animateonscroll';
import ConfirmationService from 'primevue/confirmationservice';

 


let app = null;

function render(props = {}) {
    const { container } = props;


    app = createApp(App);

    app.use(PrimeVue, {
        // Default theme configuration
        theme: {
            preset: Lara,
            options: {
                prefix: 'p',
                // 改为 '.v-theme--dark'，让 PrimeVue 跟着 Vuetify 的类名走
                // 或者简单地设为 '.dark'，然后在根节点手动切换
                darkModeSelector: '.dark',
                cssLayer: {
                    name: 'primevue',
                    order: 'tailwind-base, vuetify,primevue' // 明确样式优先级
                }
            }
        }
    });
    app.use(ConfirmationService);


    const routes = [
        { path: '/', component: HomeComponet },
        { path: '/About', component: AboutComponet },
    ]
    
    const router = createRouter({
        history: createWebHistory('/vueappwebpack'),
        routes,
    })
    
    const vuetify = createVuetify({

        theme: {
            defaultTheme: 'dark', // 'light' | 'dark' | 'system'
        },
        icons: {
            defaultSet: 'mdi',
            aliases,
            sets: {
                mdi,
            },
        },
    
    });

    app.directive('animateonscroll', AnimateOnScroll)
    app.use(vuetify);

    app.use(router);
    app.mount(container ? container.querySelector('#app') : '#app');

    document.documentElement.classList.add('dark');
}

 

// 独立运行时直接挂载
if (!window.__POWERED_BY_QIANKUN__) {
    render();

}
 

export async function bootstrap() {
    console.log('[vue] vue app bootstraped');
}

export async function mount(props) {
    console.log('[vue] props from main framework', props);
    render(props);
}

export async function unmount() {
    app.unmount();
    app = null;

     
} 