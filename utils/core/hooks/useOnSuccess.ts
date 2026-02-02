import { useCreateHooks } from "./useCreateHook";

function useOnSuccess(){
    const {on:onSuccess,call:callOnSuccess} = useCreateHooks();
    return {onSuccess,callOnSuccess}
}

export {
    useOnSuccess
}