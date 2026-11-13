// release.mjs — 发版两阶段一条命令（add-auto-updater，design D9/D10）。
//
// 为什么：手动发包不可持续；更新渠道（latest.json + 签名安装包）要求每次发版
// 步骤完全一致且失败可恢复。本脚本把发版收敛为一条命令的两个阶段：
//
//   准备阶段 --prepare：前置断言 → 识别上一正式 Release（区分「首次发布」与
//     网络/认证失败）→ npm run check 总门禁 → 版本严格递增检查 → 版本号同步
//     （单一真相源是 src-tauri/tauri.conf.json）→ 打包准备检查 → 打印应提交
//     文件清单与下一步指引。脚本不做任何 git 写操作，提交与打标签由维护者完成。
//   发布阶段 --publish：校验工作区/分支/标签绑定 → 交互收集中文更新说明与
//     私钥密码（密码只经环境变量传给打包工具，不落盘）→ 签名打包 → 生成
//     latest.json → 稳定名副本 → draft 上传全套发布物 → 逐项核验 → 转正式。
//
// 失败纪律：任一阶段失败打印「失败阶段 + 已完成步骤 + 安全重试指引」；
// 发布阶段失败保留 draft 供恢复重试（重跑 --publish 复用同 tag draft 并
// --clobber 覆盖附件）；绝不删除已发布版本或标签，绝不替换已正式发布的产物。
//
// 纯逻辑（版本比较、latest.json 生成、gh 结果分类等）全部导出为可注入函数，
// 由 tests/release-script.test.ts 覆盖；测试不触真实 git/gh/网络/构建。
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import console from 'node:console';
import process from 'node:process';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const REPO_SLUG = 'irisnb/next-story';
export const PLATFORM_KEY = 'windows-x86_64';
export const STABLE_SETUP_EXE = 'NextStory-setup.exe';
export const STABLE_SETUP_MSI = 'NextStory-setup.msi';
export const LATEST_JSON_NAME = 'latest.json';
export const DEFAULT_KEY_PATH = 'C:\\Users\\Administrator\\.tauri\\next-story-updater.key';

const CONF_PATH = 'src-tauri/tauri.conf.json';
const PACKAGE_JSON_PATH = 'package.json';
const PACKAGE_LOCK_PATH = 'package-lock.json';
const CARGO_TOML_PATH = 'src-tauri/Cargo.toml';
const CARGO_LOCK_PATH = 'src-tauri/Cargo.lock';
const NSIS_DIR = 'src-tauri/target/release/bundle/nsis';
const MSI_DIR = 'src-tauri/target/release/bundle/msi';

// 发版所需的打包准备（参照 scripts/check-package-resources.mjs，只查更新发版必需项）。
const REQUIRED_PACKAGING_FILES = [
  'sidecar/node-runtime/node.exe',
  'sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js',
  'sidecar/driver/driver.mjs',
];

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// ---------------------------------------------------------------------------
// 失败协议：ReleaseAbort 携带失败阶段、已完成步骤与安全重试指引
// ---------------------------------------------------------------------------

export class ReleaseAbort extends Error {
  /**
   * @param {string} stage 失败阶段名
   * @param {string} message 中文失败原因
   * @param {{ completed?: string[], retry?: string }} extra 已完成步骤快照与重试指引
   */
  constructor(stage, message, { completed = [], retry = '' } = {}) {
    super(message);
    this.name = 'ReleaseAbort';
    this.stage = stage;
    this.completed = completed;
    this.retry = retry;
  }
}

/** 把任意异常折算成结构化失败结果；调用方（CLI 或测试）据此打印，不会误判成功。 */
function toFailureResult(error, phase) {
  if (error instanceof ReleaseAbort) {
    return { ok: false, phase, stage: error.stage, message: error.message, completed: error.completed, retry: error.retry };
  }
  return {
    ok: false,
    phase,
    stage: '未预期错误',
    message: String(error && error.message ? error.message : error),
    completed: [],
    retry: '这是脚本未预期的错误；请把以上报错原文反馈维护者排查后再重试。脚本未做任何 git 写操作。',
  };
}

/** 取输出末尾若干行，避免刷屏又保留排错线索。 */
function tailOf(...outputs) {
  const text = outputs.filter(Boolean).join('\n').trim();
  if (text === '') return '';
  return text.split(/\r?\n/).slice(-30).join('\n');
}

// ---------------------------------------------------------------------------
// 纯逻辑：SemVer 严格大于比较（自写，不新增依赖）
// ---------------------------------------------------------------------------

/** '0.1.2' → { major, minor, patch }；不合规返回 null。 */
export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** 'v0.1.2' → '0.1.2'；非 v x.y.z 形态返回 null。 */
export function tagToVersion(tag) {
  if (typeof tag !== 'string') return null;
  const match = tag.match(/^v(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

/** 三段比较：a<b 返回 -1，相等 0，a>b 返回 1；任一侧不合规即抛中文错误。 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) {
    throw new Error(`版本号格式无效（应为 x.y.z）：「${pa === null ? a : b}」`);
  }
  const keys = ['major', 'minor', 'patch'];
  for (const key of keys) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }
  return 0;
}

export function isVersionStrictlyGreater(candidate, previous) {
  return compareSemver(candidate, previous) > 0;
}

/**
 * 准备阶段第 ④ 步的裁决：conf 版本必须严格大于上一正式 Release 的标签版本。
 * previousTag 为 null 表示首次发布（合法分支，跳过比对）。
 */
export function checkVersionIncrease({ confVersion, previousTag }) {
  if (parseSemver(confVersion) === null) {
    return { ok: false, message: `tauri.conf.json 的 version「${confVersion}」不是规范的 x.y.z 版本号，请修正后再发版。` };
  }
  if (previousTag === null || previousTag === undefined) {
    return { ok: true, firstRelease: true };
  }
  const previousVersion = tagToVersion(previousTag);
  if (previousVersion === null) {
    return { ok: false, message: `上一正式 Release 的标签「${previousTag}」不是 v x.y.z 形态，无法比对版本；请先在 GitHub 修正该 Release 的标签命名。` };
  }
  if (!isVersionStrictlyGreater(confVersion, previousVersion)) {
    return { ok: false, message: `新版本号 ${confVersion} 未严格大于上一正式 Release 的 ${previousVersion}：用户将收不到更新。请先把 src-tauri/tauri.conf.json 的 version 升到更高版本号（这是唯一手改处），再重跑 --prepare。` };
  }
  return { ok: true, firstRelease: false, previousVersion };
}

// ---------------------------------------------------------------------------
// 纯逻辑：更新说明校验与 latest.json / Release 正文生成
// ---------------------------------------------------------------------------

/** 更新说明校验：非空行 1–5 条（条数超限、全空白都拒绝）；条目逐行 trim。 */
export function validateReleaseNotes(notes) {
  const lines = String(notes ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { ok: false, message: '更新说明不能为空：请至少写一条用户能感知的变化。' };
  }
  if (lines.length > 5) {
    return { ok: false, message: `更新说明一次建议 1–5 条（当前 ${lines.length} 条）：请合并成更少的条目，每条一句话。` };
  }
  return { ok: true, lines };
}

/** 生成 latest.json（Tauri v2 更新清单）。signature 取 .sig 内容原文（trim）；pub_date 为 RFC 3339。 */
export function buildLatestJson({ version, notes, signature, url, pubDate = new Date() }) {
  if (parseSemver(typeof version === 'string' ? version : '') === null) {
    throw new Error(`latest.json 的 version「${version}」不是规范的 x.y.z 版本号。`);
  }
  const trimmedSignature = String(signature ?? '').trim();
  if (trimmedSignature === '') {
    throw new Error('签名为空：.sig 文件内容不能是空白。');
  }
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error(`latest.json 的下载直链必须以 https:// 开头，当前为「${url}」。`);
  }
  const date = pubDate instanceof Date ? pubDate : new Date(pubDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error('pubDate 不是有效时间，无法生成 RFC 3339 日期。');
  }
  return {
    version,
    notes: String(notes ?? ''),
    pub_date: date.toISOString(),
    platforms: {
      [PLATFORM_KEY]: { signature: trimmedSignature, url },
    },
  };
}

/** GitHub 上传 Release 资产时会把文件名中的空格替换为点（2026-11-13 真机实证：
 *  本地「Next Story_x64-setup.exe」在远端成为「Next.Story_x64-setup.exe」，
 *  空格形直链 404、点形 200）。远端资产名与直链一律用点形；本地文件名保持空格形。 */
export function toRemoteAssetName(fileName) {
  return String(fileName).replace(/ /g, '.');
}

/** 版本化产物的发布直链（机器消费，不受「对外入口只用固定链接」规则约束）。 */
export function buildReleaseUrl(tag, fileName) {
  return `https://github.com/${REPO_SLUG}/releases/download/${tag}/${encodeURIComponent(toRemoteAssetName(fileName))}`;
}

/** Release 正文 = 更新说明 + 既有 SmartScreen 指引（release-download 规格第 34–39 行）。 */
export function buildReleaseBody(notesText) {
  return `${String(notesText ?? '').trim()}

## 安装提示

Windows 首次运行安装包时可能弹出 SmartScreen（“Windows 已保护你的电脑”）提示，这属预期：安装包未购买代码签名。点「更多信息」→「仍要运行」即可继续安装。`;
}

// ---------------------------------------------------------------------------
// 纯逻辑：gh 结果分类（404＝首次发布；网络/认证/其他失败严格区分）
// ---------------------------------------------------------------------------

/**
 * 对 gh api releases/latest 的失败分类：
 * - not-found：HTTP 404，仓库可访问但没有任何正式 Release → 首次发布分支（合法）；
 * - auth：未登录/凭证失效/无权限；
 * - network：网络不可达；
 * - api-error：其余 API 失败。
 * 每个错误类别附中文修复方法；绝不把失败当作「没有上一版」。
 */
export function classifyGhFailure({ stderr = '', stdout = '' } = {}) {
  const text = `${stderr}\n${stdout}`;
  if (/HTTP 404|Not Found/i.test(text)) {
    return { kind: 'not-found', message: '' };
  }
  if (/HTTP 40[13]|Bad credentials|gh auth login|not logged in|authentication required|需要认证/i.test(text)) {
    return { kind: 'auth', message: 'gh 未登录、凭证失效或账号无权限：请运行 gh auth login 重新登录（账号须对 irisnb/next-story 有发布权限），再重跑发版脚本。' };
  }
  if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|could not resolve host|timed out|dial tcp|network/i.test(text)) {
    return { kind: 'network', message: '网络请求 GitHub 失败：请检查网络连接（必要时配置代理）后重跑。注意这不是「没有上一版」，脚本不会把它误当首次发布处理。' };
  }
  return { kind: 'api-error', message: `GitHub API 返回异常：\n${tailOf(stderr, stdout)}\n请稍后重试，或手动运行 gh api repos/${REPO_SLUG}/releases/latest 排查。` };
}

// ---------------------------------------------------------------------------
// 纯逻辑：版本号同步补丁（package.json / package-lock.json 两处 / Cargo.toml）
// ---------------------------------------------------------------------------

/** package.json：替换根对象第一个 "version" 字段（依赖键是包名，不冲突）。 */
export function patchPackageJsonVersion(text, version) {
  const pattern = /"version"\s*:\s*"[^"]*"/;
  if (!pattern.test(text)) {
    throw new Error('package.json 中未找到 "version" 字段，无法同步版本号。');
  }
  return text.replace(pattern, `"version": "${version}"`);
}

/** package-lock.json：替换根对象与 packages[""] 两处 version（依赖条目的 version 不动）。 */
export function patchPackageLockVersion(text, version) {
  const lockfileIndex = text.indexOf('"lockfileVersion"');
  if (lockfileIndex < 0) {
    throw new Error('package-lock.json 中未找到 "lockfileVersion"，文件结构异常，无法同步版本号。');
  }
  const head = text.slice(0, lockfileIndex);
  const tail = text.slice(lockfileIndex);
  const rootPattern = /"version"\s*:\s*"[^"]*"/;
  if (!rootPattern.test(head)) {
    throw new Error('package-lock.json 根对象的 "version" 未找到（应位于 "lockfileVersion" 之前），已中止同步。');
  }
  const patchedHead = head.replace(rootPattern, `"version": "${version}"`);
  const packagesIndex = tail.indexOf('"packages"');
  if (packagesIndex < 0) {
    throw new Error('package-lock.json 中未找到 "packages" 段，无法同步 packages[""] 的版本号。');
  }
  const packagesHead = tail.slice(0, packagesIndex);
  const packagesTail = tail.slice(packagesIndex);
  const firstVersion = packagesTail.match(/"version"\s*:\s*"[^"]*"/);
  if (!firstVersion) {
    throw new Error('package-lock.json 的 "packages" 段中未找到 "version" 字段，已中止同步。');
  }
  const firstNodeModules = packagesTail.indexOf('"node_modules');
  if (firstNodeModules >= 0 && firstVersion.index > firstNodeModules) {
    throw new Error('package-lock.json 的 packages[""] 版本定位异常（落在依赖条目区），已中止同步，未写入任何文件。');
  }
  const patchedTail = packagesHead
    + packagesTail.slice(0, firstVersion.index)
    + `"version": "${version}"`
    + packagesTail.slice(firstVersion.index + firstVersion[0].length);
  return patchedHead + patchedTail;
}

/** Cargo.toml：替换 [package] 段内的 version 行（依赖区的 version 不动）。 */
export function patchCargoTomlVersion(text, version) {
  const packageIndex = text.indexOf('[package]');
  if (packageIndex < 0) {
    throw new Error('Cargo.toml 中未找到 [package] 段，无法同步版本号。');
  }
  const body = text.slice(packageIndex);
  const versionMatch = body.match(/^version\s*=\s*"[^"]*"/m);
  if (!versionMatch) {
    throw new Error('Cargo.toml 的 [package] 段中没有 version 字段，无法同步版本号。');
  }
  const nextSectionRelative = body.slice(1).search(/^\[/m);
  const nextSection = nextSectionRelative < 0 ? -1 : nextSectionRelative + 1;
  if (nextSection >= 0 && versionMatch.index > nextSection) {
    throw new Error('Cargo.toml 的版本号字段定位异常（不在 [package] 段内），已中止同步。');
  }
  return text.slice(0, packageIndex)
    + body.slice(0, versionMatch.index)
    + `version = "${version}"`
    + body.slice(versionMatch.index + versionMatch[0].length);
}

/** Cargo.toml 的 [package] 版本；找不到返回 null。 */
export function extractCargoTomlVersion(text) {
  const packageIndex = text.indexOf('[package]');
  if (packageIndex < 0) return null;
  const match = text.slice(packageIndex).match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

/** Cargo.lock 中根 crate（name = "next-story"）的版本；找不到返回 null。 */
export function extractCargoLockVersion(text) {
  const match = text.match(/\[\[package\]\]\s*\r?\nname = "next-story"\s*\r?\nversion = "([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * 六处版本一致性校验（tauri.conf.json / package.json / package-lock 根 /
 * package-lock packages[""] / Cargo.toml / Cargo.lock）。
 */
export function checkVersionFilesConsistency({ confText, packageJsonText, packageLockText, cargoTomlText, cargoLockText, version }) {
  const readJson = (text, place) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${place} 不是合法 JSON，无法校验版本号。`);
    }
  };
  const conf = readJson(confText, 'src-tauri/tauri.conf.json');
  const pkg = readJson(packageJsonText, 'package.json');
  const lock = readJson(packageLockText, 'package-lock.json');
  const places = [
    { place: 'src-tauri/tauri.conf.json', version: typeof conf?.version === 'string' ? conf.version : null },
    { place: 'package.json', version: typeof pkg?.version === 'string' ? pkg.version : null },
    { place: 'package-lock.json（根对象）', version: typeof lock?.version === 'string' ? lock.version : null },
    { place: 'package-lock.json（packages[""]）', version: typeof lock?.packages?.['']?.version === 'string' ? lock.packages[''].version : null },
    { place: 'src-tauri/Cargo.toml', version: extractCargoTomlVersion(cargoTomlText) },
    { place: 'src-tauri/Cargo.lock', version: extractCargoLockVersion(cargoLockText) },
  ];
  const mismatches = places.filter((item) => item.version !== version);
  return { ok: mismatches.length === 0, places, mismatches };
}

/**
 * 版本同步：读出三个文本 → 全部补丁成功 → 才写回（任一失败即抛错且一个文件都不写）。
 * Cargo.lock 不做文本补丁，由随后的 cargo check 同步（见 runPrepare 第 ⑤ 步）。
 */
export function syncVersionFiles({ packageJsonPath, packageLockPath, cargoTomlPath, version }, io) {
  const jobs = [
    { path: packageJsonPath, patch: (text) => patchPackageJsonVersion(text, version) },
    { path: packageLockPath, patch: (text) => patchPackageLockVersion(text, version) },
    { path: cargoTomlPath, patch: (text) => patchCargoTomlVersion(text, version) },
  ];
  const texts = jobs.map((job) => io.read(job.path));
  const patched = texts.map((text, index) => jobs[index].patch(text));
  patched.forEach((text, index) => io.write(jobs[index].path, text));
  return { written: jobs.map((job) => job.path) };
}

// ---------------------------------------------------------------------------
// 纯逻辑：发布物识别与 draft 附件核验
// ---------------------------------------------------------------------------

/** 从 bundle 目录文件名里识别本版本的版本化产物（NSIS exe、.sig、MSI）。 */
export function pickVersionedAssets({ nsisEntries, msiEntries, version }) {
  const setups = nsisEntries.filter((name) => name.endsWith('-setup.exe') && name.includes(version));
  if (setups.length !== 1) {
    return { ok: false, message: `在 NSIS 产物目录中识别版本化安装包失败（期望恰好 1 个含 ${version} 的 *-setup.exe）：${setups.length === 0 ? '一个也没找到' : setups.join('、')}` };
  }
  const setupExe = setups[0];
  const setupSig = `${setupExe}.sig`;
  if (!nsisEntries.includes(setupSig)) {
    return { ok: false, message: `缺少签名文件 ${setupSig}（应与安装包一同产出；请确认 tauri.conf.json 的 createUpdaterArtifacts 已开启且构建完整）。` };
  }
  const msis = msiEntries.filter((name) => name.toLowerCase().endsWith('.msi') && name.includes(version));
  if (msis.length !== 1) {
    return { ok: false, message: `在 MSI 产物目录中识别备选安装包失败（期望恰好 1 个含 ${version} 的 .msi）：${msis.length === 0 ? '一个也没找到' : msis.join('、')}` };
  }
  return { ok: true, setupExe, setupSig, msi: msis[0] };
}

/** draft 应有的 5 件附件名（版本化 NSIS + .sig + latest.json + 稳定名副本 exe/msi）。
 *  版本化名字经 toRemoteAssetName 转为 GitHub 实存的点形（空格会被远端换点）。 */
export function expectedReleaseAssetNames({ setupExe, setupSig }) {
  return [toRemoteAssetName(setupExe), toRemoteAssetName(setupSig), LATEST_JSON_NAME, STABLE_SETUP_EXE, STABLE_SETUP_MSI];
}

/** 给定实际附件名，返回缺失清单（空数组＝齐备）。 */
export function findMissingReleaseAssets(actualNames, expectedNames) {
  return expectedNames.filter((name) => !actualNames.includes(name));
}

/** 签名打包的子进程环境：私钥路径与密码只经环境变量传递（绝不写盘）。 */
export function buildTauriBuildEnv({ keyPath, password, baseEnv = {} }) {
  return {
    ...baseEnv,
    // 打包器实际读取 TAURI_SIGNING_PRIVATE_KEY（官方文档：接受"路径或内容"）；
    // 2026-11-13 首次真机发版实证：只设 PATH 变体会报"no private key"致签名中断。
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PATH: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };
}

// ---------------------------------------------------------------------------
// 可注入的执行环境（参照 src/project-api.ts 的 InvokeFn 思路：默认真实实现，测试注入伪造）
// ---------------------------------------------------------------------------

/** Windows 上 npm 是 npm.cmd 且批处理必须经 shell 调用；参数含空格时手工加引号。 */
function shellQuote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export function createDefaultExec() {
  return (file, args, opts = {}) => {
    const resolved = file === 'npm' && process.platform === 'win32' ? 'npm.cmd' : file;
    const useShell = process.platform === 'win32' && /\.cmd$/i.test(resolved);
    const result = spawnSync(resolved, useShell ? args.map(shellQuote) : args, {
      encoding: 'utf8',
      cwd: opts.cwd ?? repoRoot,
      ...(opts.env ? { env: opts.env } : {}),
      ...(useShell ? { shell: true } : {}),
    });
    return {
      status: result.status,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      error: result.error ? result.error.message : null,
    };
  };
}

export function createDefaultIo() {
  const resolvePath = (p) => (isAbsolute(p) ? p : join(repoRoot, p));
  return {
    abs: resolvePath,
    read: (p) => readFileSync(resolvePath(p), 'utf8'),
    write: (p, text) => { writeFileSync(resolvePath(p), text, 'utf8'); },
    exists: (p) => {
      try {
        return statSync(resolvePath(p)).isFile();
      } catch {
        return false;
      }
    },
    readdir: (p) => readdirSync(resolvePath(p)),
    copy: (from, to) => { copyFileSync(resolvePath(from), resolvePath(to)); },
    mkdir: (p) => { mkdirSync(resolvePath(p), { recursive: true }); },
    mkdirTemp: () => mkdtempSync(join(tmpdir(), 'next-story-release-')),
  };
}

/** 交互输入（readline；明文回显可接受——提示语已说明密码只经环境变量传递、不落盘）。 */
function createAskFunctions() {
  let rl = null;
  const interface_ = () => {
    if (rl === null) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
    }
    return rl;
  };
  return {
    askText: async (prompt) => (await interface_().question(prompt)).trim(),
    askConfirm: async (prompt) => {
      const answer = (await interface_().question(prompt)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes' || answer === '是';
    },
    close: () => {
      if (rl !== null) {
        rl.close();
        rl = null;
      }
    },
  };
}

export function createDefaultDeps(overrides = {}) {
  const ask = createAskFunctions();
  return {
    exec: createDefaultExec(),
    io: createDefaultIo(),
    log: (text) => { console.log(text); },
    err: (text) => { console.error(text); },
    askText: ask.askText,
    askConfirm: ask.askConfirm,
    askSecret: ask.askText,
    now: () => new Date(),
    env: { ...process.env },
    cleanup: ask.close,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 共用断言
// ---------------------------------------------------------------------------

function assertWorktreeCleanAndMain(exec, fail) {
  const status = exec('git', ['status', '--porcelain']);
  if (status.error) {
    fail('前置断言', `无法运行 git（${status.error}）：请确认已安装 git 且在 PATH 中。`);
  }
  if (status.status !== 0 || status.stdout.trim() !== '') {
    fail('前置断言', `工作区不干净（git status --porcelain 有输出）：\n${tailOf(status.stdout)}\n先把未提交的改动提交或暂存，再重跑发版脚本。`);
  }
  const branch = exec('git', ['branch', '--show-current']);
  if (branch.error) {
    fail('前置断言', `无法读取当前分支（${branch.error}）。`);
  }
  if (branch.status !== 0 || branch.stdout.trim() !== 'main') {
    fail('前置断言', `当前分支是「${branch.stdout.trim() || '未知'}」，发版只允许在 main 分支进行：请先切换到 main。`);
  }
}

function assertGhReady(exec, fail) {
  const version = exec('gh', ['--version']);
  if (version.error || version.status !== 0) {
    fail('前置断言', `gh 命令不可用（${version.error ?? `退出码 ${version.status}`}）：请安装 GitHub CLI（winget install GitHub.cli）后重试。`);
  }
  const auth = exec('gh', ['auth', 'status']);
  if (auth.error || auth.status !== 0) {
    fail('前置断言', 'gh 未登录或凭证已失效：请运行 gh auth login 重新登录（账号需对 irisnb/next-story 有发布权限）。', 'gh auth login 完成后重跑 node scripts/release.mjs --prepare。');
  }
  const remote = exec('git', ['remote', 'get-url', 'origin']);
  if (remote.error || remote.status !== 0 || !remote.stdout.includes(REPO_SLUG)) {
    fail('前置断言', `origin 未指向 ${REPO_SLUG}（当前：${remote.stdout.trim() || '无'}）：发版脚本只面向该仓库。`);
  }
  const permission = exec('gh', ['api', `repos/${REPO_SLUG}`, '--jq', '.permissions.push']);
  if (permission.error || permission.status !== 0) {
    const cls = classifyGhFailure(permission);
    fail('前置断言', `无法确认对 ${REPO_SLUG} 的发布权限：${cls.message}\n原始输出：\n${tailOf(permission.stderr, permission.stdout)}`);
  }
  if (permission.stdout.trim() !== 'true') {
    fail('前置断言', `当前 gh 登录账号对 ${REPO_SLUG} 没有推送（发布）权限（permissions.push=${permission.stdout.trim() || '无'}）：请改用有权限的账号 gh auth login。`);
  }
}

function readConfVersion(text, stage, fail) {
  let conf;
  try {
    conf = JSON.parse(text);
  } catch {
    fail(stage, 'src-tauri/tauri.conf.json 不是合法 JSON，无法读取版本号。');
  }
  const version = typeof conf?.version === 'string' ? conf.version : null;
  if (version === null || parseSemver(version) === null) {
    fail(stage, `src-tauri/tauri.conf.json 的 version「${version ?? '缺失'}」不是规范的 x.y.z 版本号。`, '版本号单一真相源：只手改 tauri.conf.json 的 version 字段。');
  }
  return version;
}

// ---------------------------------------------------------------------------
// 准备阶段（--prepare）
// ---------------------------------------------------------------------------

export async function runPrepare(deps = {}) {
  const exec = deps.exec ?? createDefaultExec();
  const io = deps.io ?? createDefaultIo();
  const log = deps.log ?? ((text) => { console.log(text); });
  const completed = [];
  const fail = (stage, message, retry = '按报错修复后重跑 node scripts/release.mjs --prepare；脚本未做任何 git 写操作。') => {
    throw new ReleaseAbort(stage, message, { completed: [...completed], retry });
  };
  try {
    // ① 前置断言：工作区干净、main 分支、gh 已安装已登录、origin 指向目标仓库
    log('[1/7] 前置断言：工作区干净、main 分支、gh 可用已登录、origin 指向 irisnb/next-story…');
    assertWorktreeCleanAndMain(exec, fail);
    assertGhReady(exec, fail);
    completed.push('前置断言（工作区干净、main 分支、gh 可用已登录、origin 指向目标仓库）');

    // ② 识别上一正式 Release：404＝首次发布（合法）；网络/认证/其他失败严格区分
    log('[2/7] 识别上一正式 Release…');
    const latest = exec('gh', ['api', `repos/${REPO_SLUG}/releases/latest`]);
    if (latest.error) {
      fail('识别上一正式 Release', `无法运行 gh（${latest.error}）：请确认 GitHub CLI 可用。`);
    }
    let previousTag = null;
    if (latest.status !== 0) {
      const cls = classifyGhFailure(latest);
      if (cls.kind !== 'not-found') {
        fail('识别上一正式 Release', `${cls.message}\n原始输出：\n${tailOf(latest.stderr, latest.stdout)}`, '修复上述问题后重跑 --prepare；脚本不会把失败误当作「没有上一版」。');
      }
      log('  仓库尚无正式 Release：按首次发布处理，跳过版本比对。');
    } else {
      let payload;
      try {
        payload = JSON.parse(latest.stdout);
      } catch {
        fail('识别上一正式 Release', '上一正式 Release 的返回不是合法 JSON，无法读取 tag。');
      }
      previousTag = typeof payload?.tag_name === 'string' ? payload.tag_name : null;
      if (previousTag === null || tagToVersion(previousTag) === null) {
        fail('识别上一正式 Release', `上一正式 Release 的标签「${previousTag ?? '缺失'}」不是 v x.y.z 形态，无法比对版本；请先在 GitHub 修正该 Release 的标签。`);
      }
      log(`  上一正式 Release：${previousTag}`);
    }
    completed.push('识别上一正式 Release');

    // ③ 总门禁：任一科目失败即止
    log('[3/7] 运行总门禁 npm run check（依次 10 个科目，可能 5–15 分钟，无输出属正常）…');
    const gate = exec('npm', ['run', 'check']);
    if (gate.error || gate.status !== 0) {
      fail('总门禁 npm run check', `总门禁未通过（${gate.error ?? `退出码 ${gate.status}`}）：\n${tailOf(gate.stdout, gate.stderr)}`, '先在仓库根目录把 npm run check 跑绿（单科定位见 docs/DEVELOPMENT.md），再重跑 --prepare。');
    }
    completed.push('总门禁 npm run check');

    // ④ 版本严格递增检查（tauri.conf.json 是唯一手改处）
    log('[4/7] 版本严格递增检查（单一真相源：src-tauri/tauri.conf.json）…');
    const confVersion = readConfVersion(io.read(CONF_PATH), '版本严格递增检查', fail);
    const increase = checkVersionIncrease({ confVersion, previousTag });
    if (!increase.ok) {
      fail('版本严格递增检查', increase.message);
    }
    log(`  本版版本号：v${confVersion}${increase.firstRelease ? '（首次发布）' : `（上一版 ${previousTag}）`}`);
    completed.push('版本严格递增检查');

    // ⑤ 版本同步：三处文本补丁 + cargo check 同步 Cargo.lock + 六处一致性校验
    log('[5/7] 同步版本号（package.json、package-lock.json 两处、src-tauri/Cargo.toml）…');
    syncVersionFiles({
      packageJsonPath: PACKAGE_JSON_PATH,
      packageLockPath: PACKAGE_LOCK_PATH,
      cargoTomlPath: CARGO_TOML_PATH,
      version: confVersion,
    }, io);
    log('  运行 cargo check 同步 src-tauri/Cargo.lock…');
    const cargo = exec('cargo', ['check', '--manifest-path', CARGO_TOML_PATH]);
    if (cargo.error || cargo.status !== 0) {
      fail('版本号同步与六处一致性校验', `cargo check 失败（${cargo.error ?? `退出码 ${cargo.status}`}，该步用于同步 Cargo.lock）：\n${tailOf(cargo.stderr, cargo.stdout)}`, '在仓库根目录手动运行 cargo check --manifest-path src-tauri/Cargo.toml 排除错误后，重跑 --prepare；不要手改 Cargo.lock。');
    }
    const consistency = checkVersionFilesConsistency({
      confText: io.read(CONF_PATH),
      packageJsonText: io.read(PACKAGE_JSON_PATH),
      packageLockText: io.read(PACKAGE_LOCK_PATH),
      cargoTomlText: io.read(CARGO_TOML_PATH),
      cargoLockText: io.read(CARGO_LOCK_PATH),
      version: confVersion,
    });
    if (!consistency.ok) {
      const detail = consistency.mismatches.map((item) => `  ${item.place}：${item.version ?? '未找到'}`).join('\n');
      fail('版本号同步与六处一致性校验', `六处版本号未全部等于 ${confVersion}：\n${detail}`, '通常是 Cargo.lock 未被 cargo check 更新：手动运行 cargo check 后确认六处一致再重跑 --prepare。');
    }
    log('  六处版本号一致（含 package-lock 两处与两份 lock）。');
    completed.push('版本号同步与六处一致性校验');

    // ⑥ 打包准备检查（只查更新发版所需三项）
    log('[6/7] 打包准备检查（内置 Node、DSH 依赖、常驻驱动）…');
    const missing = REQUIRED_PACKAGING_FILES.filter((p) => !io.exists(p));
    if (missing.length > 0) {
      fail('打包准备检查', `打包资源缺失：\n  ${missing.join('\n  ')}`, '补救步骤（仓库根目录）：安装 DSH 依赖 cd sidecar; npm ci；准备内置 Node powershell -ExecutionPolicy Bypass -File scripts\\vendor-node.ps1；若 driver.mjs 缺失请从仓库恢复。完成后重跑 --prepare。');
    }
    completed.push('打包准备检查');

    // ⑦ 打印应提交文件清单与下一步指引（脚本不代替维护者做 git 写操作）
    const filesToCommit = [PACKAGE_JSON_PATH, PACKAGE_LOCK_PATH, CARGO_TOML_PATH, CARGO_LOCK_PATH];
    log('[7/7] 准备阶段完成。请维护者本人完成以下 git 操作（脚本不代替提交、不打标签）：');
    log(`  1. git add ${[...filesToCommit, CONF_PATH].join(' ')}`);
    log(`  2. git commit -m "发版 v${confVersion}"`);
    log('  3. git push origin main');
    log(`  4. git tag v${confVersion}`);
    log(`  5. git push origin v${confVersion}`);
    log('  6. node scripts/release.mjs --publish');
    log(`说明：tauri.conf.json 的 version 是唯一手改处，本脚本已把其余四处同步到 ${confVersion}。`);
    return { ok: true, version: confVersion, firstRelease: increase.firstRelease, previousTag, filesToCommit };
  } catch (error) {
    return toFailureResult(error, '准备阶段');
  }
}

// ---------------------------------------------------------------------------
// 发布阶段（--publish）
// ---------------------------------------------------------------------------

/** 交互收集更新说明：每行一条、空行结束；校验（1–5 条）；预览确认后采用。 */
async function collectNotes(askText, askConfirm, log) {
  log('请输入更新说明（每行一条；建议 1–5 条、每条一句话说用户能感知的变化）。');
  log('示例：');
  log('- 新增软件自动检查更新，打开软件即可在「帮助」里看到新版提示');
  log('- 修复导出 Word 时偶发的段落顺序错乱');
  let collected = null;
  while (collected === null) {
    log('（直接回车表示本条留空、输入结束）');
    const lines = [];
    let line = await askText('第 1 条：');
    while (line !== '') {
      lines.push(line);
      line = await askText(`第 ${lines.length + 1} 条：`);
    }
    const validation = validateReleaseNotes(lines.join('\n'));
    if (!validation.ok) {
      log(validation.message);
      continue;
    }
    const preview = validation.lines.map((item) => `- ${item}`).join('\n');
    log(`更新说明预览（将同文写入 latest.json 与 Release 正文）：\n${preview}`);
    if (await askConfirm('确认使用这份更新说明？(y/n)：')) {
      collected = { lines: validation.lines, notesText: validation.lines.join('\n') };
    } else {
      log('好的，重新输入。');
    }
  }
  return collected;
}

export async function runPublish(deps = {}) {
  const exec = deps.exec ?? createDefaultExec();
  const io = deps.io ?? createDefaultIo();
  const log = deps.log ?? ((text) => { console.log(text); });
  const ask = createAskFunctions();
  const askText = deps.askText ?? ask.askText;
  const askConfirm = deps.askConfirm ?? ask.askConfirm;
  const askSecret = deps.askSecret ?? ask.askText;
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? {};
  const keyPath = deps.keyPath ?? DEFAULT_KEY_PATH;
  const completed = [];
  const fail = (stage, message, retry = '问题修复后重跑 node scripts/release.mjs --publish；draft 与标签不受影响，绝不删除已发布版本或标签。') => {
    throw new ReleaseAbort(stage, message, { completed: [...completed], retry });
  };
  try {
    // ⑧ 前置断言与标签绑定
    log('[1/9] 前置断言：工作区干净、main 分支…');
    assertWorktreeCleanAndMain(exec, fail);
    completed.push('前置断言（工作区干净、main 分支）');
    log('[2/9] 标签绑定校验：HEAD 标签与版本号一致、远端已有该标签…');
    const confVersion = readConfVersion(io.read(CONF_PATH), '标签绑定校验', fail);
    const tag = `v${confVersion}`;
    const tags = exec('git', ['tag', '--points-at', 'HEAD']);
    if (tags.error || tags.status !== 0) {
      fail('标签绑定校验', `无法读取 HEAD 上的标签（${tags.error ?? `退出码 ${tags.status}`}）。`);
    }
    const tagList = tags.stdout.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (!tagList.includes(tag)) {
      fail('标签绑定校验', `当前 HEAD 上没有标签 ${tag}（HEAD 现有标签：${tagList.join('、') || '无'}）。`, `按准备阶段打印的指引提交 main 并打标签：git tag v${confVersion} && git push origin v${confVersion}，再重跑 --publish。`);
    }
    const remoteTag = exec('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
    if (remoteTag.error || remoteTag.status !== 0 || remoteTag.stdout.trim() === '') {
      fail('标签绑定校验', `远端 origin 上还没有标签 ${tag}：创建 Release 需要远端已有该标签。`, `运行 git push origin ${tag} 后重跑 --publish。`);
    }
    completed.push('标签绑定校验（HEAD 标签与版本号一致、远端已有该标签）');

    // ⑨ 私钥与交互输入
    log('[3/9] 私钥文件检查…');
    if (!io.exists(keyPath)) {
      fail('私钥文件检查', `未找到更新签名私钥：${keyPath}`, '私钥的默认位置、备份与丢失后果见 docs/updater-key-custody.md；也可用 --key 指定其他路径。没有私钥无法发布带更新签名的版本。');
    }
    completed.push('私钥文件检查');
    log('[4/9] 收集中文更新说明…');
    const notes = await collectNotes(askText, askConfirm, log);
    completed.push('更新说明收集（已预览确认）');
    log('[5/9] 收集私钥密码（只经环境变量传给打包工具，不写入任何文件、不落盘）…');
    const password = await askSecret('请输入更新私钥的密码：');
    if (!password) {
      fail('私钥密码收集', '密码为空：签名打包无法进行。', '重跑 --publish 并输入 docs/updater-key-custody.md 记录的密码。');
    }
    completed.push('私钥密码收集');

    // ⑩ 签名打包
    log('[6/9] 签名打包 npm run tauri:build（耗时通常比前端构建长，无输出属正常）…');
    const build = exec('npm', ['run', 'tauri:build'], { env: buildTauriBuildEnv({ keyPath, password, baseEnv: env }) });
    if (build.error || build.status !== 0) {
      fail('签名打包（npm run tauri:build）', `构建失败（${build.error ?? `退出码 ${build.status}`}）：\n${tailOf(build.stdout, build.stderr)}`, '构建不改变工作区与标签；排查报错后直接重跑 --publish。');
    }
    completed.push('签名打包（tauri build 产出 -setup.exe 与 .sig）');

    // ⑪ 产物收集
    const nsisEntries = io.readdir(NSIS_DIR);
    const msiEntries = io.readdir(MSI_DIR);
    const picked = pickVersionedAssets({ nsisEntries, msiEntries, version: confVersion });
    if (!picked.ok) {
      fail('产物收集', picked.message, `确认 ${NSIS_DIR} 与 ${MSI_DIR} 产物后重跑 --publish；如有陈旧同名产物可删除后重新构建。`);
    }
    const { setupExe, setupSig, msi } = picked;
    completed.push(`产物收集（${setupExe}、${setupSig}、${msi}）`);

    // ⑫ latest.json 生成
    const signature = io.read(`${NSIS_DIR}/${setupSig}`);
    const latestJson = buildLatestJson({
      version: confVersion,
      notes: notes.notesText,
      signature,
      url: buildReleaseUrl(tag, setupExe),
      pubDate: now(),
    });
    completed.push('latest.json 生成');

    // ⑬ 稳定名副本与发布正文（临时目录，仅上传用）
    const tempDir = io.mkdirTemp();
    io.copy(`${NSIS_DIR}/${setupExe}`, join(tempDir, STABLE_SETUP_EXE));
    io.copy(`${MSI_DIR}/${msi}`, join(tempDir, STABLE_SETUP_MSI));
    const notesFile = join(tempDir, 'release-body.md');
    io.write(notesFile, buildReleaseBody(notes.notesText));
    const latestJsonFile = join(tempDir, LATEST_JSON_NAME);
    io.write(latestJsonFile, `${JSON.stringify(latestJson, null, 2)}\n`);
    completed.push('稳定名副本与发布正文准备');

    // ⑭ draft 创建或复用（同 tag draft 已存在则复用并 --clobber 覆盖附件）
    const assetPaths = [io.abs(`${NSIS_DIR}/${setupExe}`), io.abs(`${NSIS_DIR}/${setupSig}`), latestJsonFile, join(tempDir, STABLE_SETUP_EXE), join(tempDir, STABLE_SETUP_MSI)];
    const expectedNames = expectedReleaseAssetNames({ setupExe, setupSig });
    const existing = exec('gh', ['release', 'view', tag, '--json', 'isDraft,tagName']);
    if (existing.error) {
      fail('draft 创建/复用', `无法运行 gh 查询既有 Release（${existing.error}）。`);
    }
    let reused = false;
    if (existing.status === 0) {
      let view;
      try {
        view = JSON.parse(existing.stdout);
      } catch {
        fail('draft 创建/复用', `标签 ${tag} 的既有 Release 信息无法解析：\n${tailOf(existing.stdout)}`);
      }
      if (view?.isDraft !== true) {
        fail('draft 创建/复用', `标签 ${tag} 已存在【正式发布】的 Release：已正式发布的版本不得替换产物。`, '如需修正问题，请升版本号发新版本；不要删除或重传已发布版本的附件与标签。');
      }
      reused = true;
      log(`[7/9] 发现同标签 draft，复用该 draft 并覆盖附件…`);
      const editNotes = exec('gh', ['release', 'edit', tag, '--notes-file', notesFile]);
      if (editNotes.error || editNotes.status !== 0) {
        fail('draft 创建/复用', `更新 draft 正文失败：\n${tailOf(editNotes.stderr, editNotes.stdout)}`);
      }
    } else if (!/not found|HTTP 404/i.test(existing.stderr)) {
      fail('draft 创建/复用', `查询标签 ${tag} 的既有 Release 失败：\n${tailOf(existing.stderr, existing.stdout)}`, '网络恢复后重跑 --publish；若同标签 draft 已存在会自动复用。');
    } else {
      log('[7/9] 创建 draft Release 并上传全套发布物（5 件）…');
      const create = exec('gh', ['release', 'create', tag, '--draft', '--title', tag, '--notes-file', notesFile, ...assetPaths]);
      if (create.error || create.status !== 0) {
        fail('draft 上传', `创建 draft Release 失败：\n${tailOf(create.stderr, create.stdout)}`, 'draft 尚未建立或部分上传：直接重跑 --publish（上一正式 Release 不受影响，仍保持 latest）。');
      }
    }
    if (reused) {
      const upload = exec('gh', ['release', 'upload', tag, ...assetPaths, '--clobber']);
      if (upload.error || upload.status !== 0) {
        fail('draft 上传', `向既有 draft 上传附件失败：\n${tailOf(upload.stderr, upload.stdout)}`, 'draft 仍保留；直接重跑 --publish，会复用该 draft 并以 --clobber 覆盖同名附件。');
      }
    }
    completed.push(reused ? 'draft 复用与附件覆盖上传（--clobber）' : 'draft 创建与全套附件上传');

    // ⑮ 逐项核验：附件齐、latest.json 可下载可解析、版本/签名/直链与产物一致
    log('[8/9] 逐项核验 draft（附件齐备、latest.json 版本/签名/直链与产物一致）…');
    // GitHub 的 releases/tags/<tag> 接口不返回草稿（2026-11-13 真机实证：对草稿恒 404）；
    // 草稿核验改走列表接口（对有权限者含草稿），按 tag_name 定位条目。
    const releaseResult = exec('gh', ['api', `repos/${REPO_SLUG}/releases?per_page=100`]);
    if (releaseResult.error || releaseResult.status !== 0) {
      fail('逐项核验', `读取 Release 列表失败：\n${tailOf(releaseResult.stderr, releaseResult.stdout)}`, 'draft 已保留；重跑 --publish 复用 draft 后继续核验。');
    }
    let release;
    try {
      const list = JSON.parse(releaseResult.stdout);
      release = Array.isArray(list) ? list.find((entry) => entry && entry.tag_name === tag) : undefined;
    } catch {
      fail('逐项核验', 'Release 列表不是合法 JSON。');
    }
    if (!release) {
      fail('逐项核验', `Release 列表中未找到 ${tag}（草稿与正式版均未命中）。`, 'draft 可能未创建成功；重跑 --publish 会重新创建或复用 draft。');
    }
    if (release?.draft !== true) {
      fail('逐项核验', '该 Release 已不是 draft 状态，核验中止（不得替换已发布产物）。', '如需修正，升版本号发新版本。');
    }
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const assetNames = assets.map((asset) => asset.name);
    const missingAssets = findMissingReleaseAssets(assetNames, expectedNames);
    if (missingAssets.length > 0) {
      fail('逐项核验', `draft 附件不齐（缺：${missingAssets.join('、')}；实有：${assetNames.join('、') || '无'}）`, 'draft 已保留；直接重跑 --publish 复用 draft 并覆盖上传附件。');
    }
    const setupAsset = assets.find((asset) => asset.name === toRemoteAssetName(setupExe));
    const authoritativeUrl = typeof setupAsset?.browser_download_url === 'string' ? setupAsset.browser_download_url : null;
    if (authoritativeUrl === null || authoritativeUrl === '') {
      fail('逐项核验', `draft 中 ${setupExe} 缺少下载直链。`);
    }
    if (latestJson.platforms[PLATFORM_KEY].url !== authoritativeUrl) {
      log(`  GitHub 对附件直链的命名与预期不同，按实际直链重写 latest.json 并重新上传…`);
      io.write(latestJsonFile, `${JSON.stringify(buildLatestJson({
        version: confVersion,
        notes: notes.notesText,
        signature,
        url: authoritativeUrl,
        pubDate: now(),
      }), null, 2)}\n`);
      const reupload = exec('gh', ['release', 'upload', tag, latestJsonFile, '--clobber']);
      if (reupload.error || reupload.status !== 0) {
        fail('逐项核验', `按实际直链重传 latest.json 失败：\n${tailOf(reupload.stderr, reupload.stdout)}`, 'draft 保留；重跑 --publish。');
      }
    }
    const verifyDir = join(tempDir, 'verify');
    io.mkdir(verifyDir);
    const download = exec('gh', ['release', 'download', tag, '--pattern', LATEST_JSON_NAME, '--dir', verifyDir, '--clobber']);
    if (download.error || download.status !== 0) {
      fail('逐项核验', `下载 draft 的 latest.json 失败：\n${tailOf(download.stderr, download.stdout)}`, 'draft 保留；重跑 --publish。');
    }
    let downloadedLatest;
    try {
      downloadedLatest = JSON.parse(io.read(join(verifyDir, LATEST_JSON_NAME)));
    } catch {
      fail('逐项核验', 'draft 上的 latest.json 无法解析为 JSON。', 'draft 保留；重跑 --publish 会复用 draft 并覆盖 latest.json。');
    }
    const downloadedPlatform = downloadedLatest?.platforms?.[PLATFORM_KEY] ?? null;
    if (
      downloadedLatest?.version !== confVersion
      || downloadedPlatform === null
      || downloadedPlatform.signature !== signature.trim()
      || downloadedPlatform.url !== authoritativeUrl
    ) {
      fail('逐项核验', `draft 上 latest.json 与产物不一致：version=${downloadedLatest?.version ?? '缺失'}（期望 ${confVersion}）；签名${downloadedPlatform !== null && downloadedPlatform.signature === signature.trim() ? '一致' : '不一致'}；直链${downloadedPlatform !== null && downloadedPlatform.url === authoritativeUrl ? '一致' : '不一致'}。`, 'draft 保留；重跑 --publish 会复用 draft 并覆盖 latest.json。');
    }
    completed.push('逐项核验（附件齐备、latest.json 可下载可解析且版本/签名/直链与产物一致）');

    // ⑯ 转正式发布（此前上一正式 Release 始终是 latest）
    log('[9/9] 核验全部通过，将 draft 转为正式发布…');
    const promote = exec('gh', ['release', 'edit', tag, '--draft=false']);
    if (promote.error || promote.status !== 0) {
      fail('转正式发布', `将 draft 转正式失败：\n${tailOf(promote.stderr, promote.stdout)}`, `draft 与全部附件已就绪且核验通过；稍后手动运行 gh release edit ${tag} --draft=false 完成发布，或重跑 --publish（会复用 draft 并重新核验）。`);
    }
    completed.push('转正式发布');

    // latest 指向复查（警告级：发布已完成，不再回滚）
    let latestPointsAt = null;
    const latestCheck = exec('gh', ['api', `repos/${REPO_SLUG}/releases/latest`]);
    if (!latestCheck.error && latestCheck.status === 0) {
      try {
        latestPointsAt = JSON.parse(latestCheck.stdout)?.tag_name ?? null;
      } catch {
        latestPointsAt = null;
      }
    }
    if (latestPointsAt !== tag) {
      log(`提示：releases/latest 当前仍指向 ${latestPointsAt ?? '未知'}；刚发布的版本可能需要片刻生效，可用 gh api repos/${REPO_SLUG}/releases/latest 复查。`);
    } else {
      log(`releases/latest 已指向 ${tag}，更新渠道生效。`);
    }
    return { ok: true, tag, version: confVersion, reusedDraft: reused, latestPointsAt, assets: assetNames };
  } catch (error) {
    return toFailureResult(error, '发布阶段');
  } finally {
    if (typeof deps.cleanup === 'function') {
      deps.cleanup();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

export function usage() {
  return [
    '发版脚本（两阶段一条命令，add-auto-updater）：',
    '',
    '用法：',
    '  npm run release -- --prepare    准备阶段：前置断言 → 识别上一正式 Release → 总门禁 → 版本严格递增检查 → 版本号同步 → 打包准备检查 → 打印应提交清单（由维护者提交 main 并打标签）',
    '  npm run release -- --publish    发布阶段：标签绑定校验 → 收集更新说明与私钥密码 → 签名打包 → 生成 latest.json → draft 上传并逐项核验 → 转正式发布',
    '',
    '选项：',
    '  --key <路径>   指定更新签名私钥路径（默认 C:\\Users\\Administrator\\.tauri\\next-story-updater.key）',
    '  -h, --help     显示本说明',
    '',
    '两阶段完整走查与失败恢复表见 docs/DEVELOPMENT.md「发版」章节。',
  ].join('\n');
}

function printFailure(result) {
  console.error(`发版（${result.phase}）失败`);
  console.error(`失败阶段：${result.stage}`);
  if (result.completed.length > 0) {
    console.error(`已完成步骤：\n  - ${result.completed.join('\n  - ')}`);
  } else {
    console.error('已完成步骤：无');
  }
  console.error(`失败原因：\n${result.message}`);
  if (result.retry) {
    console.error(`安全重试指引：\n${result.retry}`);
  }
}

async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  let mode = null;
  let keyPath;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--prepare') {
      mode = 'prepare';
    } else if (arg === '--publish') {
      mode = 'publish';
    } else if (arg === '--key') {
      keyPath = args[i + 1];
      i += 1;
      if (typeof keyPath !== 'string' || keyPath === '') {
        console.error('--key 需要一个私钥文件路径参数。');
        process.exitCode = 2;
        return;
      }
    } else if (arg === '-h' || arg === '--help') {
      console.log(usage());
      return;
    } else {
      console.error(`未知参数：「${arg}」\n\n${usage()}`);
      process.exitCode = 2;
      return;
    }
  }
  if (mode === null) {
    console.error(usage());
    console.error('请指定 --prepare 或 --publish。');
    process.exitCode = 2;
    return;
  }
  const deps = createDefaultDeps();
  if (keyPath !== undefined) {
    deps.keyPath = keyPath;
  }
  try {
    const result = mode === 'prepare' ? await runPrepare(deps) : await runPublish(deps);
    if (result.ok) {
      console.log(mode === 'prepare' ? '准备阶段完成。' : `发布阶段完成：${result.tag} 已正式发布。`);
    } else {
      printFailure(result);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`发版脚本报出未预期的错误：\n${String(error && error.stack ? error.stack : error)}`);
    process.exitCode = 1;
  }
}

// 仅在直接运行（node scripts/release.mjs …）时执行 CLI；被测试导入时不自动运行。
const invokedDirectly = (() => {
  try {
    if (typeof process.argv[1] !== 'string') return false;
    const selfPath = resolve(process.argv[1]);
    const modulePath = fileURLToPath(import.meta.url);
    return process.platform === 'win32'
      ? selfPath.toLowerCase() === modulePath.toLowerCase()
      : selfPath === modulePath;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  await main();
}
