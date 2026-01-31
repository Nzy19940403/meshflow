export type HistoryActionItem = {
    undoAction:()=>void
    redoAction:()=>void
}

export function useHistory(){

    const historyUndoList:Array<HistoryActionItem> = [];
    const historyRedoList:Array<HistoryActionItem> = [];
  

    const MaxStep = 100;

    const status = {
        canRedo:()=>{},
        canUndo:()=>{}
    }

    const Undo = ()=>{
        if(!historyUndoList.length) return;

        const actionItem = historyUndoList.pop() as HistoryActionItem;

        actionItem?.undoAction();
        PushIntoRedoHistory(actionItem);     
       
    };

    const Redo = ()=>{
        if(!historyRedoList.length) return;
        const actionItem = historyRedoList.pop() as HistoryActionItem;
      
        actionItem?.redoAction();
        PushIntoHistory(actionItem,false);
         
    };

    const initCanUndo = (cb:(newVal:number)=>any)=>{
       
        status.canUndo = ()=>cb(historyUndoList.length);
        
    }

    const initCanRedo = (cb:(newVal:number)=>any)=>{
        status.canRedo = ()=> cb(historyRedoList.length);
    }

    const PushIntoRedoHistory = (action:HistoryActionItem)=>{
        historyRedoList.push(action);
        if(historyRedoList.length>MaxStep){
            historyRedoList.shift();
        }
        //调用canRedo ，执行回调来让ui层修改当前redolist的长度
        status.canRedo();
        status.canUndo();
    }

    const PushIntoHistory = (action:HistoryActionItem,cleanRedo:boolean = true)=>{
        if(cleanRedo){
            //如果外层重新操作了之后就会清空redolist
            historyRedoList.length = 0;
           
        }
        historyUndoList.push(action);
        
        if(historyUndoList.length>MaxStep){
            historyUndoList.shift();
        }
        //调用canUndo ，执行回调来让ui层修改当前undolist的长度
        status.canUndo();
        status.canRedo();
    };

    const CreateHistoryAction = ( 
        metadata:[{path:string,value:any},{path:string,value:any}],
        cb:any
    )=>{
        //cb就是修改对应path为指定value的函数
        const [oldActionMetaData,newActionMetaData] = metadata;
        const undoAction = ()=>cb(oldActionMetaData);
        
        const redoAction = ()=>cb(newActionMetaData);

        return {
            undoAction,
            redoAction
        }
    }

    return {
        Undo,
        Redo,
        PushIntoHistory,
        CreateHistoryAction,
        initCanUndo,
        initCanRedo
    }
}