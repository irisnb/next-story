import { spawn } from 'node:child_process';
import { openSync, writeFileSync, existsSync } from 'node:fs';
const temp = 'C:/Users/Administrator/AppData/Local/Temp/opencode';
if (!existsSync(temp)) throw new Error('Preapproved log parent missing');
const mode = process.argv[2] ?? 'app';
const executable = mode === 'vite' ? process.execPath : 'D:/Next Story/src-tauri/target/debug/next-story.exe';
const args = mode === 'vite' ? ['D:/Next Story/node_modules/vite/bin/vite.js', '--host', '127.0.0.1'] : [];
const child = spawn(executable, args, {
  cwd: 'D:/Next Story', detached: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223' },
  stdio: ['ignore', openSync(`${temp}/ui-v5-${mode}-out.log`, 'a'), openSync(`${temp}/ui-v5-${mode}-error.log`, 'a')],
});
child.unref();
writeFileSync(`${temp}/ui-v5-${mode}-owned.json`, JSON.stringify({ pid: child.pid, executable, args, started: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ ownedPid: child.pid, mode }));
