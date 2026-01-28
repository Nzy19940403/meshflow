import { createApp } from 'vue'
import App from './App.vue'
import PrimeVue from 'primevue/config';
import Lara from '@primeuix/themes/lara';
import { createWebHistory, createRouter } from 'vue-router'
 
import HomeComponet from './components/Home.vue'
import ConfirmationService from 'primevue/confirmationservice';
// import UpdateServiceSingleton from '../sw.manager'
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import "./styles/main.css"
import '../devSchemaConfig/dev.form.Schema.check'
import AnimateOnScroll from 'primevue/animateonscroll';

let app = null;

export const RenderApp = (props = {}) => {
    const { container ,reigsterSW} = props;

  
 
    if (reigsterSW) {
        // console.log('sw注册');
       
        // UpdateServiceSingleton.registerServiceWorker()
    }

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
        { 
            path: '/Editor', 
            component: ()=>import('@/src/components/EditorLayout.vue'),
            children:[
       
                {
                    path:'',
                    name: 'EditorForm',
                    component:()=> import('./components/Editor.vue')
                },
                {
                    path:'Dependency',
                    name: 'DependencyGraph',
                    component:()=> import('./components/EditorDependency.vue')
                }
            ]
        },
    ]

    const router = createRouter({
        history: createWebHistory(window.__POWERED_BY_QIANKUN__?'/vueappwebpack':'/'),
        routes,
    });

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

export const CloseApp = () => {
    if (app) {
        app.unmount();
        app = null;
    }
};


