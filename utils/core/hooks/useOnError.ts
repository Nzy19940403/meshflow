interface MeshErrorContext {
    path: string;
    info: any;
}
type Unsubscribe = () => void;
interface UseOnErrorReturn {
    onError: (cb: (error: MeshErrorContext) => void) => Unsubscribe;
    callOnError: (error: MeshErrorContext) => void;
}

function useOnError():UseOnErrorReturn{
    const onErrorFunctions:Array<(error:any)=>void> = []
    
    const onError = (cb:(error:MeshErrorContext)=>void)=>{
        const cbWrapper = (errorInfo:MeshErrorContext)=>{
            return cb(errorInfo as MeshErrorContext)
        }
        onErrorFunctions.push(cbWrapper);

        return ()=>{
            let index = onErrorFunctions.findIndex((item)=>item===cbWrapper);
            onErrorFunctions.splice(index,1)
         
        }
    }

    const callOnError = (error:MeshErrorContext)=>{
       
        for(let fn of onErrorFunctions){
          
            fn(error)
        }
    }

    return {onError,callOnError}
    
}

export {useOnError}