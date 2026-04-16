import { MeshEmit, MeshFlowEventsName, TransactionArray } from "../types/types";


export const createTransactionScheduler = (
    initBatchNotify:any,
    hooks:{
        emit:MeshEmit,
        callOnError:any
    }
)=>{
    let updateTokenFn:()=>symbol;
    let curToken:symbol|null;
    let batchNotify:any = null;

    let tasks:TransactionArray = [];
    let isTaskProcessing:boolean = false;
    

    const settleTasks = ( array: TransactionArray )=>{
        if(!batchNotify){
            batchNotify = initBatchNotify();
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
        console.log('runNext')
        if(updateTokenFn){
            curToken = updateTokenFn();
        }
        const res = await new Promise((resolve,reject)=>{
            try{
                task!(resolve,reject);
            }catch(err){
                hooks.callOnError(err);
                reset();
            }
        });
         
        batchNotify(res);
        
        return false
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