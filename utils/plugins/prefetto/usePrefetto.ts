const usePerfetto = () => {
    let events: any[] = [];
    let startTime = 0;

    const getTs = () => (performance.now() - startTime) * 1000; // 微秒

    const apply = (api: { 
        on: (event: any, cb: (data: any) => void) => void 
    }) => {
        // 1. 流程启动：重置基准时间
        api.on('flow:start', () => {
            events = [];
            startTime = performance.now();
            events.push({
                name: "Flow Execution",
                ph: "M", // Metadata
                ts: 0, pid: 1, tid: 1,
                args: { name: "MeshFlow" }
            });
        });

        // 2. 节点执行：Begin / End 模式
        api.on('node:start', ({ path }) => {
            events.push({
                name: path,
                cat: 'node-execution',
                ph: 'B', // Begin
                ts: getTs(),
                pid: 1, tid: 1
            });
        });

        api.on('node:success', ({ path }) => {
            events.push({
                name: path,
                cat: 'node-execution',
                ph: 'E', // End
                ts: getTs(),
                pid: 1, tid: 1
            });
        });

        api.on('node:error', ({ path, error }) => {
            events.push({
                name: path,
                cat: 'node-execution',
                ph: 'E', // End (即使报错也要闭合区间)
                ts: getTs(),
                pid: 1, tid: 1,
                args: { error: error?.message || 'unknown error' }
            });
        });

        // 3. 拦截与调度：使用 Instant (标记) 模式
        api.on('node:intercept', ({ path, type }) => {
            events.push({
                name: `Intercept: ${path}`,
                cat: 'scheduler',
                ph: 'i', // Instant
                s: 'g',  // Global scope
                ts: getTs(),
                pid: 1, tid: 1,
                args: { type }
            });
        });

        api.on('flow:fire', ({ path, detail }) => {
            events.push({
                name: `Fire: ${path}`,
                cat: 'scheduler',
                ph: 'i',
                s: 'p', // Process scope
                ts: getTs(),
                pid: 1, tid: 1,
                args: { remaining: detail.remaining }
            });
        });

        // 4. 计数器：观察正在处理的任务数 (非常有用的并发视图)
        api.on('node:processing', ({ path }) => {
            // 这里可以记录一个 Counter 事件，查看并发曲线
            // 但为了简单，暂不实现复杂的 Counter 逻辑
        });

        // 5. 流程结束：打印提示（或者自动下载）
        api.on('flow:success', ({ duration }) => {
            console.log(`%c📊 Perfetto Trace Ready! %cExecute %cwindow.downloadTrace()%c to export.`, 
                "color: #fff; background: #9c27b0; padding: 2px 4px; border-radius: 4px", 
                "color: #9c27b0", "font-weight: bold; color: #ff5722", "color: #9c27b0");
            
            // 挂载到全局方便在控制台随时下载
            (window as any).downloadTrace = download;
        });
    }

    const download = () => {
        const blob = new Blob([JSON.stringify(events)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `meshflow_trace_${Date.now()}.json`;
        link.click();
    };

    return { apply, download };
}

export { usePerfetto };