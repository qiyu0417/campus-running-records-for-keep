# Fit Tool v1.4

本目录包含 Fit Tool v1.4 的源码和 Windows 单文件运行版。原项目由 Ruomu Yunxi 开发；原说明位于 [source/readme.md](source/readme.md)，其中声明采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 协议。

## 目录

- `release/fit-tool.exe`：Windows x64 单文件版，双击后在浏览器中打开本地页面。无需安装 Node.js。
- `source/`：Node.js 源码、前端文件、依赖锁文件和构建脚本。`node_modules`、Node.js 安装包及中间构建文件未纳入仓库。

## 从源码运行

安装 Node.js 20+ 后，在 `source/` 目录执行：

```powershell
npm ci
npm start
```

浏览器打开 `http://localhost:3000`。在 Windows 上也可以运行 `source/run-fit-tool.cmd`。

## 重新构建 Windows 运行版

在 Windows 的 `source/` 目录执行：

```powershell
npm ci
npm run build:sea
```

输出为 `source/dist/fit-tool.exe`。发布时将该文件复制到 `release/`。

默认地图为 Google 标准地图；地图与 Leaflet 资源需要联网。单文件版未签名，Windows 首次运行可能显示安全提示。

整理时移除了原版内置的地图 Key 和天地图图源，将默认地图设为 Google 标准地图，修正了页面版本号，并更新依赖锁文件。`release/fit-tool.exe` 由整理后的源码重新构建。

`release/fit-tool.exe` 约 95 MB，仓库用 Git LFS 跟踪它。首次提交或克隆前请安装 Git LFS 并运行 `git lfs install`。
