# LayUDown Game Suite 2.3.0 更新包

本包只更新生产构建目录 `dist/`，适用于已部署 2.2.0 的 LayUDown 服务。公网首页仍为 80 端口，网站、账号服务和明日方舟 UNION ARENA 为 3000 端口，将棋服务为 3001 端口。请保留服务器原有账号数据目录、环境变量、依赖和 Nginx 配置；本包不包含 `.env`、账号数据和头像上传目录。

本包不含卡图和 `arknights-workspace/`（卡牌目录与卡图未改动，沿用已部署的版本）。`package.json` 与 `package-lock.json` 的依赖没有变化，不需要重新安装依赖。

**本次改动了服务端和联机协议（`ua:state` 新增字段、新增 `ua:mulligan` 事件），必须重启 3000 端口的服务，只替换 `dist/` 不重启不会生效。** 重启会断开正在进行的房间；建议在没有对局时更新。更新期间已打开的旧页面需要刷新。

## 更新

将 `LayUDown-Game-Suite-2.3.0.tar.gz` 上传至服务器并解压：

```bash
mkdir -p /tmp/layudown-2.3.0
tar -xzf /tmp/LayUDown-Game-Suite-2.3.0.tar.gz -C /tmp/layudown-2.3.0
```

进入现有 LayUDown 应用目录，备份并替换 `dist/`：

```bash
cd /绝对路径/现有-layudown-应用目录
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a dist ".dist.backup-$STAMP"
cp -a /tmp/layudown-2.3.0/dist ".dist.next-$STAMP"
mv dist ".dist.old-$STAMP"
mv ".dist.next-$STAMP" dist
```

重启占用 3000 端口的网站 UNO / 明日方舟服务（必须），将棋服务没有改动，无需重启，然后验证：

```bash
sudo systemctl restart 你的现有3000端口服务名
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/arknights/catalog | head -c 300
```

## 回滚

用更新时保留的 `.dist.old-$STAMP`（或 `.dist.backup-$STAMP`）恢复 `dist/`，然后重启相同的 3000 端口服务：

```bash
cd /绝对路径/现有-layudown-应用目录
mv dist ".dist.failed-$STAMP"
cp -a ".dist.backup-$STAMP" dist
sudo systemctl restart 你的现有3000端口服务名
```

回滚后 `/api/arknights/catalog` 会重新带有 `rulesReady`、`rulesMessage` 字段，明日方舟回到 2.2.0 的不可开局状态；账号库、环境配置、Nginx 和依赖在更新与回滚中都没有变化。

## 部署后验证

- 大厅更新记录显示 v2.3.0，版本角标为 v2.3.0。
- `/api/arknights/catalog` 的返回里没有 `rulesReady` / `rulesMessage`，`cards` 为 254 条。
- 用两个账号访问 `/arknights-union-arena/`：一人创建房间，另一人用房间号加入；双方在侧栏"我的牌组"点"快速组牌"→"提交牌组"→"准备"；房主点"开始游戏"。
- 开局后双方各 7 张手牌，先手玩家先在侧栏决定"保留起手牌 / 重抽 7 张"，随后另一人决定；双方都决定后，各自生命区出现 7 张叠放的盖着的牌（对手方向镜像），顶栏显示"第 1 回合"和当前回合方。
- 点击侧栏卡牌预览图可放大查看，Esc / 右上角 X / 点击遮罩可关闭；牌桌中间有一条淡灰色细线。
- 页面没有横向滚动条（桌面、手机竖屏、手机横屏）。

本包生成过程没有连接线上服务器，公网 IP、Nginx 实际配置和真机 Safari 仍需部署者自行验收。

## 包内容

- `dist/`：更新后的生产前端、UNO 服务端和将棋服务端完整构建产物。
- `deploy/`：本次更新说明与变更记录。
