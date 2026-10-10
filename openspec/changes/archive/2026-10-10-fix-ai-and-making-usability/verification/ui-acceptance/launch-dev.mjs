// launch-dev.mjs — 以隔离 identifier 启动本仓库 tauri dev 实例，避开用户已运行实例的单实例锁。
// 隔离点：`--config` 合并覆盖 identifier -> 独立应用数据目录，绝不读写用户真实配置/项目。
// 方法沿归档 change 2026-10-10-update-frontend-ui-v5/verification/ui-launch.mjs（WEBVIEW2 调试参数）。
// 用法：node launch-dev.mjs [port]（默认 9225）。写入 owned 记录到预批准临时目录，不打印任何密钥。
import { spawn } from 'node:child_process';
import { openSync, writeFileSync, mkdirSync } from 'node:fs';

const repo = 'D:/Next Story';
const temp = 'C:/Users/Administrator/AppData/Local/Temp/opencode/acceptance-fix-ai';
const port = String(process.argv[2] ?? '9225');
const override = `${repo}/openspec/changes/fix-ai-and-making-usability/verification/ui-acceptance/tauri.override.json`;

mkdirSync(temp, { recursive: true });

const child = spawn(
  'cmd.exe',
  ['/c', 'npm', 'run', 'tauri', '--', 'dev', '--config', override, '--no-watch'],
  {
    cwd: repo,
    detached: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: ['ignore', openSync(`${temp}/dev-out.log`, 'a'), openSync(`${temp}/dev-error.log`, 'a')],
  },
);
child.unref();
writeFileSync(
  `${temp}/owned-dev.json`,
  JSON.stringify({ pid: child.pid, port, override, started: new Date().toISOString() }, null, 2),
);
console.log(JSON.stringify({ ownedPid: child.pid, port, override }));
