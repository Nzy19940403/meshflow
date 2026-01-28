if (window.__POWERED_BY_QIANKUN__) {
    // 动态设置 Webpack 异步加载资源的前缀
    __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__;
}
const renderPromise = import('./bootstrap'); 

const lifecycle = {
    async bootstrap() {
        console.log('[vue] vue app bootstraped');
    },
    async mount(props) {
        const { RenderApp } = await renderPromise;
        RenderApp(props);
    },
    async unmount() {
        const { CloseApp } = await renderPromise;
        CloseApp();
    }
};

 

// 3. 正常的 ESM 导出 (供 Webpack 静态分析和其他模块 import)
export const { bootstrap, mount, unmount } = lifecycle;

// export async function bootstrap() {
//     console.log('[vue] vue app bootstraped');
// }

// export async function mount(props) {
//     console.log('[vue] props from main framework', props);
//     const { RenderApp } = await renderPromise;
//     RenderApp(props);
// }

// export async function unmount() {
//     const { CloseApp } = await renderPromise;
//     CloseApp();
// } 

// // 3. 独立运行时的逻辑
if (!window.__POWERED_BY_QIANKUN__) {
  renderPromise.then(({RenderApp}) => {
    RenderApp({reigsterSW:__IS_PROD__});
  });
};
 