# LayUDown Game Suite 2.2.0 更新包

本包只更新生产构建目录 `dist/`，适用于已部署 2.1.0 / 2.1.1 的 LayUDown 服务。公网首页仍为 80 端口，网站、账号服务和明日方舟 UNION ARENA 为 3000 端口，将棋服务为 3001 端口。请保留服务器原有账号数据目录、环境变量、依赖和 Nginx 配置；本包不包含账号数据。

本包不含卡图和 `arknights-workspace/`（卡牌目录与卡图未改动，沿用 2.1.0 已部署的版本）。`package.json` 与 `package-lock.json` 的依赖没有变化，不需要重新安装依赖。

## 更新

将 `LayUDown-Game-Suite-2.2.0.tar.gz` 上传至服务器并解压：

```bash
mkdir -p /tmp/layudown-2.2.0
tar -xzf /tmp/LayUDown-Game-Suite-2.2.0.tar.gz -C /tmp/layudown-2.2.0
```

进入现有 LayUDown 应用目录，备份并替换 `dist/`：

```bash
cd /绝对路径/现有-layudown-应用目录
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a dist ".dist.backup-$STAMP"
cp -a /tmp/layudown-2.2.0/dist ".dist.next-$STAMP"
mv dist ".dist.old-$STAMP"
mv ".dist.next-$STAMP" dist
```

重启当前占用 3000 端口的网站 UNO / 明日方舟服务，如将棋服务同机运行也一并重启，然后验证健康检查：

```bash
sudo systemctl restart 你的现有3000端口服务名
sudo systemctl restart layudown-shogi.service
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/arknights/catalog
curl -fsS http://127.0.0.1:3001/health
```

如果服务启动失败，用 `.dist.old-$STAMP` 恢复先前的 `dist/` 后重启相同服务。部署包不更改账号库、环境配置、Nginx 或依赖。

## 部署后验证

- 大厅更新记录显示 v2.2.0，版本角标为 v2.2.0。
- 浏览器访问 `/arknights-union-arena/`：顶部栏为单行紧凑布局，显示"返回大厅"、房间号与人数（加入房间后）、侧栏入口、头像和名称。
- 牌桌生命区没有外围边框和 1—7 计数格；未开局时生命区为空，不显示空卡槽。
- 开局仍被禁用（规则数据未核实），因此生命区叠放效果在真实对局中暂时看不到。

本包生成过程没有连接线上服务器，公网 IP、Nginx 实际配置和真机 Safari 仍需部署者自行验收。

## 包内容

- `dist/`：更新后的生产前端、UNO 服务端和将棋服务端完整构建产物。
- `deploy/`：本次更新说明与变更记录。
