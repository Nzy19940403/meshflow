<template>

    <v-bottom-navigation>
      <v-btn>
        1
      </v-btn>
      <v-btn>
        2
      </v-btn>
      <v-btn>
        3
      </v-btn>
    </v-bottom-navigation>
  
  </template>
  
  <script setup>
  import { ref } from 'vue'
  import { VBtn,VBottomNavigation,VCard,VApp,VAppBar} from 'vuetify/components'
  
  defineProps({
    msg: String,
  })
  
  const count = ref(0)
  </script>
  
  
  
  <style scoped></style>
  