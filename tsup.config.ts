// @ts-nocheck
import { defineConfig } from "tsup";
import fs from "fs";
import path from "path";
import { execSync } from 'node:child_process'

export default defineConfig([
  {
    // 1. 核心配置：将 useEngineManager 重命名为 index 导出
    entry: {
      index: "utils/core/engine/useEngineManager.ts",
    },
    // 2. 规定输出到你的专属库目录
    outDir: "lib-dist",
    format: ["cjs", "esm"],
    dts: true, // 自动生成 index.d.ts
    clean: true,
    minify: true,
    // minify: "terser",
    // terserOptions: {
    //   mangle: {
    //     properties: {
    //       // ⚠️ 这里开启了最强压缩：
    //       // 凡是以下划线开头的属性名，全部压缩成 a, b, c...
    //       regex: /^_/, 
    //     },
    //   },
    // },
    pure: ["console.log", "console.warn", "console.error"],
    // 1. 关闭 SourceMap (减少构建产物中的 .map 文件，虽然不影响运行体积，但发布包会更干净)
    sourcemap: false,

    // 2. 禁用代码分割 (强制将所有逻辑打包进单个 index.js，适合你这种小型核心库)
    splitting: false,

    // 3. 开启摇树优化 (确保虽然不分包，但没用到的死代码会被剔除)
    treeshake: true,
 
    // 2. 指定现代目标（核心！）
    // 设为 'esnext' 或 'es2022'。
    // 如果设得太低（比如 es5），tsup 会插入大量“兼容补丁代码”来模拟 async/await。
    target: "esnext",
    onSuccess: async () => {
      // 拷贝 package.json 的逻辑保持不变
      const pkgPath = path.resolve(__dirname, "utils/core/package.json");
      const destPath = path.resolve(__dirname, "lib-dist/package.json");
      if (fs.existsSync(pkgPath)) {
        fs.copyFileSync(pkgPath, destPath);
      }
      console.log("🚀 打包完成：产物名为 index.js / index.cjs / index.d.ts");
      console.log("✅ Library-specific README copied.");

      const mdsrcPath = path.resolve(__dirname, "utils/core/readme.md");
      const mddestPath = path.resolve(__dirname, "lib-dist/README.md");

      fs.copyFileSync(mdsrcPath, mddestPath);
      console.log("✅ README copied successfully using fs.copyFileSync");


      const licensesrcPath = path.resolve(__dirname, "utils/core/LICENSE.txt");
      const licensedestPath = path.resolve(__dirname, "lib-dist/LICENSE.txt");

      fs.copyFileSync(licensesrcPath, licensedestPath);
      execSync('npx typedoc', { stdio: 'inherit' })

    },
  },
  {
    entry:{
      index:'utils/plugins/logger/useLogger.ts'
    },
    outDir: 'lib-plugins/logger',
    format: ['cjs', 'esm'],
    external: ["consola"],
    dts: true,
    minify: true,
    clean: true,
    onSuccess: async () => {
      // 拷贝 package.json 的逻辑保持不变
      const pkgPath = path.resolve(__dirname, "utils/plugins/logger/package.json");
      const destPath = path.resolve(__dirname, "lib-plugins/logger/package.json");
      if (fs.existsSync(pkgPath)) {
        fs.copyFileSync(pkgPath, destPath);
      }
 
    },
  },
  {
    entry:{
      index:'utils/plugins/history/useHistory.ts'
    },
    outDir: 'lib-plugins/history',
    format: ['cjs', 'esm'],
    dts: true,
    minify: true,
    clean: true,
    onSuccess: async () => {
      // 拷贝 package.json 的逻辑保持不变
      const pkgPath = path.resolve(__dirname, "utils/plugins/history/package.json");
      const destPath = path.resolve(__dirname, "lib-plugins/history/package.json");
      if (fs.existsSync(pkgPath)) {
        fs.copyFileSync(pkgPath, destPath);
      }
 
    },
  },
  {
    entry:{
      index:'utils/plugins/meshRenderGate/useMeshRenderGate.ts'
    },
    outDir: 'lib-plugins/renderGate',
    format: ['cjs', 'esm'],
    external: ["@meshflow/core"],
    dts: true,
    minify: true,
    clean: true,
    onSuccess: async () => {
      // 拷贝 package.json 的逻辑保持不变
      const pkgPath = path.resolve(__dirname, "utils/plugins/meshRenderGate/package.json");
      const destPath = path.resolve(__dirname, "lib-plugins/renderGate/package.json");
      if (fs.existsSync(pkgPath)) {
        fs.copyFileSync(pkgPath, destPath);
      }
 
    },
  },
  {
    entry:{
      index:'utils/plugins/meshPulse/useMeshPulse.ts'
    },
    outDir: 'lib-plugins/meshPulse',
    format: ['cjs', 'esm'],
    external: ["@meshflow/core"],
    dts: true,
    minify: true,
    clean: true,
    onSuccess: async () => {
      // 拷贝 package.json 的逻辑保持不变
      const pkgPath = path.resolve(__dirname, "utils/plugins/meshPulse/package.json");
      const destPath = path.resolve(__dirname, "lib-plugins/meshPulse/package.json");
      if (fs.existsSync(pkgPath)) {
        fs.copyFileSync(pkgPath, destPath);
      }
 
    },
  },
  {
    entry:{
      index:'utils/forms/useMeshForm.ts'
    },
    outDir:'lib-form',
    format: ["cjs", "esm"],
    dts: true, // 自动生成 index.d.ts
    clean: true,
    minify: true,
    pure: ["console.log", "console.warn", "console.error"],
    sourcemap: false,
    splitting: false,
    treeshake: true,
    target: "esnext",
    external: ["@meshflow/core"],
    onSuccess: async () => {
      // 拷贝 package.json 的逻辑保持不变
      const pkgPath = path.resolve(__dirname, "utils/forms/package.json");
      const destPath = path.resolve(__dirname, "lib-form/package.json");
   
      fs.copyFileSync(pkgPath, destPath);

      const mdsrcPath = path.resolve(__dirname, "utils/forms/readme.md");
      const mddestPath = path.resolve(__dirname, "lib-form/README.md");

      fs.copyFileSync(mdsrcPath, mddestPath);

      const licensesrcPath = path.resolve(__dirname, "utils/forms/LICENSE.txt");
      const licensedestPath = path.resolve(__dirname, "lib-form/LICENSE.txt");

      fs.copyFileSync(licensesrcPath, licensedestPath);
      console.log('form打包成功')

    },
  }
]);
