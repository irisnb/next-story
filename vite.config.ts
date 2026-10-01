import { defineConfig } from "vite";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // 多页入口：主应用 index.html ＋ PDF 打印页 print.html（隐藏 print-window 加载，
  // add-pdf-and-markdown-export design 决策 3：打印页与应用同源、共用捆绑资产）。
  build: {
    rollupOptions: {
      input: {
        main: resolve(projectRoot, "index.html"),
        print: resolve(projectRoot, "print.html"),
      },
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined; // 应用代码走默认包
          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("linkifyjs")) {
            return "editor-vendor";
          }
          if (id.includes("@tauri-apps")) {
            return "tauri-vendor";
          }
          return undefined; // 其余零散 npm 依赖归默认包
        },
      },
    },
  },
}));
