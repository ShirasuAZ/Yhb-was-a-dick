# Hon shugi WorkSpace

这是 LayUDown 网站的本将棋规则引擎工作区。`src/engine.ts` 是规则核心：9×9 棋盘、四十枚初始棋子、吃子、升变、强制升变、持驹打入、二步、打入禁将、将军/将死和千日手状态均由它验证。网站只提供服务端验证的在线联机模式，不提供本地双人模式或悔棋。

工作区内的棋子素材来自 [Zahajki/shogi-piece-images](https://github.com/Zahajki/shogi-piece-images)，仓库 README 标注为 CC0 1.0。正式网站构建会把下载后的透明 PNG 复制到 UNO 前端的 `client/public/assets/shogi/`，生产环境不依赖 Windows 路径或外部热链。

运行 `npm run typecheck` 检查引擎类型；接入网站后由网站根项目的 `npm run build` 统一构建前端和 3000 端口服务。
