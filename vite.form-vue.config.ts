// @ts-nocheck
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'
import fs from 'fs'

/**
 * Vite lib-mode build for @meshflow/form-vue.
 *
 * Outputs to lib-form-vue/  (mirrors how tsup outputs lib-form/, lib-dist/, etc.)
 * External: vue, vuetify, @jsonforms/*, @meshflow/core, @meshflow/form
 * The relative import `../forms/useMeshForm` is remapped → `@meshflow/form` in output.
 */
export default defineConfig({
  plugins: [
    vue(),
    dts({
      outDir: 'lib-form-vue',
      include: [
        'utils/meshform-vue/**/*.ts',
        'utils/meshform-vue/**/*.vue',
      ],
      // Generate both .d.ts (CJS) and .d.mts (ESM)
      copyDtsFiles: false,
      afterBuild: () => {
        const src = resolve(__dirname, 'lib-form-vue/index.d.ts')
        const dst = resolve(__dirname, 'lib-form-vue/index.d.mts')
        if (fs.existsSync(src)) fs.copyFileSync(src, dst)
      },
    }),
    // Copy package.json into output dir so `npm publish` works from lib-form-vue/
    {
      name: 'copy-pkg',
      closeBundle() {
        fs.copyFileSync(
          resolve(__dirname, 'utils/meshform-vue/package.json'),
          resolve(__dirname, 'lib-form-vue/package.json'),
        )
        console.log('✅ @meshflow/form-vue 打包完成 → lib-form-vue/')
      },
    },
  ],

  build: {
    lib: {
      entry: resolve(__dirname, 'utils/meshform-vue/index.ts'),
      name: 'MeshflowFormVue',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.js'),
    },
    outDir: 'lib-form-vue',
    emptyOutDir: true,

    rollupOptions: {
      /**
       * Externalize everything the consumer is expected to have:
       * - vue / vuetify runtime
       * - @jsonforms/* (peer)
       * - @meshflow/core and @meshflow/form (peers)
       * - The relative path ../forms/useMeshForm (== @meshflow/form in consumer context)
       */
      external: (id) => {
        const peers = [
          'vue', 'vuetify',
          '@jsonforms/vue', '@jsonforms/core',
          '@meshflow/core', '@meshflow/form',
        ]
        if (peers.some((p) => id === p || id.startsWith(p + '/'))) return true
        // Catch both the raw relative string and the resolved absolute path
        if (id.includes('/utils/forms/') || id === '../forms/useMeshForm') return true
        return false
      },

      output: {
        // Remap the relative ../forms/useMeshForm → @meshflow/form in generated bundles
        paths: (id) => {
          if (id.includes('/utils/forms/') || id === '../forms/useMeshForm') {
            return '@meshflow/form'
          }
          return id
        },
        globals: {
          vue: 'Vue',
          vuetify: 'Vuetify',
        },
      },
    },
  },
})
