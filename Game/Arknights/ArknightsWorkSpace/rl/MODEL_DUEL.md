# API 模型对战

两个支持 Chat Completions 的接口可以直接对战。模型不用终端或工具，只根据本席位局面和合法动作列表返回 `{"index":整数,"reason":"简短理由"}`。

从 `Game/UNO/UNO WorkSpace/` 运行：

```sh
npx tsx ../../Arknights/ArknightsWorkSpace/rl/model-duel.ts /absolute/path/credentials.json 0 /absolute/path/runtime-directory
```

配置文件（放在仓库外，权限设为 `0600`）：

```json
{
  "p1": { "baseUrl": "https://provider-a.example/v1", "apiKey": "LOCAL_KEY_A", "model": "model-a", "label": "模型 A" },
  "p2": { "baseUrl": "https://provider-b.example/v1", "apiKey": "LOCAL_KEY_B", "model": "model-b", "label": "模型 B" }
}
```

第三个参数为观战端口，`0` 表示自动分配。程序打印观战 URL，并在已存在的运行目录中写入 `connection.json`（URL、PID）和 `moves.jsonl`（动作、简短理由、耗时、实际返回的模型名）。每局使用新的运行目录，避免混合不同对局的记录。

默认龙门对切尔诺伯格，随机先手。网页复用原来的牌桌、卡图和放大预览，自动刷新局面。观众能看到双方手牌，模型只能看到各自手牌和公开信息；未翻开的生命卡及牌库顺序不出现在观战快照中。观战 HTTP 仅绑定 `127.0.0.1` 且只支持 GET。

非法模型输出最多重试三次；认证失败立即停止；其他网络错误有限重试。失败时保留牌桌并显示错误，不让其他 AI 接管。对局结束后页面保留，Ctrl+C 可停止服务。该入口独立于现有玩家对战功能。

输出预算默认 8192 tokens。若接口返回 `finish_reason: length`，说明最终输出或思考被截断，按 16384、32768 逐次增加预算重试；不把空的 assistant 消息追加到上下文，也不把截断误报为 JSON 错误。

显式恢复已有私密检查点时，在命令末尾加 `--resume`。运行目录必须已有 `referee-recovery.json`（完整裁判状态）和 `controller-recovery.json`（行动记录与各席位历史）；它们必须保存在仓库外、仅本地用户可读的目录。恢复后保留原牌库顺序、手牌、回合和行动记录，继续更新这两个检查点。普通启动不生成这些完整状态文件。
