import { MeshEmit, MeshFlowEventsName, MeshPath, SuggestKey, TransactionArray, notifyArgs } from "../types/types";


export const createTransactionScheduler = <P,NM>(
    initBatchNotify:()=>(updates: {
        path: P;
        key: SuggestKey<NM>;
        value: any;
    }[]) => void,
    initNotify:()=>(path:P,key:SuggestKey<NM>)=>void,
    hooks:{
        emit:MeshEmit,
        callOnError:any
    }
)=>{
    let updateTokenFn:()=>symbol;
    let curToken:symbol|null;
    let batchNotify:any = null;
    let notify:any = null;

    let tasks:TransactionArray<P,NM> = [];
    let isTaskProcessing:boolean = false;
    

    const settleTasks = ( array: TransactionArray<P,NM> )=>{
        if(!batchNotify){
            batchNotify = initBatchNotify();
        }
        if(!notify){
            notify = initNotify();
        }
        reset();

        tasks = array;
        isTaskProcessing = true;
        runNext();     
    };

    const runNext = async ()=>{
        let task = tasks.shift();

        if(!task) {
            isTaskProcessing = false;
            return true
        };
         
        if(updateTokenFn){
            curToken = updateTokenFn();
        }
        const res:notifyArgs<MeshPath,NM>|notifyArgs<MeshPath,NM>[]  = await new Promise((resolve,reject)=>{
            try{
                task!(resolve,reject);
            }catch(err){
                hooks.callOnError(err);
                reset();
            }
        }) ;
  
        if (res === undefined) {
            return false;
        };
 
        if (Array.isArray(res)) {
            if (res.length > 0) {
                batchNotify(res);
            }
        } else if (typeof res === 'object' && res !== null) {
           
            notify(res.path,res.key); 
        };
        
        return false;
    }
  
    const apply = (fn:()=>symbol)=>{
      updateTokenFn = fn;
    }
  
    const takeover = (token:symbol)=>{
      if (curToken !== null && curToken === token) {
        if (tasks.length === 0) {
            curToken = null; 
            return false;    
        }
        return true;
      }
      return false;
    }

    const reset = ()=>{
     
        if(isTaskProcessing){
           
            hooks.emit(MeshFlowEventsName.TransactionAbort)
        }
      
        tasks.length = 0;
        curToken = null;
        isTaskProcessing = false
    }
  
    return {
      settleTasks,
      apply,
      takeover,
      runNext,
      reset
    }
  }