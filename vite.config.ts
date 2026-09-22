import { defineConfig } from "vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

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

  // P2-14 队列 8e：按依赖域静态分片（编辑器栈 / Tauri API / 应用默认包），
  // 单包保持 500 kB 警戒线之下；规格见 frontend-bundle-structure。
  build: {
    rollupOptions: {
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
