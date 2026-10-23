import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("client/index.html");
const lobby = read("client/src/components/Lobby.tsx");
const auth = read("client/src/components/AuthScreen.tsx");
const errors = [];

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

const clientSourceFiles = collectSourceFiles(path.join(root, "client/src"));
const sourceFiles = [html, ...clientSourceFiles.map((file) => fs.readFileSync(file, "utf8"))];

if (!/<title>LayUDown<\/title>/.test(html)) errors.push("client/index.html must contain <title>LayUDown</title>");
if (!/<h1>\{gameMode \? "UNO" : "LayUDown"\}<\/h1>/.test(lobby)) errors.push("Lobby must label the UNO route UNO and keep LayUDown on the homepage");
if (!/<h1>LayUDown<\/h1>/.test(auth)) errors.push("Auth h1 must remain LayUDown");
if (sourceFiles.some((source) => /document\s*\.\s*title\s*(?:=|\+=)/.test(source))) errors.push("client source must not assign document.title");

const distIndex = path.join(root, "dist/client/index.html");
if (fs.existsSync(distIndex)) {
  const builtHtml = fs.readFileSync(distIndex, "utf8");
  if (!/<title>LayUDown<\/title>/.test(builtHtml)) errors.push("production index.html title is not LayUDown");
  const assetsDir = path.join(root, "dist/client/assets");
  const builtJs = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js")).map((name) => fs.readFileSync(path.join(assetsDir, name), "utf8")).join("\n")
    : "";
  if (!builtJs.includes("LayUDown") || !builtJs.includes("UNO")) errors.push("production JavaScript must contain both the homepage brand and UNO route label");
  if (/document\s*\.\s*title\s*(?:=|\+=)/.test(builtJs)) errors.push("production JavaScript assigns document.title");
}

if (errors.length) {
  console.error("TITLE_PROTECTION_FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("TITLE_CHECK_OK: LayUDown homepage title is preserved and the UNO route is labeled UNO.");
