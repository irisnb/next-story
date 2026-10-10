// launch.mjs — 启动本仓库 debug 构建的真实 Tauri 桌面应用并开放 WebView2 CDP 调试端口。
// 方法沿归档 change 2026-10-10-update-frontend-ui-v5/verification/ui-launch.mjs。
// 前提：debug 可执行文件为当前工作区代码 + 当前 dist（npm run check 的 build + test:rust 产物）。
// 用法：node launch.mjs [port]（默认 9225）。写入 owned 记录到预批准临时目录，不打印任何密钥。
import { spawn } from 'node:child_process';
import { openSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const repo = 'D:/Next Story';
const executable = `${repo}/src-tauri/target/debug/next-story.exe`;
const temp = 'C:/Users/Administrator/AppData/Local/Temp/opencode/acceptance-fix-ai';
const port = String(process.argv[2] ?? '9225');

if (!existsSync(executable)) throw new Error(`DEBUG EXE MISSING: ${executable}`);
mkdirSync(temp, { recursive: true });

const child = spawn(executable, [], {
  cwd: repo,
  detached: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: ['ignore', openSync(`${temp}/app-out.log`, 'a'), openSync(`${temp}/app-error.log`, 'a')],
});
child.unref();
writeFileSync(
  `${temp}/owned.json`,
  JSON.stringify({ pid: child.pid, executable, port, started: new Date().toISOString() }, null, 2),
);
console.log(JSON.stringify({ ownedPid: child.pid, executable, port }));
