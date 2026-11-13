import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

/**
 * 发版两阶段脚本（scripts/release.mjs）的规格测试（add-auto-updater 任务 6.2）：
 * - 纯逻辑：SemVer 严格大于比较、latest.json 生成（platforms 键＋RFC 3339）、
 *   gh 结果分类（404＝首次发布 vs 网络错误 vs 认证错误 vs API 错误）、
 *   更新说明校验（1–5 条、空拒绝）、版本同步补丁（对临时 fixture 文件操作）、
 *   draft 附件核验（伪造附件清单断言齐/缺）。
 * - 流程（命令执行器与 io 全部注入，不触真实 git/gh/网络/构建）：
 *   准备阶段（含规格场景：版本未升被拒、门禁失败即止、首次发布成立、
 *   gh 未登录中文报错、网络失败不误判首次发布）与发布阶段
 *   （draft 创建/复用/核验/转正式、已正式发布拒改、私钥不落盘）。
 * - CLI：无参数时打印中文用法说明且退出码非 0（不触网络不触 git）。
 *
 * 导入说明：release.mjs 是纯 JS（scripts/ 不在 tsconfig 程序内），这里用
 * 计算式说明符动态加载真实模块，并在测试侧声明被测导出的形状；若实现与
 * 声明有出入，运行时断言会立刻暴露。
 */

// ---------------------------------------------------------------------------
// 被测模块的真实形状（测试侧声明）
// ---------------------------------------------------------------------------

interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

interface ExecCall {
  file: string;
  args: string[];
  opts?: { env?: Record<string, string | undefined> };
}

interface ExecFn {
  (file: string, args: string[], opts?: { env?: Record<string, string | undefined>; cwd?: string }): ExecResult;
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

type NotesValidation = { ok: true; lines: string[] } | { ok: false; message: string };
type IncreaseCheck =
  | { ok: true; firstRelease: boolean; previousVersion?: string }
  | { ok: false; message: string };
type AssetPick = { ok: true; setupExe: string; setupSig: string; msi: string } | { ok: false; message: string };
type GhClassification = { kind: "not-found" | "auth" | "network" | "api-error"; message: string };

interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: { "windows-x86_64": { signature: string; url: string } };
}

interface ConsistencyResult {
  ok: boolean;
  places: Array<{ place: string; version: string | null }>;
  mismatches: Array<{ place: string; version: string | null }>;
}

type PhaseResult =
  | { ok: true }
  | { ok: false; phase: string; stage: string; message: string; completed: string[]; retry: string };

type PrepareResult = PhaseResult & (
  | { ok: true; version: string; firstRelease: boolean; previousTag: string | null; filesToCommit: string[] }
  | { ok: false }
);

type PublishResult = PhaseResult & (
  | { ok: true; tag: string; version: string; reusedDraft: boolean; latestPointsAt: string | null; assets: string[] }
  | { ok: false }
);

interface ReleaseModule {
  parseSemver(version: string): SemverParts | null;
  tagToVersion(tag: string): string | null;
  compareSemver(a: string, b: string): number;
  isVersionStrictlyGreater(candidate: string, previous: string): boolean;
  checkVersionIncrease(input: { confVersion: string; previousTag: string | null }): IncreaseCheck;
  validateReleaseNotes(notes: string): NotesValidation;
  buildLatestJson(input: {
    version: string;
    notes: string;
    signature: string;
    url: string;
    pubDate?: Date | string;
  }): LatestJson;
  buildReleaseUrl(tag: string, fileName: string): string;
  buildReleaseBody(notesText: string): string;
  classifyGhFailure(input: { stderr?: string; stdout?: string }): GhClassification;
  patchPackageJsonVersion(text: string, version: string): string;
  patchPackageLockVersion(text: string, version: string): string;
  patchCargoTomlVersion(text: string, version: string): string;
  extractCargoTomlVersion(text: string): string | null;
  extractCargoLockVersion(text: string): string | null;
  checkVersionFilesConsistency(input: {
    confText: string;
    packageJsonText: string;
    packageLockText: string;
    cargoTomlText: string;
    cargoLockText: string;
    version: string;
  }): ConsistencyResult;
  syncVersionFiles(
    paths: { packageJsonPath: string; packageLockPath: string; cargoTomlPath: string; version: string },
    io: { read(path: string): string; write(path: string, text: string): void },
  ): { written: string[] };
  pickVersionedAssets(input: { nsisEntries: string[]; msiEntries: string[]; version: string }): AssetPick;
  expectedReleaseAssetNames(input: { setupExe: string; setupSig: string }): string[];
  findMissingReleaseAssets(actualNames: string[], expectedNames: string[]): string[];
  buildTauriBuildEnv(input: {
    keyPath: string;
    password: string;
    baseEnv?: Record<string, string | undefined>;
  }): Record<string, string | undefined>;
  runPrepare(deps?: { exec?: ExecFn; io?: FakeIo; log?: (text: string) => void }): Promise<PrepareResult>;
  runPublish(deps?: {
    exec?: ExecFn;
    io?: FakeIo;
    log?: (text: string) => void;
    askText?: (prompt: string) => Promise<string>;
    askConfirm?: (prompt: string) => Promise<boolean>;
    askSecret?: (prompt: string) => Promise<string>;
    now?: () => Date;
    env?: Record<string, string | undefined>;
    keyPath?: string;
    cleanup?: () => void;
  }): Promise<PublishResult>;
  usage(): string;
}

// 计算式说明符：tsc 不会尝试解析该导入，运行时加载真实模块。
const release = (await import(new URL("../scripts/release.mjs", import.meta.url).href)) as unknown as ReleaseModule;

// ---------------------------------------------------------------------------
// 伪造执行环境（参照 src/project-api.ts 的 InvokeFn 注入思路）
// ---------------------------------------------------------------------------

function createFakeIo(init: { files?: Record<string, string>; dirs?: Record<string, string[]>; existsOnly?: string[] }) {
  const files = new Map<string, string>(Object.entries(init.files ?? {}));
  const dirs = new Map<string, string[]>(Object.entries(init.dirs ?? {}));
  const existsOnly = new Set<string>(init.existsOnly ?? []);
  const writes: Array<{ path: string; text: string }> = [];
  const copies: Array<{ from: string; to: string }> = [];
  const madeDirs: string[] = [];
  let tempCounter = 0;
  const io = {
    files,
    writes,
    copies,
    madeDirs,
    abs: (p: string) => p,
    read: (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`fake io：没有文件 ${p}`);
      return text;
    },
    write: (p: string, text: string) => {
      files.set(p, text);
      writes.push({ path: p, text });
    },
    exists: (p: string) => files.has(p) || existsOnly.has(p),
    readdir: (p: string) => {
      const entries = dirs.get(p);
      if (entries === undefined) throw new Error(`fake io：没有目录 ${p}`);
      return [...entries];
    },
    copy: (from: string, to: string) => {
      copies.push({ from, to });
      files.set(to, `BINARY:${from}`);
    },
    mkdir: (p: string) => {
      madeDirs.push(p);
    },
    mkdirTemp: () => {
      tempCounter += 1;
      return `/tmp/next-story-release-test-${tempCounter}`;
    },
  };
  return io;
}

type FakeIo = ReturnType<typeof createFakeIo>;

interface ScriptedEntry {
  /** [命令, …须出现在 args 中的区分性 token] */
  match: string[];
  result: ExecResult;
  effect?: () => void;
}

function createScriptedExec(entries: ScriptedEntry[]) {
  const calls: ExecCall[] = [];
  const exec = (file: string, args: string[], opts?: { env?: Record<string, string | undefined> }): ExecResult => {
    calls.push({ file, args, opts });
    const entry = entries.find(
      // token 采用子串匹配：如 gh api 的参数是完整的 repos/irisnb/next-story/releases/latest。
      (item) => item.match[0] === file && item.match.slice(1).every((token) => args.some((arg) => arg.includes(token))),
    );
    if (entry === undefined) {
      throw new Error(`测试脚本未覆盖该命令：${file} ${args.join(" ")}`);
    }
    if (entry.effect) entry.effect();
    return entry.result;
  };
  /** 首个「命令名或参数包含全部 token」的调用序号（找不到返回 -1）。 */
  const callIndex = (...tokens: string[]) =>
    calls.findIndex((call) => {
      const parts = [call.file, ...call.args];
      return tokens.every((token) => parts.some((part) => part.includes(token)));
    });
  return { exec, calls, callIndex };
}

const ok = (stdout = "") => ({ status: 0, stdout, stderr: "", error: null });
const failed = (stderr = "") => ({ status: 1, stdout: "", stderr, error: null });

// ---------------------------------------------------------------------------
// fixture 文本
// ---------------------------------------------------------------------------

const CONF = (version: string) => `${JSON.stringify({ productName: "Next Story", version }, null, 2)}\n`;
const PKG = (version: string) => `${JSON.stringify({ name: "next-story", private: true, version }, null, 2)}\n`;
const PKG_LOCK = (version: string) =>
  `${JSON.stringify(
    {
      name: "next-story",
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "next-story", version },
        "node_modules/foo": { version: "1.0.0" },
      },
    },
    null,
    2,
  )}\n`;
const CARGO_TOML = (version: string) =>
  `[package]\nname = "next-story"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "~2.11.5", features = [] }\nserde = "1"\n`;
const CARGO_LOCK = (version: string) =>
  `# This file is automatically @generated by Cargo.\nversion = 4\n\n[[package]]\nname = "adler2"\nversion = "2.0.1"\n\n[[package]]\nname = "next-story"\nversion = "${version}"\ndependencies = [\n "tauri",\n]\n`;

const PACKAGING_FILES = [
  "sidecar/node-runtime/node.exe",
  "sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js",
  "sidecar/driver/driver.mjs",
];

const CONF_PATH = "src-tauri/tauri.conf.json";
const NSIS_DIR = "src-tauri/target/release/bundle/nsis";
const MSI_DIR = "src-tauri/target/release/bundle/msi";
const SETUP_EXE = "Next Story_0.2.0_x64-setup.exe";
const SETUP_SIG = "Next Story_0.2.0_x64-setup.exe.sig";
const SETUP_MSI = "Next Story_0.2.0_x64_en-US.msi";

// ---------------------------------------------------------------------------
// 纯逻辑测试
// ---------------------------------------------------------------------------

test("parseSemver 与 tagToVersion：三段数字合法，v 前缀标签可还原版本", () => {
  assert.deepStrictEqual(release.parseSemver("0.2.0"), { major: 0, minor: 2, patch: 0 });
  assert.strictEqual(release.parseSemver("1.2"), null);
  assert.strictEqual(release.parseSemver("v0.1.2"), null);
  assert.strictEqual(release.tagToVersion("v0.1.2"), "0.1.2");
  assert.strictEqual(release.tagToVersion("0.1.2"), null);
  assert.strictEqual(release.tagToVersion("v0.1"), null);
});

test("compareSemver：严格大小按 major/minor/patch 逐段比较，相等为 0，格式非法抛中文错误", () => {
  assert.strictEqual(release.compareSemver("0.2.0", "0.1.2"), 1);
  assert.strictEqual(release.compareSemver("1.0.0", "0.99.99"), 1);
  assert.strictEqual(release.compareSemver("0.1.2", "0.2.0"), -1);
  assert.strictEqual(release.compareSemver("0.1.2", "0.1.2"), 0);
  assert.strictEqual(release.compareSemver("0.1.10", "0.1.9"), 1);
  assert.ok(release.isVersionStrictlyGreater("0.2.0", "0.1.2"));
  assert.ok(!release.isVersionStrictlyGreater("0.1.2", "0.1.2"));
  assert.ok(!release.isVersionStrictlyGreater("0.1.1", "0.1.2"));
  assert.throws(() => release.compareSemver("a.b.c", "0.1.0"), /版本号格式无效/);
});

test("checkVersionIncrease：首次发布成立；未严格大于被拒并给中文指引", () => {
  const first = release.checkVersionIncrease({ confVersion: "0.2.0", previousTag: null });
  assert.ok(first.ok && first.firstRelease);

  const equal = release.checkVersionIncrease({ confVersion: "0.2.0", previousTag: "v0.2.0" });
  assert.ok(!equal.ok);
  assert.match(equal.ok ? "" : equal.message, /严格大于/);

  const lower = release.checkVersionIncrease({ confVersion: "0.1.2", previousTag: "v0.2.0" });
  assert.ok(!lower.ok);

  const badTag = release.checkVersionIncrease({ confVersion: "0.2.1", previousTag: "release-1" });
  assert.ok(!badTag.ok);
  assert.match(badTag.ok ? "" : badTag.message, /v x\.y\.z/);
});

test("validateReleaseNotes：空与全空白拒绝，1–5 条通过，超 5 条拒绝并提示合并", () => {
  assert.ok(!release.validateReleaseNotes("").ok);
  assert.ok(!release.validateReleaseNotes("   \n\t\n").ok);
  const one = release.validateReleaseNotes("新增自动检查更新");
  assert.ok(one.ok && one.lines.length === 1);
  const five = release.validateReleaseNotes(Array.from({ length: 5 }, (_, i) => `第 ${i + 1} 条`).join("\n"));
  assert.ok(five.ok && five.lines.length === 5);
  const six = release.validateReleaseNotes(Array.from({ length: 6 }, (_, i) => `第 ${i + 1} 条`).join("\n"));
  assert.ok(!six.ok);
  assert.match(six.ok ? "" : six.message, /1–5 条/);
  const trimmed = release.validateReleaseNotes("\n  前后有空白  \n");
  assert.ok(trimmed.ok && trimmed.lines[0] === "前后有空白");
});

test("buildLatestJson：完整 JSON 形状含 platforms 键，pub_date 为 RFC 3339，签名为原文 trim", () => {
  const json = release.buildLatestJson({
    version: "0.2.0",
    notes: "- 新增更新检查",
    signature: "SIG-CONTENT-123\n",
    url: "https://github.com/irisnb/next-story/releases/download/v0.2.0/x.exe",
    pubDate: new Date("2026-11-13T08:00:00.000Z"),
  });
  assert.deepStrictEqual(json, {
    version: "0.2.0",
    notes: "- 新增更新检查",
    pub_date: "2026-11-13T08:00:00.000Z",
    platforms: {
      "windows-x86_64": {
        signature: "SIG-CONTENT-123",
        url: "https://github.com/irisnb/next-story/releases/download/v0.2.0/x.exe",
      },
    },
  });
  assert.match(json.pub_date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
});

test("buildLatestJson：空签名、非 https 直链、坏版本号均抛中文错误", () => {
  assert.throws(() => release.buildLatestJson({ version: "0.2.0", notes: "x", signature: "  ", url: "https://e/x" }), /签名/);
  assert.throws(() => release.buildLatestJson({ version: "0.2.0", notes: "x", signature: "s", url: "http://e/x" }), /https/);
  assert.throws(() => release.buildLatestJson({ version: "0.2", notes: "x", signature: "s", url: "https://e/x" }), /x\.y\.z/);
});

test("buildReleaseUrl：版本化产物直链带 tag，文件名空格按 URL 编码", () => {
  assert.strictEqual(
    release.buildReleaseUrl("v0.2.0", SETUP_EXE),
    "https://github.com/irisnb/next-story/releases/download/v0.2.0/Next%20Story_0.2.0_x64-setup.exe",
  );
});

test("buildReleaseBody：正文含更新说明原文与既有 SmartScreen 指引（仍要运行）", () => {
  const body = release.buildReleaseBody("- 修复导出问题\n- 新增更新检查");
  assert.ok(body.includes("- 修复导出问题"));
  assert.ok(body.includes("SmartScreen"));
  assert.ok(body.includes("仍要运行"));
});

test("classifyGhFailure：404＝首次发布；认证、网络、其余 API 失败严格区分且附中文修复方法", () => {
  const notFound = release.classifyGhFailure({ stderr: "gh: Not Found (HTTP 404)\n" });
  assert.strictEqual(notFound.kind, "not-found");

  const auth = release.classifyGhFailure({ stderr: "gh: HTTP 401: Bad credentials\n" });
  assert.strictEqual(auth.kind, "auth");
  assert.ok(auth.message.includes("gh auth login"));

  const network = release.classifyGhFailure({ stderr: "fatal: unable to access: Could not resolve host\n" });
  assert.strictEqual(network.kind, "network");
  assert.ok(network.message.includes("网络"));
  assert.ok(network.message.includes("首次发布"));

  const api = release.classifyGhFailure({ stderr: "gh: HTTP 500: Internal Server Error\n" });
  assert.strictEqual(api.kind, "api-error");
  assert.ok(api.message.length > 0);
});

test("patchPackageJsonVersion：替换根 version；缺字段抛中文错误", () => {
  const patched = release.patchPackageJsonVersion(PKG("0.1.2"), "0.2.0");
  assert.strictEqual(JSON.parse(patched).version, "0.2.0");
  assert.throws(() => release.patchPackageJsonVersion('{"name":"x"}\n', "0.2.0"), /version/);
});

test("patchPackageLockVersion：根对象与 packages[\"\"] 两处替换，依赖条目 version 不动；定位异常拒绝", () => {
  const patched = release.patchPackageLockVersion(PKG_LOCK("0.1.2"), "0.2.0");
  const parsed = JSON.parse(patched) as { version: string; packages: Record<string, { version?: string }> };
  assert.strictEqual(parsed.version, "0.2.0");
  assert.strictEqual(parsed.packages[""].version, "0.2.0");
  assert.strictEqual(parsed.packages["node_modules/foo"].version, "1.0.0");

  // packages 段没有 "" 条目（版本字段落在依赖条目区）→ 拒绝同步。
  const noRoot = JSON.stringify({
    version: "0.1.2",
    lockfileVersion: 3,
    packages: { "node_modules/foo": { version: "1.0.0" } },
  });
  assert.throws(() => release.patchPackageLockVersion(noRoot, "0.2.0"), /定位异常/);
});

test("patchCargoTomlVersion：只替换 [package] 段的 version，依赖版本不动；缺 [package] 抛错", () => {
  const patched = release.patchCargoTomlVersion(CARGO_TOML("0.1.2"), "0.2.0");
  assert.strictEqual(release.extractCargoTomlVersion(patched), "0.2.0");
  assert.ok(patched.includes('tauri = { version = "~2.11.5"'));
  assert.throws(() => release.patchCargoTomlVersion("[dependencies]\ntauri = \"1\"\n", "0.2.0"), /\[package\]/);
});

test("extractCargoLockVersion：按 name = \"next-story\" 邻接定位；缺失返回 null", () => {
  assert.strictEqual(release.extractCargoLockVersion(CARGO_LOCK("0.1.2")), "0.1.2");
  assert.strictEqual(release.extractCargoLockVersion(CARGO_LOCK("0.1.2").replace('name = "next-story"', 'name = "other"')), null);
});

test("syncVersionFiles：对临时 fixture 文件完成三处同步（含六处一致性）", () => {
  const dir = mkdtempSync(join(tmpdir(), "next-story-release-test-"));
  try {
    const pkgPath = join(dir, "package.json");
    const lockPath = join(dir, "package-lock.json");
    const tomlPath = join(dir, "Cargo.toml");
    writeFileSync(pkgPath, PKG("0.1.2"), "utf8");
    writeFileSync(lockPath, PKG_LOCK("0.1.2"), "utf8");
    writeFileSync(tomlPath, CARGO_TOML("0.1.2"), "utf8");
    const { written } = release.syncVersionFiles(
      { packageJsonPath: pkgPath, packageLockPath: lockPath, cargoTomlPath: tomlPath, version: "0.2.0" },
      { read: (p) => readFileSync(p, "utf8"), write: (p, t) => writeFileSync(p, t, "utf8") },
    );
    assert.strictEqual(written.length, 3);
    assert.strictEqual(JSON.parse(readFileSync(pkgPath, "utf8")).version, "0.2.0");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { version: string; packages: Record<string, { version?: string }> };
    assert.strictEqual(lock.version, "0.2.0");
    assert.strictEqual(lock.packages[""].version, "0.2.0");
    assert.strictEqual(release.extractCargoTomlVersion(readFileSync(tomlPath, "utf8")), "0.2.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncVersionFiles：任一文件无法补丁时不写任何文件（原子性）", () => {
  const dir = mkdtempSync(join(tmpdir(), "next-story-release-test-"));
  try {
    const pkgPath = join(dir, "package.json");
    const lockPath = join(dir, "package-lock.json");
    const brokenTomlPath = join(dir, "Cargo.toml");
    const original = PKG("0.1.2");
    writeFileSync(pkgPath, original, "utf8");
    writeFileSync(lockPath, PKG_LOCK("0.1.2"), "utf8");
    writeFileSync(brokenTomlPath, "没有 package 段\n", "utf8");
    assert.throws(
      () =>
        release.syncVersionFiles(
          { packageJsonPath: pkgPath, packageLockPath: lockPath, cargoTomlPath: brokenTomlPath, version: "0.2.0" },
          { read: (p) => readFileSync(p, "utf8"), write: (p, t) => writeFileSync(p, t, "utf8") },
        ),
      /Cargo\.toml/,
    );
    assert.strictEqual(readFileSync(pkgPath, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkVersionFilesConsistency：六处一致通过；Cargo.lock 陈旧时按处所报告", () => {
  const consistent = release.checkVersionFilesConsistency({
    confText: CONF("0.2.0"),
    packageJsonText: PKG("0.2.0"),
    packageLockText: PKG_LOCK("0.2.0"),
    cargoTomlText: CARGO_TOML("0.2.0"),
    cargoLockText: CARGO_LOCK("0.2.0"),
    version: "0.2.0",
  });
  assert.ok(consistent.ok);
  assert.strictEqual(consistent.places.length, 6);

  const stale = release.checkVersionFilesConsistency({
    confText: CONF("0.2.0"),
    packageJsonText: PKG("0.2.0"),
    packageLockText: PKG_LOCK("0.2.0"),
    cargoTomlText: CARGO_TOML("0.2.0"),
    cargoLockText: CARGO_LOCK("0.1.2"),
    version: "0.2.0",
  });
  assert.ok(!stale.ok);
  assert.strictEqual(stale.mismatches.length, 1);
  assert.strictEqual(stale.mismatches[0].place, "src-tauri/Cargo.lock");
  assert.strictEqual(stale.mismatches[0].version, "0.1.2");
});

test("pickVersionedAssets：陈旧产物在场也只认本版本；缺 sig、多候选、缺 msi 均报错", () => {
  const picked = release.pickVersionedAssets({
    nsisEntries: ["Next Story_0.1.1_x64-setup.exe", "Next Story_0.1.1_x64-setup.exe.sig", SETUP_EXE, SETUP_SIG, "unrelated.txt"],
    msiEntries: ["Next Story_0.1.1_x64_en-US.msi", SETUP_MSI],
    version: "0.2.0",
  });
  assert.ok(picked.ok);
  if (picked.ok) {
    assert.strictEqual(picked.setupExe, SETUP_EXE);
    assert.strictEqual(picked.setupSig, SETUP_SIG);
    assert.strictEqual(picked.msi, SETUP_MSI);
  }

  const noSig = release.pickVersionedAssets({ nsisEntries: [SETUP_EXE], msiEntries: [SETUP_MSI], version: "0.2.0" });
  assert.ok(!noSig.ok);
  assert.match(noSig.ok ? "" : noSig.message, /签名文件/);

  const ambiguous = release.pickVersionedAssets({
    nsisEntries: [SETUP_EXE, "Beta_0.2.0_x64-setup.exe", SETUP_SIG],
    msiEntries: [SETUP_MSI],
    version: "0.2.0",
  });
  assert.ok(!ambiguous.ok);
  assert.match(ambiguous.ok ? "" : ambiguous.message, /恰好 1 个/);

  const noMsi = release.pickVersionedAssets({ nsisEntries: [SETUP_EXE, SETUP_SIG], msiEntries: [], version: "0.2.0" });
  assert.ok(!noMsi.ok);
});

test("findMissingReleaseAssets 与 expectedReleaseAssetNames：五件套齐备/缺失判定", () => {
  const expected = release.expectedReleaseAssetNames({ setupExe: SETUP_EXE, setupSig: SETUP_SIG });
  assert.deepStrictEqual(expected, [SETUP_EXE, SETUP_SIG, "latest.json", "NextStory-setup.exe", "NextStory-setup.msi"]);
  assert.deepStrictEqual(release.findMissingReleaseAssets(expected, expected), []);
  assert.deepStrictEqual(release.findMissingReleaseAssets([SETUP_EXE], expected), [
    SETUP_SIG,
    "latest.json",
    "NextStory-setup.exe",
    "NextStory-setup.msi",
  ]);
});

test("私钥不落盘（纯逻辑）：密码只进环境变量，latest.json 与版本补丁文本均不含密码", () => {
  const password = "TOP-SECRET-PASSWORD-42";
  const env = release.buildTauriBuildEnv({ keyPath: "/keys/updater.key", password, baseEnv: { PATH: "p" } });
  assert.strictEqual(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, password);
  assert.strictEqual(env.TAURI_SIGNING_PRIVATE_KEY, "/keys/updater.key");
  assert.strictEqual(env.TAURI_SIGNING_PRIVATE_KEY_PATH, "/keys/updater.key");
  assert.strictEqual(env.PATH, "p");

  const latestText = JSON.stringify(
    release.buildLatestJson({ version: "0.2.0", notes: "x", signature: "s", url: "https://e/x", pubDate: new Date(0) }),
  );
  assert.ok(!latestText.includes(password));
  assert.ok(!release.patchPackageJsonVersion(PKG("0.1.2"), "0.2.0").includes(password));
  assert.ok(!release.buildReleaseBody("- 说明").includes(password));
});

test("usage：无参数直接运行打印中文用法说明且退出码非 0（不触网络不触 git）", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const run = spawnSync(process.execPath, ["scripts/release.mjs"], { cwd: repoRoot, encoding: "utf8" });
  assert.strictEqual(run.status, 2);
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  assert.ok(output.includes("用法"));
  assert.ok(output.includes("--prepare"));
  assert.ok(output.includes("--publish"));
  assert.ok(output.includes("--key"));
  // 直接调用 usage() 也包含两模式说明。
  const usage = release.usage();
  assert.ok(usage.includes("--prepare") && usage.includes("--publish"));
});

// ---------------------------------------------------------------------------
// 准备阶段流程测试（注入执行器与 io，不触真实 git/gh/网络/构建）
// ---------------------------------------------------------------------------

function prepareDeps(script: ScriptedEntry[], files: Record<string, string>, cargoCheckEffect?: (io: FakeIo) => void) {
  const io = createFakeIo({ files, existsOnly: PACKAGING_FILES });
  const kit = createScriptedExec([
    // 用户覆盖条目排在基础条目之前：find 取首个命中，保证失败注入能遮蔽默认成功。
    ...script,
    { match: ["git", "status", "--porcelain"], result: ok() },
    { match: ["git", "branch", "--show-current"], result: ok("main\n") },
    { match: ["git", "remote", "get-url"], result: ok("https://github.com/irisnb/next-story.git\n") },
    { match: ["gh", "--version"], result: ok("gh version 2.63.0\n") },
    { match: ["gh", "auth", "status"], result: ok("Logged in to github.com\n") },
    { match: ["gh", "--jq"], result: ok("true\n") },
    { match: ["npm", "run", "check"], result: ok("全绿\n") },
    // cargo check 会同步 Cargo.lock——测试里用副作用模拟（默认条目带 effect）。
    {
      match: ["cargo", "check"],
      result: ok(),
      ...(cargoCheckEffect ? { effect: () => cargoCheckEffect(io) } : {}),
    },
  ]);
  const logs: string[] = [];
  return { io, kit, logs, deps: { exec: kit.exec as ExecFn, io, log: (t: string) => logs.push(t) } };
}

const PREPARE_FILES = {
  [CONF_PATH]: CONF("0.2.0"),
  "package.json": PKG("0.1.2"),
  "package-lock.json": PKG_LOCK("0.1.2"),
  "src-tauri/Cargo.toml": CARGO_TOML("0.1.2"),
  "src-tauri/Cargo.lock": CARGO_LOCK("0.1.2"),
};

test("准备阶段一条命令：断言→门禁→比对→同步→打包检查→打印应提交清单（版本号分岔被同步）", async () => {
  const { io, kit, logs, deps } = prepareDeps(
    [{ match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.1.2" })) }],
    PREPARE_FILES,
    (fakeIo) => fakeIo.files.set("src-tauri/Cargo.lock", CARGO_LOCK("0.2.0")), // cargo check 同步 Cargo.lock
  );
  const result = await release.runPrepare(deps);

  assert.ok(result.ok);
  if (result.ok) {
    assert.strictEqual(result.version, "0.2.0");
    assert.strictEqual(result.firstRelease, false);
    assert.strictEqual(result.previousTag, "v0.1.2");
    assert.ok(result.filesToCommit.includes("package-lock.json"));
    assert.ok(result.filesToCommit.includes("src-tauri/Cargo.lock"));
  }
  // 六处版本号分岔被同步（package-lock 依赖条目不动）。
  const lock = JSON.parse(io.files.get("package-lock.json") ?? "") as { version: string; packages: Record<string, { version?: string }> };
  assert.strictEqual(lock.version, "0.2.0");
  assert.strictEqual(lock.packages[""].version, "0.2.0");
  assert.strictEqual(lock.packages["node_modules/foo"].version, "1.0.0");
  assert.strictEqual(release.extractCargoTomlVersion(io.files.get("src-tauri/Cargo.toml") ?? ""), "0.2.0");
  assert.strictEqual(io.writes.length, 3);
  // 门禁先于版本同步执行。
  assert.ok(kit.callIndex("run", "check") >= 0);
  assert.ok(kit.callIndex("run", "check") < kit.callIndex("cargo", "check"));
  // 打印了应提交清单与下一步指引（含 --publish）。
  assert.ok(logs.some((line) => line.includes("git tag v0.2.0")));
  assert.ok(logs.some((line) => line.includes("--publish")));
});

test("规格场景：首次发布成立（HTTP 404 跳过版本比对，流程继续）", async () => {
  const { deps } = prepareDeps(
    [{ match: ["gh", "releases/latest"], result: failed("gh: Not Found (HTTP 404)\n") }],
    PREPARE_FILES,
    (io) => io.files.set("src-tauri/Cargo.lock", CARGO_LOCK("0.2.0")),
  );
  const result = await release.runPrepare(deps);
  assert.ok(result.ok);
  if (result.ok) assert.strictEqual(result.firstRelease, true);
});

test("规格场景：网络失败与 404 严格区分，不误判为首次发布", async () => {
  const { deps } = prepareDeps(
    [{ match: ["gh", "releases/latest"], result: failed("fatal: unable to access: Could not resolve host\n") }],
    PREPARE_FILES,
  );
  const result = await release.runPrepare(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.strictEqual(result.stage, "识别上一正式 Release");
    assert.ok(result.message.includes("网络"));
    assert.ok(result.message.includes("首次发布"));
  }
});

test("规格场景：门禁失败即止（不产出 Release、不做版本同步）", async () => {
  const { io, kit, deps } = prepareDeps(
    [
      { match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.1.2" })) },
      { match: ["npm", "run", "check"], result: failed("test 失败\n") },
    ],
    PREPARE_FILES,
  );
  const result = await release.runPrepare(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.ok(result.stage.includes("总门禁"));
    assert.strictEqual(io.writes.length, 0);
    assert.strictEqual(kit.callIndex("cargo", "check"), -1);
  }
});

test("规格场景：版本未升被拒（中文可读错误，不上传任何发布物、不写文件）", async () => {
  const files = { ...PREPARE_FILES, [CONF_PATH]: CONF("0.1.2") }; // 与上一版相同
  const { io, deps } = prepareDeps(
    [{ match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.1.2" })) }],
    files,
  );
  const result = await release.runPrepare(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.strictEqual(result.stage, "版本严格递增检查");
    assert.ok(result.message.includes("严格大于"));
    assert.strictEqual(io.writes.length, 0);
  }
});

test("规格场景：gh 未登录中文报错并说明修复方法，不进入构建", async () => {
  const { kit, deps } = prepareDeps(
    [{ match: ["gh", "auth", "status"], result: failed("not logged in, please run gh auth login\n") }],
    PREPARE_FILES,
  );
  const result = await release.runPrepare(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.strictEqual(result.stage, "前置断言");
    assert.ok(result.message.includes("gh auth login"));
    assert.strictEqual(kit.callIndex("run", "check"), -1);
  }
});

test("准备阶段：工作区不干净即止", async () => {
  const { deps } = prepareDeps(
    [{ match: ["git", "status", "--porcelain"], result: ok(" M src/x.ts\n") }],
    PREPARE_FILES,
  );
  const result = await release.runPrepare(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.strictEqual(result.stage, "前置断言");
    assert.ok(result.message.includes("不干净"));
  }
});

// ---------------------------------------------------------------------------
// 发布阶段流程测试（注入执行器、io 与交互输入）
// ---------------------------------------------------------------------------

const AUTHORITATIVE_URL =
  "https://github.com/irisnb/next-story/releases/download/v0.2.0/Next.Story_0.2.0_x64-setup.exe";

function draftReleaseJson(draft: boolean) {
  return JSON.stringify({
    tag_name: "v0.2.0",
    draft,
    assets: [
      { name: SETUP_EXE, browser_download_url: AUTHORITATIVE_URL },
      { name: SETUP_SIG, browser_download_url: `${AUTHORITATIVE_URL}.sig` },
      { name: "latest.json", browser_download_url: "https://github.com/irisnb/next-story/releases/download/v0.2.0/latest.json" },
      { name: "NextStory-setup.exe", browser_download_url: "https://github.com/irisnb/next-story/releases/download/v0.2.0/NextStory-setup.exe" },
      { name: "NextStory-setup.msi", browser_download_url: "https://github.com/irisnb/next-story/releases/download/v0.2.0/NextStory-setup.msi" },
    ],
  });
}

const PUBLISH_FILES = {
  [CONF_PATH]: CONF("0.2.0"),
  [`${NSIS_DIR}/${SETUP_SIG}`]: "SIG-CONTENT-123\n",
};
const PUBLISH_DIRS = {
  [NSIS_DIR]: [SETUP_EXE, SETUP_SIG, "unrelated.txt"],
  [MSI_DIR]: [SETUP_MSI],
};

function queueAnswers(texts: string[]) {
  const queue = [...texts];
  return async () => {
    const value = queue.shift();
    if (value === undefined) throw new Error("测试答案队列已空");
    return value;
  };
}

function publishDeps(
  makeEntries: (io: FakeIo) => ScriptedEntry[],
  options?: {
    askText?: (prompt: string) => Promise<string>;
    askConfirm?: (prompt: string) => Promise<boolean>;
    askSecret?: (prompt: string) => Promise<string>;
  },
) {
  const io = createFakeIo({ files: PUBLISH_FILES, dirs: PUBLISH_DIRS, existsOnly: ["/keys/updater.key"] });
  const kit = createScriptedExec([
    { match: ["git", "status", "--porcelain"], result: ok() },
    { match: ["git", "branch", "--show-current"], result: ok("main\n") },
    { match: ["git", "tag", "--points-at"], result: ok("v0.2.0\n") },
    { match: ["git", "ls-remote"], result: ok("d3adb33f\trefs/tags/v0.2.0\n") },
    { match: ["npm", "run", "tauri:build"], result: ok("构建完成\n") },
    ...makeEntries(io),
  ]);
  const logs: string[] = [];
  const deps = {
    exec: kit.exec as ExecFn,
    io,
    log: (t: string) => logs.push(t),
    askText: options?.askText ?? queueAnswers(["新增自动检查更新", ""]),
    askConfirm: options?.askConfirm ?? (async () => true),
    askSecret: options?.askSecret ?? (async () => "TOP-SECRET-PASSWORD-42"),
    now: () => new Date("2026-11-13T08:00:00.000Z"),
    env: { PATH: "keep" },
    keyPath: "/keys/updater.key",
  };
  return { io, kit, logs, deps };
}

/** 下载核验的伪造副作用：draft 上的 latest.json 应与本地生成的一致（路径分隔符与脚本同源）。 */
function fakeDownloadLatestJson(io: FakeIo): () => void {
  const tempDir = "/tmp/next-story-release-test-1";
  return () => {
    io.files.set(
      join(tempDir, "verify", "latest.json"),
      io.files.get(join(tempDir, "latest.json")) ?? "",
    );
  };
}

/** 取指定谓词最后命中的写出文本（latest.json 会被直链校准重写，取最终版）。 */
function lastWrite(io: FakeIo, suffix: string): string {
  const entries = io.writes.filter((writeEntry) => writeEntry.path.endsWith(suffix));
  return entries.length > 0 ? entries[entries.length - 1].text : "";
}

test("发布阶段一条命令：draft 上传全套并逐项核验后转正式（含直链校准与私钥不落盘）", async () => {
  const { io, kit, deps } = publishDeps((fakeIo) => [
    { match: ["gh", "release", "view"], result: failed("release not found: v0.2.0\n") },
    { match: ["gh", "release", "create"], result: ok("https://github.com/irisnb/next-story/releases/tag/v0.2.0\n") },
    { match: ["gh", "releases?per_page"], result: ok("[" + draftReleaseJson(true) + "]") },
    // GitHub 把附件名中的空格改写为点号 → 直链校准后按实际直链重传 latest.json。
    { match: ["gh", "release", "upload"], result: ok() },
    { match: ["gh", "release", "download"], result: ok(), effect: fakeDownloadLatestJson(fakeIo) },
    { match: ["gh", "release", "edit"], result: ok("发布成功\n") },
    { match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.2.0" })) },
  ]);

  const result = await release.runPublish(deps);

  assert.ok(result.ok);
  if (result.ok) {
    assert.strictEqual(result.tag, "v0.2.0");
    assert.strictEqual(result.reusedDraft, false);
    assert.strictEqual(result.latestPointsAt, "v0.2.0");
    assert.strictEqual(result.assets.length, 5);
  }
  // draft 创建带 --draft、--notes-file 与 5 件附件；转正式 --draft=false 已执行。
  const createCall = kit.calls.find((call) => call.args.includes("release") && call.args.includes("create"));
  assert.ok(createCall);
  assert.ok(createCall?.args.includes("--draft"));
  assert.ok(createCall?.args.includes("--notes-file"));
  assert.strictEqual(createCall?.args.filter((arg) => arg.includes(".exe") || arg.includes(".msi") || arg.includes("latest.json")).length, 5);
  assert.ok(kit.callIndex("--draft=false") >= 0);
  // 密码只经环境变量传给构建子进程，基础环境保留。
  const buildCall = kit.calls.find((call) => call.args.includes("tauri:build"));
  assert.strictEqual(buildCall?.opts?.env?.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "TOP-SECRET-PASSWORD-42");
  assert.strictEqual(buildCall?.opts?.env?.TAURI_SIGNING_PRIVATE_KEY, "/keys/updater.key");
  assert.strictEqual(buildCall?.opts?.env?.TAURI_SIGNING_PRIVATE_KEY_PATH, "/keys/updater.key");
  assert.strictEqual(buildCall?.opts?.env?.PATH, "keep");
  // 脚本写出的所有文件（正文、latest.json）都不含密码（私钥不落盘）。
  assert.ok(io.writes.length > 0);
  assert.ok(io.writes.every((writeEntry) => !writeEntry.text.includes("TOP-SECRET-PASSWORD-42")));
  // latest.json 最终版采用 GitHub 实际直链（空格被改写为点号），版本/签名与产物一致。
  const latest = JSON.parse(lastWrite(io, "latest.json")) as LatestJson;
  assert.strictEqual(latest.version, "0.2.0");
  assert.strictEqual(latest.notes, "新增自动检查更新");
  assert.strictEqual(latest.pub_date, "2026-11-13T08:00:00.000Z");
  assert.strictEqual(latest.platforms["windows-x86_64"].signature, "SIG-CONTENT-123");
  assert.strictEqual(latest.platforms["windows-x86_64"].url, AUTHORITATIVE_URL);
  // 稳定名副本已复制（仅临时目录，供上传）。
  assert.ok(io.copies.some((copyEntry) => copyEntry.to.endsWith("NextStory-setup.exe")));
  assert.ok(io.copies.some((copyEntry) => copyEntry.to.endsWith("NextStory-setup.msi")));
});

test("发布阶段：更新说明同文两处（latest.json 与 Release 正文一致）", async () => {
  const { io, deps } = publishDeps((fakeIo) => [
    { match: ["gh", "release", "view"], result: failed("release not found: v0.2.0\n") },
    { match: ["gh", "release", "create"], result: ok("url\n") },
    { match: ["gh", "releases?per_page"], result: ok("[" + draftReleaseJson(true) + "]") },
    { match: ["gh", "release", "upload"], result: ok() },
    { match: ["gh", "release", "download"], result: ok(), effect: fakeDownloadLatestJson(fakeIo) },
    { match: ["gh", "release", "edit"], result: ok() },
    { match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.2.0" })) },
  ]);

  const result = await release.runPublish(deps);
  assert.ok(result.ok);
  const notes = (JSON.parse(lastWrite(io, "latest.json")) as LatestJson).notes;
  assert.strictEqual(notes, "新增自动检查更新");
  assert.ok(lastWrite(io, "release-body.md").includes(notes));
  assert.ok(lastWrite(io, "release-body.md").includes("仍要运行")); // Release 正文自动附 SmartScreen 指引
});

test("发布阶段失败可恢复：重跑时复用同 tag draft 并 --clobber 覆盖附件", async () => {
  const { kit, deps } = publishDeps((fakeIo) => [
    { match: ["gh", "release", "view"], result: ok(JSON.stringify({ tagName: "v0.2.0", isDraft: true })) },
    { match: ["gh", "release", "edit"], result: ok() }, // 复用时刷新正文（--notes-file）
    { match: ["gh", "release", "upload"], result: ok() },
    { match: ["gh", "releases?per_page"], result: ok("[" + draftReleaseJson(true) + "]") },
    { match: ["gh", "release", "download"], result: ok(), effect: fakeDownloadLatestJson(fakeIo) },
    { match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.2.0" })) },
  ]);

  const result = await release.runPublish(deps);
  assert.ok(result.ok);
  if (result.ok) assert.strictEqual(result.reusedDraft, true);
  assert.strictEqual(kit.callIndex("release", "create"), -1); // 不再创建
  const uploadCall = kit.calls.find((call) => call.args.includes("upload"));
  assert.ok(uploadCall?.args.includes("--clobber"));
  const editCalls = kit.calls.filter((call) => call.args.includes("release") && call.args.includes("edit"));
  assert.ok(editCalls.some((call) => call.args.includes("--notes-file")));
  assert.ok(kit.callIndex("--draft=false") >= 0);
});

test("发布阶段：已正式发布的标签拒绝替换产物（MUST NOT 重传已发布版本）", async () => {
  const { kit, deps } = publishDeps(() => [
    { match: ["gh", "release", "view"], result: ok(JSON.stringify({ tagName: "v0.2.0", isDraft: false })) },
  ]);
  const result = await release.runPublish(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.ok(result.message.includes("正式发布"));
    assert.ok(result.message.includes("不得"));
  }
  assert.strictEqual(kit.callIndex("--draft=false"), -1);
  assert.strictEqual(kit.callIndex("release", "upload"), -1);
});

test("发布阶段失败可恢复：上传失败打印失败阶段与安全重试指引，保留 draft 不转正式", async () => {
  const { kit, deps } = publishDeps(() => [
    { match: ["gh", "release", "view"], result: failed("release not found: v0.2.0\n") },
    { match: ["gh", "release", "create"], result: failed("upload failed: blob\n") },
  ]);
  const result = await release.runPublish(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.ok(result.stage.includes("draft"));
    assert.ok(result.retry.includes("重跑"));
    assert.ok(result.completed.length > 0); // 已完成步骤有记录
  }
  assert.strictEqual(kit.callIndex("--draft=false"), -1);
});

test("发布阶段：私钥密码为空即止，不进入构建", async () => {
  const { kit, deps } = publishDeps(() => [], { askSecret: async () => "" });
  const result = await release.runPublish(deps);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.strictEqual(result.stage, "私钥密码收集");
    assert.strictEqual(kit.callIndex("tauri:build"), -1);
  }
});

test("发布阶段：更新说明为空先拒绝，重新输入后通过（预览确认）", async () => {
  const confirmCalls: string[] = [];
  const { io, deps } = publishDeps(
    (fakeIo) => [
      { match: ["gh", "release", "view"], result: failed("release not found: v0.2.0\n") },
      { match: ["gh", "release", "create"], result: ok("url\n") },
      { match: ["gh", "releases?per_page"], result: ok("[" + draftReleaseJson(true) + "]") },
      { match: ["gh", "release", "upload"], result: ok() },
      { match: ["gh", "release", "download"], result: ok(), effect: fakeDownloadLatestJson(fakeIo) },
      { match: ["gh", "release", "edit"], result: ok() },
      { match: ["gh", "releases/latest"], result: ok(JSON.stringify({ tag_name: "v0.2.0" })) },
    ],
    {
      askText: queueAnswers(["", "修复导出 Word 的段落顺序问题", ""]), // 第 1 轮空说明被拒，第 2 轮 1 条通过
      askConfirm: async (prompt: string) => {
        confirmCalls.push(prompt);
        return true;
      },
    },
  );
  const result = await release.runPublish(deps);
  assert.ok(result.ok);
  assert.strictEqual(confirmCalls.length, 1); // 只有第 2 轮进入预览确认
  const latest = JSON.parse(lastWrite(io, "latest.json")) as LatestJson;
  assert.strictEqual(latest.notes, "修复导出 Word 的段落顺序问题");
});
