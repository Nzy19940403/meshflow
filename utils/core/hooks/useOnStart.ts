import { useCreateHooks } from "./useCreateHook";

function useOnStart<P>(){
    const {on:onStart,call:callOnStart} = useCreateHooks<P>();
    return {onStart,callOnStart}
}

export {
    useOnStart
}