import { useScheduler } from "@/utils/core/engine/useScheduler";
import { MeshPath } from "@/utils/core/types/types";
import { MeshFlowTaskNode } from "@/utils/core/types/types";

export function useFlowLayout(
  
){

  let data:any[]  = []  

  for(let i = 0;i<3;i++){
    const path = `zone${i}`;

    let obj = {
      path: path,
      type: "zone",
     
      state: { 
        value: 300, 
        currentLoad:0,
        capacity:0,
        children:[]
      },
      meta: {
        currentLoad:0,
        children:[]
       },
     
      notifyKeys: new Set([ ]),
      
    }
    data.push(obj)
 
  }

  for(let i = 0 ;i<19;i++){
    const path = `box${i}`;
    const num = Math.random();
    const priority = num>0.7 ? 3
    :num>0.3 ? 2
    :1
    const width = priority==3?100:priority==2?80:50
    const maxAmount = priority==3?90:priority==2?70:40

    const obj = {
      path:path,
      type:'box',
      state:{
        parent:"",
        width:width,
        height:50,
        maxAmount:maxAmount,
        parentPos:{},
        pos:{}
      },
      meta:{},
      notifyKeys: new Set([ ]),
    }
    data.push(obj)
  }

  const judgement = {
    path:'judgement',
    type:'judgement',
    state:{
      zoneState:{}
    },
    meta:{
      zoneState:{}
    },
    notifyKeys: new Set([]),
  }

  data.push(judgement);


  const useFlowLayoutModule = <T,P extends MeshPath>(
    scheduler: ReturnType<typeof useScheduler<T, P>>,
    rootSchema:any[]
  )=>{
    const ZoneArray = [];
    const BoxArray :MeshFlowTaskNode<P>['proxy'][] = []
    let judgementNode = null;
    for(let item of rootSchema){
      const node = scheduler.registerNode(item);
    
      if(node.type==='zone'){
        ZoneArray.push(node.createView())
      }
      if(node.type==='box'){
        BoxArray.push(node.createView())
      }
      if(node.type==='judgement'){
        judgementNode = node.createView()
      }
    }

    return {
      ZoneArray,
      BoxArray,
      judgementNode
    }
  }
 
  return {
    data ,
    useFlowLayoutModule
  }
}