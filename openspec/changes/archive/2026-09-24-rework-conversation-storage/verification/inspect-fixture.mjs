// 侦察脚本：列出测试作品的讨论档案摘要 + 内容树（文档 id/标题/可见性）。
// 用法：node inspect-fixture.mjs <projectRoot>
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.argv[2];
const convDir = join(projectRoot, "next-story-system", "conversations");

console.log("=== conversations ===");
if (existsSync(convDir)) {
  for (const f of readdirSync(convDir)) {
    if (!f.endsWith(".json") || f.endsWith(".meta.json")) continue;
    try {
      const d = JSON.parse(readFileSync(join(convDir, f), "utf8"));
      const prov = (d.provenance || [])
        .map((p) => `${String(p.document_id).slice(0, 13)}:${p.material_type}`)
        .join(",");
      const odp = (d.on_demand_reading_provenance || [])
        .map((p) => `${String(p.document_id).slice(0, 13)}:${p.depth}`)
        .join(",");
      console.log(
        `${f.slice(0, 8)} turns=${d.turns.length} rev=${d.version} grant=${d.on_demand_reading_grant ? "yes" : "no"}`,
      );
      console.log(`    title=${d.title || "-"} pinned=${d.pinned || false}`);
      console.log(`    focus=${String(d.focus_document_id || "-").slice(0, 13)} prov=[${prov}]`);
      if (odp) console.log(`    odp=[${odp}]`);
    } catch (e) {
      console.log(`${f.slice(0, 8)} PARSE_ERROR ${e.message}`);
    }
  }
}

const treePath = join(projectRoot, "next-story-system", "content-tree.json");
console.log("=== content tree ===");
if (existsSync(treePath)) {
  const tree = JSON.parse(readFileSync(treePath, "utf8"));
  console.log("top-level keys:", Object.keys(tree).join(","));
  const walk = (node, depth) => {
    if (!node || typeof node !== "object") return;
    const pad = "  ".repeat(depth);
    const id = node.id ? String(node.id).slice(0, 13) : "";
    const label = node.title || node.name || "";
    const vis =
      node.ai_visibility !== undefined
        ? ` visibility=${JSON.stringify(node.ai_visibility)}`
        : node.aiVisible !== undefined
          ? ` aiVisible=${JSON.stringify(node.aiVisible)}`
          : "";
    const del = node.deleted_at || node.deleted ? " [deleted]" : "";
    console.log(`${pad}${node.type || node.kind || "?"} ${id} "${label}"${vis}${del}`);
    for (const child of node.children || []) walk(child, depth + 1);
  };
  const root = tree.root ?? tree;
  walk(root, 0);
  // 若 root 下没有 children 字段但顶层有 nodes 等，追加打印键
  if (!root.children && !tree.root) console.log("(no walkable children; dump keys:", Object.keys(tree).join(","), ")");
} else {
  console.log("(no content-tree.json)");
}
