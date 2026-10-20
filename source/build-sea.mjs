// 打包脚本：把 server 逻辑 + 前端静态资源打包成单个 fit-tool.exe（Node SEA）
// 用法：node build-sea.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { inject } from "postject";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

mkdirSync(dist, { recursive: true });

// 1. esbuild 打包，并把 public 下三个静态文件内嵌为字符串
await build({
  entryPoints: [path.join(__dirname, "sea-entry.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(dist, "sea.cjs"),
  plugins: [
    {
      name: "inline-static",
      setup(b) {
        b.onLoad(
          { filter: /public[\\/](index\.html|main\.js|style\.css)$/ },
          async (args) => ({
            contents: readFileSync(args.path, "utf8"),
            loader: "text"
          })
        );
      }
    }
  ]
});

// 2. 生成 SEA blob
const seaConfigPath = path.join(dist, "sea-config.json");
writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: path.join(dist, "sea.cjs"),
      output: path.join(dist, "sea.blob"),
      disableExperimentalSEAWarning: true
    },
    null,
    2
  )
);
execFileSync(
  process.execPath,
  ["--experimental-sea-config", seaConfigPath],
  { stdio: "inherit" }
);

// 3. 复制当前 node.exe 作为载体
const exePath = path.join(dist, "fit-tool.exe");
copyFileSync(process.execPath, exePath);

// 4. 把 blob 注入 exe
const blob = readFileSync(path.join(dist, "sea.blob"));
await inject(exePath, "NODE_SEA_BLOB", blob, { sentinelFuse: SENTINEL_FUSE });

console.log(`\n打包完成：${exePath}`);
