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

        const oldToken = curToken;

        if(updateTokenFn){
            curToken = updateTokenFn();
        };
        const startTime = performance.now();

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
 
        const duration = performance.now() - startTime;

        // 🌟🌟🌟 最佳发射位置：任务刚成真，点火扩散前 🌟🌟🌟
        // 此时拿到了耗时，并且可以通过双代币完美指明因果接力关系
        hooks.emit(MeshFlowEventsName.TransactionProgress, {
            fromToken: oldToken, // 告诉 Logger：上一个波次可以安全全额清算了
            toToken: curToken,   // 告诉 Logger：接下来的这个新代币是事务链的一环，别删账本
            duration: duration   // 这一阶段任务的净耗时
        });

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