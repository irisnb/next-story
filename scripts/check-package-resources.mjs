import { statSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';

const root = new URL('../', import.meta.url);
// 与 src-tauri/src/dsh_sidecar.rs 的 resolve_paths 保持一致。
// 产品只发行 Windows；校验脚本本身可在任意平台运行。
const resources = [
  'sidecar/node-runtime/node.exe',
  'sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js',
  'sidecar/driver/driver.mjs',
];

const results = resources.map((resource) => {
  try {
    return { resource, present: statSync(fileURLToPath(new URL(resource, root))).isFile() };
  } catch {
    return { resource, present: false };
  }
});

if (results.some(({ present }) => !present)) {
  console.error('打包资源不齐备，已中止。当前产品只发行 Windows 版。');
  for (const { resource, present } of results) {
    console.error(`[${present ? '通过' : '缺失'}] ${resource}`);
  }
  console.error('补救步骤（从仓库根目录运行）：');
  console.error('  安装 DSH 依赖：cd sidecar; npm ci（完成后回到仓库根目录）');
  console.error('  准备内置 Node：powershell -ExecutionPolicy Bypass -File scripts\\vendor-node.ps1');
  console.error('  若常驻驱动缺失，请恢复仓库中的 sidecar/driver/driver.mjs。');
  process.exitCode = 1;
} else {
  console.log('打包资源检查通过：内置 Node、DSH 入口与常驻驱动齐备。');
}
