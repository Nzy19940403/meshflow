import { Workbox } from 'workbox-window';

// ----------------------------------------------------
// 工厂函数：创建 Service Manager 实例 (供测试/生产环境使用)
// ----------------------------------------------------
export function createUpdateService() {
    
    let updateNotificationCallback = null; 
    let wb = null; // Workbox 实例
    let reloadHandler = null; // 用于确保 'controlling' 监听只绑定一次

    // --- 内部函数：设置刷新监听器 (确保只执行一次) ---
    function setupReloadListener() {
        if (reloadHandler) return; // 已经绑定，直接退出

        // 定义一次性的监听器函数
        reloadHandler = () => {
            console.log("Workbox 控制权切换完成，正在刷新页面...");
            
            // 移除自身监听，防止重复执行
            wb.removeEventListener('controlling', reloadHandler);
            reloadHandler = null; 
            
            // 执行页面刷新
            window.location.reload();
        };

        // 绑定监听器
        wb.addEventListener('controlling', reloadHandler);
    }

    // --- 内部函数：用户确认更新时触发 ---
    function confirmUpdate() {
    
        if (wb) { 
            // 启动刷新监听器
            setupReloadListener();
            // 向 SW 发送 skipWaiting 消息，强制激活
            wb.messageSkipWaiting(); 
        }
    }

    // --- 外部 API ---
    
    // 注册 Service Worker 并设置生命周期监听
    function registerServiceWorker(swUrl = '/sw.js') {
        if (!('serviceWorker' in navigator)) return;
        
        wb = new Workbox(swUrl); 
        

        // if (process.env.NODE_ENV === 'development') {
        //     setInterval(() => {
        //       wb.update();
        //     }, 3000);
        // }

        // 监听 Workbox 生命周期：发现新版本，进入 waiting 状态
        wb.addEventListener('waiting', () => {
            console.log("[SW Manager] 新版本已安装完成，等待中...");
            // 通知 UI 层弹出更新提示
            if (updateNotificationCallback) {
                updateNotificationCallback(confirmUpdate);
            }
        });
        
        // 注册
        wb.register().catch(error => {
            console.error('[SW Manager] Workbox 注册失败:', error);
        });
    }

    // 设置 UI 通知回调函数
    function setUpdateNotificationCallback(callback) {
        updateNotificationCallback = callback;
        // 如果 SW 已经发现更新，立即通知（处理回调函数注册晚于 SW 发现更新的情况）
        if (wb ) {
            callback(confirmUpdate);
        }
    }

    // 强制更新 API (用于 404/版本不匹配场景)
    function triggerForceUpdate() {
        if (wb ) {
             console.warn("[SW Manager] 强制更新触发。");
            confirmUpdate();
        } else {
            console.warn("[SW Manager] 无等待 worker，直接强制刷新作为兜底。");
            window.location.reload(true);
        }
    }
 
    function checkSWUpdate(){
        if(wb){
            wb.update();
        }
        
    }

    return {
        setUpdateNotificationCallback,
        registerServiceWorker,
        checkSWUpdate,
        triggerForceUpdate,
    };
}


// ----------------------------------------------------
// 3. 默认导出单例 (供应用开发环境使用)
// ----------------------------------------------------
const UpdateServiceSingleton = createUpdateService(); 
export default UpdateServiceSingleton; 