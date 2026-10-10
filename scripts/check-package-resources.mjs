import { readFileSync, statSync } from 'node:fs';
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
  // Basecoat 1.0.2（MIT）组件基础（update-frontend-ui-v5 design 决策 4）：
  // 版本锁定的本地离线资源，随前端 dist 打包分发；MIT 许可证文本必须随包。
  // 正式构建不依赖 CDN、Temp 或运行时外网。
  'public/vendor/basecoat-css/basecoat.cdn.min.css',
  'public/vendor/basecoat-css/js/all.min.js',
  'public/vendor/basecoat-css/LICENSE.md',
];

// Basecoat 元数据必须是锁定的版本与许可（update-frontend-ui-v5 决策 4）。
function checkBasecoatMetadata() {
  try {
    const raw = readFileSync(fileURLToPath(new URL('public/vendor/basecoat-css/package.json', root)), 'utf8');
    const meta = JSON.parse(raw);
    if (meta.name !== 'basecoat-css' || meta.version !== '1.0.2' || meta.license !== 'MIT') {
      return `Basecoat 元数据不符：name=${meta.name} version=${meta.version} license=${meta.license}（期望 basecoat-css 1.0.2 MIT）`;
    }
    return null;
  } catch {
    return 'Basecoat package.json 缺失或无法解析，无法核对锁定版本与许可。';
  }
}

const basecoatProblem = checkBasecoatMetadata();

// build.rs 必须显式登记 bundle.icon 的重编依赖（update-frontend-ui-v5 final-check 2026-10-10）：
// tauri-build 只跟踪 tauri.conf.json/capabilities/sidecar，不跟踪图标文件；若 build.rs 未登记，
// 仅更新图标不会重编 Windows 资源，exe/安装包会保留旧图标。
function checkIconRerunTracking() {
  let config;
  try {
    config = JSON.parse(readFileSync(fileURLToPath(new URL('src-tauri/tauri.conf.json', root)), 'utf8'));
  } catch {
    return '无法读取或解析 src-tauri/tauri.conf.json，无法核对 bundle.icon 的重编登记。';
  }
  const icons = config?.bundle?.icon;
  if (!Array.isArray(icons) || icons.length === 0) {
    return 'src-tauri/tauri.conf.json 缺少 bundle.icon，无法核对图标重编登记。';
  }
  let buildRs;
  try {
    buildRs = readFileSync(fileURLToPath(new URL('src-tauri/build.rs', root)), 'utf8');
  } catch {
    return '缺少 src-tauri/build.rs，无法核对图标重编登记。';
  }
  const missing = icons
    .map((iconPath) => String(iconPath).replace(/\\/g, '/'))
    .filter((iconPath) => !buildRs.includes(`cargo:rerun-if-changed=${iconPath}`));
  if (missing.length > 0) {
    return `src-tauri/build.rs 未登记 bundle.icon 重编依赖（仅改图标不会重编 Windows 资源）：${missing.join(', ')}`;
  }
  return null;
}

const iconRerunProblem = checkIconRerunTracking();

const results = resources.map((resource) => {
  try {
    return { resource, present: statSync(fileURLToPath(new URL(resource, root))).isFile() };
  } catch {
    return { resource, present: false };
  }
});

if (results.some(({ present }) => !present) || basecoatProblem !== null || iconRerunProblem !== null) {
  console.error('打包资源不齐备，已中止。当前产品只发行 Windows 版。');
  for (const { resource, present } of results) {
    console.error(`[${present ? '通过' : '缺失'}] ${resource}`);
  }
  if (basecoatProblem !== null) {
    console.error(`[失败] ${basecoatProblem}`);
  }
  if (iconRerunProblem !== null) {
    console.error(`[失败] ${iconRerunProblem}`);
  }
  console.error('补救步骤（从仓库根目录运行）：');
  console.error('  安装 DSH 依赖：cd sidecar; npm ci（完成后回到仓库根目录）');
  console.error('  准备内置 Node：powershell -ExecutionPolicy Bypass -File scripts\\vendor-node.ps1');
  console.error('  若常驻驱动缺失，请恢复仓库中的 sidecar/driver/driver.mjs。');
  console.error('  若字体缺失，请从 adobe-fonts/source-han-sans 2.005R 的 CN 子集 OTF 恢复');
  console.error('  public/fonts/（SourceHanSansCN-Regular.otf 与 -Bold.otf，连同 OFL LICENSE.txt）。');
  console.error('  若分页脚本缺失，请从 npm 包 pagedjs@0.4.3 的 dist/paged.min.js 恢复为');
  console.error('  public/vendor/pagedjs-0.4.3.min.js（npm i pagedjs@0.4.3 后复制再卸载）。');
  console.error('  若 Basecoat 资源缺失，请从 npm 包 basecoat-css@1.0.2 的 dist/basecoat.cdn.min.css、');
  console.error('  dist/js/all.min.js 与 LICENSE.md 恢复为 public/vendor/basecoat-css/（保持 1.0.2 与 MIT）。');
  console.error('  若图标重编登记缺失，请在 src-tauri/build.rs 为每个 bundle.icon 补 cargo:rerun-if-changed。');
  process.exitCode = 1;
} else {
  console.log('打包资源检查通过：内置 Node、DSH 入口、常驻驱动、捆绑字体、分页脚本、Basecoat 组件资源与图标重编登记齐备。');
}
