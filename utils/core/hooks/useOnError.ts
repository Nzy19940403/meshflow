import { useCreateHooks } from "./useCreateHook";

export interface MeshErrorContext {
    path: string;
    info: any;
}
type Unsubscribe = () => void;
interface UseOnErrorReturn {
    onError: (cb: (error: MeshErrorContext) => void) => Unsubscribe;
    callOnError: (error: MeshErrorContext) => void;
}

function useOnError():UseOnErrorReturn{
    const {on:onError,call:callOnError} = useCreateHooks<MeshErrorContext>()
 

    return {onError,callOnError}
    
}

export {useOnError}