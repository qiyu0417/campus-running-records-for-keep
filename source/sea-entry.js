// SEA（单文件 exe）入口：静态资源由构建脚本内嵌为字符串，不走磁盘
import { createApp, startServer } from "./app.js";
import indexHtml from "./public/index.html";
import mainJs from "./public/main.js";
import styleCss from "./public/style.css";

const app = createApp();

app.get("/", (_req, res) => res.type("html").send(indexHtml));
app.get("/index.html", (_req, res) => res.type("html").send(indexHtml));
app.get("/main.js", (_req, res) => res.type("text/javascript").send(mainJs));
app.get("/style.css", (_req, res) => res.type("text/css").send(styleCss));

startServer(app, process.env.PORT || 3000);
