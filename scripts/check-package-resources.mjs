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
  // 捆绑字体（add-pdf-and-markdown-export design 决策 4）：编辑器与导出共用，
  // 随前端 dist 打包分发；OFL 许可证文本必须随包。
  'public/fonts/SourceHanSansCN-Regular.otf',
  'public/fonts/SourceHanSansCN-Bold.otf',
  'public/fonts/LICENSE.txt',
  // Paged.js 打印分页（design 决策 3）：版本锁定的离线静态脚本资产，随 dist 分发。
  'public/vendor/pagedjs-0.4.3.min.js',
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
  console.error('  若字体缺失，请从 adobe-fonts/source-han-sans 2.005R 的 CN 子集 OTF 恢复');
  console.error('  public/fonts/（SourceHanSansCN-Regular.otf 与 -Bold.otf，连同 OFL LICENSE.txt）。');
  console.error('  若分页脚本缺失，请从 npm 包 pagedjs@0.4.3 的 dist/paged.min.js 恢复为');
  console.error('  public/vendor/pagedjs-0.4.3.min.js（npm i pagedjs@0.4.3 后复制再卸载）。');
  process.exitCode = 1;
} else {
  console.log('打包资源检查通过：内置 Node、DSH 入口、常驻驱动、捆绑字体与分页脚本齐备。');
}
