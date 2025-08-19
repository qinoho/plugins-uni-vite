import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "./index.ts"), // 插件入口
      name: "UniV3Plugin",                            // UMD全局变量名
      fileName: (format) => `uni-v3-plugin.${format}.js`, // 输出文件名
    },
    rollupOptions: {
      // 外部依赖（不打包进库里）
      external: ["@vue/compiler-sfc"],
      output: {
        globals: {
          "@vue/compiler-sfc": "@vue/compiler-sfc",
        },
      },
    },
  },
});
