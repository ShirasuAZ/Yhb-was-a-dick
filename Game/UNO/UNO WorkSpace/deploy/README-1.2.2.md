# LayUDown 1.2.2 网页更新与部署

本次仅更换网页品牌名称。登录页、大厅主标题和游戏入口显示 LayUDown，浏览器标签保持 LayUDown，版本角标更新为 v1.2.2。副标题“在线联机卡牌游戏”和 UNO 玩法、牌面、宣告 UNO、账号与房间功能保留。

更新包：`layudown-web-1.2.2.tar.gz`，包含 `dist/client/` 和 `dist/server/index.js`。不包含账号数据库、密码配置、node_modules、Windows 安装包和 APK。适用于当前 Node.js 网页服务的原目录更新；无需在服务器安装前端构建工具。

## 1. 上传

用 FinalShell 连接 `47.100.174.241`，将更新包上传到 `/tmp/layudown-web-1.2.2.tar.gz`。也可在 Windows PowerShell 执行，替换 `SERVER_USER` 为现有 SSH 用户：

```powershell
scp "D:\MyGame\UNO\UNO WorkSpace\release\layudown-web-1.2.2.tar.gz" SERVER_USER@47.100.174.241:/tmp/layudown-web-1.2.2.tar.gz
```

只有浏览器云控制台时，先用控制台的文件上传功能传入同名压缩包，再打开 Linux 终端执行后续步骤。

## 2. 确认正在运行的服务和目录

在服务器终端查看：

```bash
sudo systemctl list-units --type=service --all | grep -Ei 'uno|node'
```

找到现有服务后，查看它的启动配置。例如服务名是 `uno-game.service`：

```bash
sudo systemctl show uno-game.service -p WorkingDirectory -p ExecStart
```

下面示例沿用项目既有部署脚本中的 `/opt/uno-game` 和 `uno-game.service`。必须按上一条命令的实际结果修改 `APP_DIR` 和 `UNO_SERVICE`。`APP_DIR` 应包含现有 `dist/client/index.html`、`dist/server/index.js` 和 node_modules。

如果服务使用 Docker 或 PM2，使用对应的容器卷目录或 PM2 进程目录更新，并用原有方式重启；不要另起一个 systemd 服务。本文件后续命令针对已有 systemd 服务。

## 3. 备份并更新

重启会中断当前房间，请在没有进行中的牌局时更新。以下整段可粘贴进 FinalShell 或浏览器控制台的 Linux 终端。任一步失败即停止，避免在路径不正确时继续复制。

```bash
bash <<'BASH'
set -euo pipefail
APP_DIR=/opt/uno-game
UNO_SERVICE=uno-game.service
ARCHIVE=/tmp/layudown-web-1.2.2.tar.gz
test -f "$APP_DIR/dist/client/index.html"
test -f "$APP_DIR/dist/server/index.js"
test -f "$ARCHIVE"
sudo systemctl is-active --quiet "$UNO_SERVICE"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$APP_DIR/dist.bak-$STAMP"
sudo cp -a "$APP_DIR/dist" "$BACKUP"
echo "备份目录：$BACKUP"
STAGING=$(mktemp -d /tmp/layudown-1.2.2.XXXXXX)
tar -xzf "$ARCHIVE" -C "$STAGING"
test -f "$STAGING/dist/client/index.html"
test -f "$STAGING/dist/server/index.js"
sudo cp -a "$STAGING/dist/." "$APP_DIR/dist/"
sudo systemctl restart "$UNO_SERVICE"
sudo systemctl is-active --quiet "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
echo
curl -fsS http://127.0.0.1:3000/ | grep -E 'LayUDown|index-'
echo "更新完成。请记录备份目录以便回滚：$BACKUP"
BASH
```

保留原来的账号 `data/`、环境变量、服务名和 Nginx 配置。本次不需要 `npm install`，也不需要修改或重载 Nginx。旧的带哈希静态资源暂时保留，可供尚未刷新的页面使用。

## 4. Edge 验收

访问 `http://47.100.174.241/`，按 Ctrl+F5 强制刷新，确认登录页为 LayUDown，右上角为 v1.2.2。用原账号登录，确认大厅和游戏入口也显示 LayUDown；用两个浏览器窗口加入同一房间，确认准备、开局和出牌正常。

如仍显示旧名称，先尝试隐私窗口。若隐私窗口也未更新，检查 Nginx 是否配置了其他静态文件目录、代理缓存或 CDN；应更新它实际提供的目录或清除相应缓存，而不是重复启动服务。

## 5. 回滚

将下面的 `BACKUP` 改为更新步骤实际输出的备份目录。APP_DIR 和服务名同样使用实际值。账号目录不在回滚范围内。

```bash
bash <<'BASH'
set -euo pipefail
APP_DIR=/opt/uno-game
UNO_SERVICE=uno-game.service
BACKUP=/opt/uno-game/dist.bak-替换为实际时间
test -f "$BACKUP/client/index.html"
test -f "$BACKUP/server/index.js"
sudo mv "$APP_DIR/dist" "$APP_DIR/dist.failed-$(date +%Y%m%d-%H%M%S)"
sudo cp -a "$BACKUP" "$APP_DIR/dist"
sudo systemctl restart "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
BASH
```

更新失败时可运行 `sudo journalctl -u uno-game.service -n 80 --no-pager` 查看日志，服务名应按实际值替换。
