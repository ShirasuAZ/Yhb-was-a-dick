# LayUDown Game Suite 2.0.0 部署说明

这是 Linux 阿里云 ECS 更新包，不是 Windows 安装程序。包内包含完整网站/UNO 生产文件、将棋在线服务、源码快照、独立 Nginx 配置、自动部署和回滚脚本。将棋只有在线联机模式，没有本地双人模式或悔棋功能。

## 端口与路由

- TCP 80：现有 Nginx 统一入口，直接使用 `http://47.100.174.241/`，不依赖域名。
- TCP 3000：现有 UNO 服务与网站主 SPA，端口保持不变。
- TCP 3001：`layudown-shogi.service`，只监听 `127.0.0.1`，不需要开放公网端口。
- `/`、`/uno`、`/assets/`、`/api/`、`/socket.io/` 继续转发至 UNO 的 3000 服务。
- `/shogi`、`/shogi/`、`/api/shogi/`、`/shogi-socket.io/` 由 Nginx 转发到将棋的 3001 服务。
- `/health` 由 Nginx 转发至将棋健康检查；UNO 的健康检查仍为 `/api/health`。

部署要求 Node.js 20.19 或更新版本、Nginx、systemd、sudo、curl。将棋规则代码打入生产 bundle；Express 和 Socket.IO 使用现有 UNO 项目的 Node 依赖。包内包含 `package.json` 与 `package-lock.json`，可在现有项目依赖缺失时按下文恢复。

## 部署前检查

先登录 ECS，确认当前 UNO 项目目录、账号数据目录、运行用户、3000 端口所属服务及生效 Nginx 配置。命令只读：

```bash
sudo ss -ltnp
sudo nginx -T
sudo systemctl --type=service --state=running
```

请确认目标目录就是现有 UNO 项目目录，且该目录的 `dist/server/index.js`、`dist/client/index.html` 和账号数据目录中的 `accounts.json` 均存在。脚本会在修改前验证该项目能加载 `express` 与 `socket.io`。若依赖缺失，可在该项目目录根据包内锁文件恢复生产依赖，再重新部署：

```bash
cd /absolute/path/to/existing-uno-app
npm ci --omit=dev
```

若账号数据不在项目目录的 `data/` 下，部署时设置准确的 `UNO_DATA_DIR`。先检查 3001 是否空闲；如果已有监听，脚本仅接受由本项目 `layudown-shogi.service` 管理的服务。脚本会检查 3000 的进程目录及 systemd 所属关系，不明确时会停止并报告，不猜测服务名。

## 上传并部署

将 ZIP 上传到服务器后，在服务器上解压并进入包目录。下面用 `/tmp` 作为示例临时目录：

```bash
cd /tmp
unzip LayUDown-Game-Suite-Setup-2.0.0.zip
cd LayUDown-Game-Suite-Setup-2.0.0
chmod +x deploy/deploy-game-suite.sh deploy/rollback-game-suite.sh
```

然后传入现有 UNO 应用的绝对路径。若账号目录仍是应用目录下的 `data/`：

```bash
deploy/deploy-game-suite.sh /absolute/path/to/existing-uno-app
```

请以当前项目运行用户执行，脚本内部会调用 sudo；不要用 root 账号直接运行，以便回滚备份归属正确。

若账号数据在别处：

```bash
UNO_DATA_DIR=/absolute/path/to/existing-uno-data \
deploy/deploy-game-suite.sh /absolute/path/to/existing-uno-app
```

脚本先检查运行环境、现有服务、3000/3001 端口和 Nginx 当前配置，再备份本项目 `dist/`、本项目将棋 systemd 单元及独立 Nginx 站点文件。它只替换该项目的 `dist/`，使用 `sudo tee` 安装 `/etc/systemd/system/layudown-shogi.service` 和独立的 `conf.d/layudown-gamesuite.conf`，运行 `systemd-analyze verify` 与 `nginx -t` 后才 reload Nginx。失败时会尝试自动恢复本次备份。备份位置会在输出中显示，部署完成前请保留整个 ZIP 和备份。

部署脚本会识别并重启实际运行这个项目且拥有 TCP 3000 的那个 systemd 服务，以便让 UNO 读取新的生产静态文件；不会停止其他 Node.js 服务、OpenClaw 或其他站点。若进程不是由 systemd 管理、端口归属不明、IP 已由其他 Nginx server block 声明或 Nginx 未加载 `conf.d`，脚本会中止，需先按服务器现状人工确认配置，再重试。

可用以下变量指定项目运行账号或 Nginx 路径：

```bash
LAYUDOWN_APP_USER=现有项目运行用户 \
LAYUDOWN_NGINX_INCLUDE_DIR=/etc/nginx/conf.d \
deploy/deploy-game-suite.sh /absolute/path/to/existing-uno-app
```

仅在确认当前 Nginx 主配置包含指定目录后，才更改 Nginx 路径变量。不要覆盖 `/etc/nginx/nginx.conf`，也不要删除其他站点文件。

## 部署后验证

```bash
sudo systemctl is-active layudown-shogi.service
sudo systemctl status layudown-shogi.service --no-pager
sudo ss -ltnp 'sport = :3000'
sudo ss -ltnp 'sport = :3001'
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://47.100.174.241/health
curl -I http://47.100.174.241/
curl -I http://47.100.174.241/uno
curl -I http://47.100.174.241/shogi
```

三个 `curl -I` 请求应返回 200，健康检查应返回 JSON 且包含 `"ok":true`。也可检查 `HEAD /uno`、`HEAD /shogi`。然后浏览器访问 `http://47.100.174.241/`：未登录时应先显示登录入口；登录后才显示 LayUDown 大厅及 UNO、日本将棋和关于我。检查主页标题与顶部品牌文字均为 `LayUDown`。分别用两个账号打开 `/shogi`，创建并加入同一房间，验证同步、断线重连、双方棋子朝向和退出房间。UNO 仍从 `/uno` 进入。

客户端 Socket.IO WebSocket 路径为 `/socket.io/`（UNO）和 `/shogi-socket.io/`（将棋）。部署脚本会通过 Nginx 代理验证将棋 WebSocket 能到达需要登录认证的服务；未登录连接应收到认证错误，而不能匿名接入。公网服务器、ECS 实际配置和物理手机必须由部署者在上传后验收；本包生成过程没有连接服务器。

## 回滚

部署脚本会打印备份目录，例如 `/现有项目/.layudown-backups/20261021-120000`。使用输出中的实际路径执行：

```bash
deploy/rollback-game-suite.sh \
  /absolute/path/to/existing-uno-app \
  /absolute/path/to/existing-uno-app/.layudown-backups/YYYYMMDD-HHMMSS
```

回滚只恢复备份中的项目 `dist/`、`layudown-shogi.service`、本项目独立 Nginx 文件和部署时记录的 UNO 服务。旧 `dist/` 会留在 `dist.failed-*`，回滚后确认网站正常再自行清理。脚本不会清理账号数据，也不会操作 OpenClaw 或其他服务。回滚仍需 sudo、systemd 和 Nginx 可用。

## 故障排查

- 脚本提示账号存储缺失：使用 `UNO_DATA_DIR` 指向当前 UNO 服务真实的账号目录，不要创建空账号库替代。
- 脚本提示 TCP 3000 服务不明确：通过 `sudo ss -ltnp 'sport = :3000'`、`/proc/<PID>/cwd` 和 `systemctl status` 确认服务归属，再传入正确项目目录。
- 脚本提示 3001 已占用：检查该端口归属。不要停止未知服务；只有确认它是本项目将棋服务后才可重新部署。
- `nginx -t` 失败：脚本自动回滚并保留备份。查看错误行，确认本项目站点配置及活动 Nginx include 目录；不要覆盖整个 Nginx 主配置。
- 将棋页面正常但 Socket.IO 失败：确认 Nginx 的 `/shogi-socket.io/` 路径带有 Upgrade/Connection 代理头，且 `layudown-shogi.service` 活跃。
- 端口 80 无法访问：检查阿里云安全组 TCP 80 是否已有规则并由服务器管理员确认。本包不修改安全组或操作系统防火墙。

## 包内容

- `dist/`：当前生产构建的完整 LayUDown/UNO 前端、UNO 服务端和自包含将棋服务端。
- `source/UNO/UNO WorkSpace/`：网站、UNO、将棋联机接入、静态资源、锁文件、测试和标题保护检查源码；不含账号数据、密钥、环境文件、依赖缓存和旧发布压缩包。
- `source/Hon shugi/Hon shugi WorkSpace/`：标准将棋规则引擎和规则测试源码。
- `deploy/`：部署脚本、回滚脚本、Nginx 增量配置、变更记录和测试报告。

主页 `header.lobby-header h1` 以及浏览器主页标题在源码和生产构建中均保持 `LayUDown`。`npm run build` 会在生成产物前后运行标题保护检查。
