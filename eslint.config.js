import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "tests/**",
      "sidecar/**",
      "openspec/**",
      "tmp/**",
      // 离线捆绑的第三方静态资产（Paged.js 压缩版）：不是本仓库源码，不参与 lint。
      "public/vendor/**",
      // 本地工作目录（gitignored 的测试证据/草稿，不入库）：不是仓库源码，不参与 lint。
      "本地测试文档/**",
      ".omo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
