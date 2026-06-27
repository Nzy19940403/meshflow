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
    /**
     * MUST run before Vite's built-in resolver (enforce: 'pre').
     * This intercepts `../forms/useMeshForm` before Vite resolves it to an
     * absolute path, rewriting it to the bare specifier `@meshflow/form`
     * so Rollup externalizes it correctly.
     */
    {
      name: 'remap-meshflow-form',
      enforce: 'pre',
      resolveId(id) {
        if (
          id === '../forms/useMeshForm' ||
          id.endsWith('/utils/forms/useMeshForm') ||
          id.endsWith('\\utils\\forms\\useMeshForm')
        ) {
          return { id: '@meshflow/form', external: true }
        }
      },
    },
    vue(),
    dts({
      outDir: 'lib-form-vue',
      // Strip the utils/meshform-vue/ prefix so declarations land at lib-form-vue/index.d.ts
      // instead of lib-form-vue/meshform-vue/index.d.ts
      entryRoot: 'utils/meshform-vue',
      include: [
        'utils/meshform-vue/**/*.ts',
        'utils/meshform-vue/**/*.vue',
      ],
      // Replace the local relative import path with the published package name
      // so the generated .d.ts files work for consumers of @meshflow/form-vue
      beforeWriteFile: (filePath, content) => ({
        filePath,
        content: content
          .replace(/from ['"]\.\.\/forms\/useMeshForm['"]/g, "from '@meshflow/form'")
          .replace(/from ['"]\.\.\/\.\.\/forms\/useMeshForm['"]/g, "from '@meshflow/form'"),
      }),
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
       */
      external: (id) => {
        const peers = [
          'vue', 'vuetify',
          '@jsonforms/vue', '@jsonforms/core',
          '@meshflow/core', '@meshflow/form',
        ]
        if (peers.some((p) => id === p || id.startsWith(p + '/'))) return true
        return false
      },

      output: {
        globals: {
          vue: 'Vue',
          vuetify: 'Vuetify',
        },
      },
    },
  },
})
