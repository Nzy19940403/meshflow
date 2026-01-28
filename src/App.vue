<template>
  <VLayout>
    <!-- <v-system-bar window>
      <v-icon icon="mdi-wifi-strength-4"></v-icon>
      <v-icon icon="mdi-signal" class="ms-2"></v-icon>
      <v-icon icon="mdi-battery" class="ms-2"></v-icon>

      <span class="ms-2">{{ currentTime }}</span>
    </v-system-bar> -->
    <VAppBar>
      <div class="w-10/12 max-w-[1440px] mx-auto flex justify-center items-center">
 
        <v-tabs v-model="tab" align-tabs="center" color="deep-purple-accent-4">
          <v-tab to="/" value="/">
            
            主页</v-tab>
          <v-tab to="/Editor" value="/Editor">表单</v-tab>
          <!-- <v-tab to="/" value="/">
            
            表单</v-tab> -->
         

        </v-tabs>
      </div>

    </VAppBar>
    <VMain class="bg-neutral-900 w-full min-h-screen">
      <ConfirmDialog></ConfirmDialog>
      <div class="flex flex-col w-full h-full items-center">
        <div class="w-12/12 flex-grow  bg-neutral-950 shadow-md rounded-2xl ">
          <v-tabs-window v-model="tab" class="h-full">
            <v-tabs-window-item :value="tab" class="h-full p-8">
              <router-view> </router-view>
            </v-tabs-window-item>
          </v-tabs-window>
         
        </div>
      </div>
    </VMain>

  </VLayout>
</template>
  
<script setup>
import { ref } from 'vue';

import Menubar from 'primevue/menubar';
import { useRouter } from 'vue-router'

import UpdateServiceSingleton from '../sw.manager'
import { useConfirm } from "primevue/useconfirm";
import { VSystemBar, VIcon, VMain, VLayout, VTab } from 'vuetify/lib/components';

import ConfirmDialog from 'primevue/confirmdialog';
import { VAppBar } from 'vuetify/lib/components';
import { VTabsWindow } from 'vuetify/lib/components';
import { VTabsWindowItem } from 'vuetify/lib/components';
import { onMounted } from 'vue';
import { onUnmounted } from 'vue';
 

const tab = ref('/')

const router = useRouter()
const confirm = useConfirm();

let updateTimeId = null;
let lastSecond = -1;
const currentTime = ref('');

 

const confirmSW = (confirmFn) => {
  confirm.require({
    message: '检测到新版本，是否同意更新?',
    header: 'Confirmation',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: '取消更新',
      severity: 'secondary',
      outlined: true
    },
    acceptProps: {
      label: '确认更新'
    },
    accept: () => {
      confirmFn()

    },
    reject: () => {

    }
  });
};



const items = ref([
  {
    label: '主页',
    icon: 'pi pi-home',
    route: '/',
  },
  {
    label: '报价表单',
    icon: 'pi pi-link',
    command: () => {
      if(__IS_PROD__){
        UpdateServiceSingleton.checkSWUpdate();
      }
      
      router.push('/Editor');
    }
  },
 
]);



const updateTime = ()=>{
  const now = new Date();
  const currentSecond = now.getSeconds();

  // 性能优化：只有当秒数发生变化时，才更新响应式数据
  if (currentSecond !== lastSecond) {
    currentTime.value = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      // second: 'numeric', // 如果不需要秒数，可以去掉
      hour12: false
    }).format(now);
    
    lastSecond = currentSecond;
  }



  updateTimeId = requestAnimationFrame(updateTime)
}



onMounted(() => {
  if(__IS_PROD__){
    // UpdateServiceSingleton.setUpdateNotificationCallback(confirmSW)
  };

  requestAnimationFrame(updateTime)
  

});

onUnmounted(()=>{
  if(updateTimeId){
    cancelAnimationFrame(updateTimeId);
  }
})

</script>

 
  