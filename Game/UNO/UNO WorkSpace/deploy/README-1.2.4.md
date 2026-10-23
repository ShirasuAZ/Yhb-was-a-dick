# LayUDown 1.2.4 网页更新与部署

登录页标题为 LayUDown；登录后，大厅、游戏入口及浏览器标签使用 UNO。`/about` 是单独的关于我页面，显示个人资料名称 LayUDown，微信和支付宝收款码纵向排列。更新包 `release/layudown-web-1.2.4.tar.gz` 包含 `dist/client/` 和 `dist/server/index.js`，不含账号数据库、密钥或 node_modules。

## 上传更新包

在 Windows PowerShell 上传，替换为现有 SSH 用户：

```powershell
scp "D:\MyGame\UNO\UNO WorkSpace\release\layudown-web-1.2.4.tar.gz" SERVER_USER@47.100.174.241:/tmp/layudown-web-1.2.4.tar.gz
```

也可以在 FinalShell 中上传至 `/tmp/layudown-web-1.2.4.tar.gz`。`/tmp` 是临时暂存位置。

## 确认现有服务和目录

```bash
sudo systemctl list-units --type=service --all | grep -Ei 'uno|node'
sudo systemctl show uno-online.service -p WorkingDirectory -p ExecStart
```

按实际服务配置设置 `APP_DIR` 和 `UNO_SERVICE`。应用目录应包含现有 `dist/` 和 `node_modules/`。

## 备份、更新和检查

重启会中断正在进行的牌局，建议在没有活跃房间时操作。将示例路径和服务名改为服务器实际值：

```bash
APP_DIR=/opt/uno-online
UNO_SERVICE=uno-online.service
ARCHIVE=/tmp/layudown-web-1.2.4.tar.gz
test -f "$APP_DIR/dist/client/index.html"
test -f "$APP_DIR/dist/server/index.js"
test -d "$APP_DIR/node_modules"
test -f "$ARCHIVE"

STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp -a "$APP_DIR/dist" "$APP_DIR/dist.bak-$STAMP"
STAGING=$(mktemp -d /tmp/layudown-1.2.4.XXXXXX)
tar -xzf "$ARCHIVE" -C "$STAGING"
test -f "$STAGING/dist/client/index.html"
test -f "$STAGING/dist/server/index.js"
sudo cp -a "$STAGING/dist/." "$APP_DIR/dist/"
sudo systemctl restart "$UNO_SERVICE"
sudo systemctl is-active "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
echo
curl -fsS http://127.0.0.1:3000/ | grep -E 'title>UNO|index-'
```

在 Edge 打开 `http://47.100.174.241/` 并按 Ctrl+F5 刷新，确认登录页标题为 LayUDown。登录后确认大厅和游戏入口均显示 UNO，浏览器标签标题为 UNO；“关于我”应打开 `/about` 独立页面，两个收款码上下排列。Nginx 不需修改，账号数据目录不要覆盖。

## 回滚

将 `BACKUP` 替换为更新时输出的实际备份目录：

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
