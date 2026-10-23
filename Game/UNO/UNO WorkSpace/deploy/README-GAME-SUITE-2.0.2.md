# LayUDown Game Suite 2.0.2 更新包

本包只更新生产构建目录 `dist/`，适用于现有 LayUDown 服务。公网首页仍为 80 端口，网站和 UNO 服务为 3000 端口，将棋服务为 3001 端口。请保留服务器原有账号数据目录、环境变量、依赖和 Nginx 配置；本包不包含账号数据。

本次更新包括：

- `/` 主页继续显示 **LayUDown**；进入 `/uno` 后，页面顶部显示 **UNO**。只调整标题文字，不修改 UNO 玩法、规则、牌桌布局或牌面。
- 将棋两位玩家都会看到自己的棋子位于棋盘下半方，自己的棋正向、对手棋反向；双方持驹中的棋子均正向。
- 手机横屏时将棋棋盘位于中间，先手和后手持驹分别放在棋盘两侧，持驹棋子纵向排列以适应屏幕高度。

## 更新

将 `LayUDown-Game-Suite-2.0.2.tar.gz` 上传至服务器并解压：

```bash
mkdir -p /tmp/layudown-2.0.2
tar -xzf /tmp/LayUDown-Game-Suite-2.0.2.tar.gz -C /tmp/layudown-2.0.2
```

进入现有 LayUDown 应用目录，备份并替换 `dist/`：

```bash
cd /绝对路径/现有-layudown-应用目录
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a dist ".dist.backup-$STAMP"
cp -a /tmp/layudown-2.0.2/dist ".dist.next-$STAMP"
mv dist ".dist.old-$STAMP"
mv ".dist.next-$STAMP" dist
```

重启当前占用 3000 端口的网站/UNO 服务和将棋服务：

```bash
sudo systemctl restart 你的现有3000端口服务名
sudo systemctl restart layudown-shogi.service
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3001/health
```

如果服务启动失败，用 `.dist.old-$STAMP` 恢复先前 `dist/` 后重启相同服务。部署包不更改账号库、环境配置、Nginx 或依赖。

公网入口：`http://47.100.174.241/`。账号数据仍保存在服务器原有 `UNO_DATA_DIR` 及其 `accounts.json` 中；升级时请勿删除或替换该目录。
