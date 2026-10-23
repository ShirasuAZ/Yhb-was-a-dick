# LayUDown 1.2.6 网页更新与部署

更新包 `release/layudown-web-1.2.6.tar.gz` 包含构建后的 `dist/`，可直接更新现有 Node.js 网页服务。它不包含账号数据库、环境配置、密钥或 `node_modules`。大厅主标题和浏览器标签标题恢复为 LayUDown；游戏入口及 UNO 牌局名称保持不变。

## 上传更新包

在 Windows PowerShell 上传，替换为现有 SSH 用户：

```powershell
scp "D:\MyGame\GameWorkSapce\UNO WorkSpace\release\layudown-web-1.2.6.tar.gz" SERVER_USER@47.100.174.241:/tmp/layudown-web-1.2.6.tar.gz
```

也可以用 FinalShell 将文件上传到服务器 `/tmp/layudown-web-1.2.6.tar.gz`。

## 备份并更新

重启服务会中断当前牌局，建议在没有进行中牌局时更新。按服务器现状调整应用目录和服务名称：

```bash
APP_DIR=/opt/uno-online
UNO_SERVICE=uno-online.service
ARCHIVE=/tmp/layudown-web-1.2.6.tar.gz
test -f "$APP_DIR/dist/client/index.html"
test -f "$APP_DIR/dist/server/index.js"
test -d "$APP_DIR/node_modules"
test -f "$ARCHIVE"

STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp -a "$APP_DIR/dist" "$APP_DIR/dist.bak-$STAMP"
STAGING=$(mktemp -d /tmp/layudown-1.2.6.XXXXXX)
tar -xzf "$ARCHIVE" -C "$STAGING"
test -f "$STAGING/dist/client/index.html"
test -f "$STAGING/dist/server/index.js"
sudo cp -a "$STAGING/dist/." "$APP_DIR/dist/"
sudo systemctl restart "$UNO_SERVICE"
sudo systemctl is-active "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
echo
curl -fsS http://127.0.0.1:3000/ | grep -E 'title>LayUDown|index-'
```

浏览器强制刷新后，确认浏览器标签和大厅主标题显示 LayUDown；游戏入口仍显示 UNO，版本角标为 `v1.2.6`。账号数据目录不在更新包内，不要覆盖。

## 回滚

将 `BACKUP` 替换为备份步骤生成的实际目录：

```bash
APP_DIR=/opt/uno-online
UNO_SERVICE=uno-online.service
BACKUP=/opt/uno-online/dist.bak-替换为实际时间
test -f "$BACKUP/client/index.html"
test -f "$BACKUP/server/index.js"
sudo mv "$APP_DIR/dist" "$APP_DIR/dist.failed-$(date +%Y%m%d-%H%M%S)"
sudo cp -a "$BACKUP" "$APP_DIR/dist"
sudo systemctl restart "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
```
