import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
 


precacheAndRoute(self.__WB_MANIFEST || []); 


 
// 2. 生命周期逻辑：立即接管客户端（配合客户端的 skipWaiting）
clientsClaim(); 

// 监听来自客户端 Manager 的消息，执行 skipWaiting 强制激活
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] 收到 SKIP_WAITING 指令，正在强制激活...');
        self.skipWaiting();
    }
});

