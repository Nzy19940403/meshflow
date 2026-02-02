const useCreateHooks = <T>()=>{
    const cbs:Array<(data:T)=>void> = [];
    return {
        on: (cb: (data: T) => void) => {
            cbs.push(cb);
            return () => {
                const i = cbs.indexOf(cb);
                if (i > -1) cbs.splice(i, 1);
            };
        },
        call: (data: T) => cbs.forEach(fn => fn(data))
    }
}

export {useCreateHooks}