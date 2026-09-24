// 内容树侦察：nodes 映射 (id -> 节点)，root_children 为根顺序。
// 用法：node inspect-tree.mjs <content-tree.json 路径>
import { readFileSync } from "node:fs";

const tree = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nodes = tree.nodes || {};
console.log("node count:", Object.keys(nodes).length);
for (const [id, n] of Object.entries(nodes)) {
  const vis =
    n.ai_visibility !== undefined
      ? JSON.stringify(n.ai_visibility)
      : n.ai_visible !== undefined
        ? JSON.stringify(n.ai_visible)
        : "-";
  const del = n.deleted || n.deleted_at ? " [deleted]" : "";
  console.log(
    id.slice(0, 13),
    JSON.stringify(n.type || n.kind || "?"),
    JSON.stringify(n.title || n.name || ""),
    "vis=" + vis,
    "children=" + (n.children || []).length + del,
  );
}
console.log("root_children:", (tree.root_children || []).length, JSON.stringify(tree.root_children || []));
console.log("recycle_bin:", JSON.stringify(tree.recycle_bin || []).slice(0, 300));
