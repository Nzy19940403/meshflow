import { useCreateHooks } from "./useCreateHook";
import {MeshErrorContext} from '../types/types';

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