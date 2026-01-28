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

    console.log(container)
    console.log(123123123)
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

/*
1. 选项熔断需求 (Options Filtering)这是你目前正在攻克的部分。
触发路径：environment.compliance (合规性等级)。
目标路径：specs.storage.diskType (硬盘类型) 的 options 属性。
业务逻辑：当合规性为 financial 时，硬盘选项桶必须剔除 hdd，仅保留 ssd。
技术挑战：证词冲突：默认 Schema 里有一个 options 证词（含 HDD），联动又投递了一个 options 证词（不含 HDD）。
解决策略：建议使用 Priority 策略。给联动的 Rule 设置更高的 priority。
当联动触发时，桶 evaluate 直接返回高优先级的“精简版”数组。

2. 状态强控与回滚需求 (Value Overriding)触发路径：environment.compliance。
目标路径：security.encryption (全盘加密) 的 value。
业务逻辑：当合规性为 financial 时，强制将加密设为 yes。
关键点：此时用户在界面上应无法将其改回 no（可以配合 disabled 联动）。
回滚逻辑：当合规性切回 standard，加密状态应恢复到用户手动设置的值。
技术亮点：展示“桶”能同时存储“用户手动输入”和“系统强制干预”两份证词。

3. 跨层级动态显隐 (Visibility Control)触发路径：security.encryption。
目标路径：security.kmsKey (密钥 ID)。
业务逻辑：这是一个典型的“开关-内容”联动。
encryption === 'yes' -> hidden: false。encryption === 'no' -> hidden: true。
简历价值：展示 notify 系统如何精准控制 hidden 属性，且不影响 value 属性的桶。

4. 阶梯式价格计算 (Complex Aggregation)这是最复杂的数学逻辑，也是简历上的最高光点。
目标路径：totalPrice (总价) 的 value。
计算公式：$Total = (Base + RegionSurcharge) + (Capacity \times UnitPrice)$
多源输入：Rule 1 (来自机型)：instanceFamily 决定基础价格 (如 1000/2000/5000)。
Rule 2 (来自地域)：如果 region === 'global'，产生一个 Base * 0.2 的加价证词。
Rule 3 (来自容量)：capacity 每增加 1G，产生一个 0.5 的加价证词。
策略要求：必须使用 SUM 策略，将桶内所有活跃 Rule 的结果累加。
*/ 