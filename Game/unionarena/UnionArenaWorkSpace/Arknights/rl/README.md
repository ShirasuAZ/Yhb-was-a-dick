# 人机对战与强化学习

## 电脑对手（`src/shared/ai/`）

| 文件 | 作用 |
| --- | --- |
| `legal.ts` | 当前所有合法动作（规则书动作；不含手动结算与认输）。是电脑对手和强化学习的动作空间。 |
| `match.ts` | 不依赖服务器的整局对战：可指定种子的随机数、发牌与换牌（`dealMatch` / `decideMulligan` / `createMatch`）、整局复制。 |
| `heuristic.ts` | 简单 / 普通：按常识给每个合法动作打分。简单档有 35% 随机走法。 |
| `search.ts` | 困难：确定化蒙特卡洛搜索。把自己看不到的牌随机补全，每个候选动作用普通策略模拟到终局，选胜率最高的。同一轮里所有候选面对同一份补全和同一串随机数，差别只来自动作本身。 |
| `teacher.ts` | 专家迭代的老师：同一个搜索，但候选动作取网络评分最高的几个，模拟由网络来走、到回合结束为止，再用胜率网络估值；只有别的候选明显更好（超过 `margin`）时才推翻网络的首选。 |
| `features.ts` | 强化学习用的观测向量（978 维）和动作向量（每个动作 92 维），只编码该玩家能看到的信息；另有每个局面 28 个、每个动作 3 个卡号编号（`card-index.ts`），给第 2 版网络查卡牌向量。 |
| `policy.ts` | 大师：在浏览器 / Node 里用纯 TypeScript 运行训练好的网络。第 2 版权重多一张卡牌向量表（每个卡号一个可学习的向量），能分辨数值相同、能力不同的卡。 |
| `decks.ts` | 四副单色预设牌组（罗德岛 蓝、龙门 红、整合运动 黄、切尔诺伯格 紫），只含引擎能全自动结算的卡。 |
| `policy-weights.json` | 训练好的网络权重（由 `rl/train.py` 生成）。 |
| `winrate.ts` / `winrate-weights.json` | 胜率网络：从一名玩家能看到的局面（同一个观测向量）估计他获胜的概率。玩家对战由服务器为每名玩家各算一份，人机对战在浏览器里算；不知道对手手牌和卡组，所以显示给玩家不会泄露信息。界面上是操作栏右端一个没有文字的小圆环，蓝色弧长就是胜率。 |

## 给 agent 用的对局接口

`src/shared/ai/agent.ts` 把一局对战包装成程序和 LLM agent 都能用的接口，`rl/agent.ts` 是它的命令行版。完整对局只保存在一个裁判进程（`rl/referee.ts`）的内存里，裁判只在 127.0.0.1 上监听；其它命令带着座位和密钥向它发请求，拿回的只有这个座位能看到的信息。磁盘上没有任何 agent 能读到的对局文件：连接文件里只有 `{host, port}`，不含对局和密钥。

```bash
# 开一局并启动裁判（一直运行，对局结束后 Ctrl+C 停止）：我方龙门对困难档罗德岛
# 牌组可选 rhodes / lungmen / reunion / chernobog / random，难度 easy / normal / hard / master / agent
npx tsx rl/agent.ts serve --deck lungmen --opponent-deck rhodes --level hard
# 输出里有端口和密钥：对电脑时只有一个座位 agent。查看局面、执行编号为 3 的决定（之后电脑会自动走完它的部分）
npx tsx rl/agent.ts view --as agent --token <密钥>
npx tsx rl/agent.ts act 3 --as agent --token <密钥>
```

- 每次输出 JSON：`seat`、`view`（我方能看到的一切：双方场面、生命、我的手牌和卡面文字、待决事项）、`actions`（当前可做的决定，每条一句中文说明）、`newLog`（上次调用以来的日志，也就是对手做了什么）。加 `--text` 输出可读文本。
- 只显示规则允许这名玩家看到的信息：对手手牌、双方牌库、背面朝下的生命卡都不会出现。密钥由裁判校验，错误的密钥会被拒绝。
- 命令通过连接文件找到裁判（默认在系统临时目录的 `arknights-agent-server.json`，可用 `--server-file` 指定，或直接 `--server 127.0.0.1:端口`）。
- 默认不存盘，裁判退出对局就没了。要断点续玩就用 `serve --save <文件>`：这个文件含完整对局和密钥，只由裁判读写，要放在 agent 不会去碰的地方（例如 agent 工作目录之外、别的系统用户的目录）；再用同样的 `--save` 启动就接着这局。
- 在代码里用：`agentView`、`agentActions`、`applyAgentAction`、`advance`（让电脑走到轮到你为止）、`computerPlayer(level)`；要起一个裁判就用 `rl/referee.ts` 的 `startReferee`。

### 两个 agent 对战

`--level agent` 开一局双人对战：两个座位 `p1`、`p2` 都由外部 agent 控制，裁判给每个座位生成一把密钥。每个 agent 只拿自己的座位和密钥，只能看到自己那一方的信息、只能替自己出手。裁判的输出（里面有两把密钥）不要给 agent 看。

```bash
# 裁判开局，把输出里的 p1、p2 密钥分别交给两个 agent
npx tsx rl/agent.ts serve --level agent --deck lungmen --opponent-deck rhodes
# 每个 agent 循环：等到轮到自己（或对局结束）→ 看局面选一个编号 → 执行
npx tsx rl/agent.ts wait --as p1 --token <p1 的密钥>
npx tsx rl/agent.ts act 2 --as p1 --token <p1 的密钥>
```

给每个 agent 的提示词可以这样写：「你是 p1，密钥是 …。反复执行：运行 `npx tsx rl/agent.ts wait --as p1 --token …`；如果 `view.step` 是 `over` 就报告结果并停止；否则从 `actions` 里选一个编号，用 `act <编号> --as p1 --token …` 执行。只根据输出里的信息做决定。」`wait` 默认最多等 600 秒，可用 `--timeout` 调整。
- `rl/random_deck.ts` 生成随机的合法牌组（一到两色、可全自动结算的卡），训练和 agent 对局都用它。

## 训练

需要 conda 环境 AIEnv（PyTorch、numpy），以及站点目录 `Game/UNO/UNO WorkSpace` 已执行过 `npm ci`（用它的 tsx 运行 Node 进程）。

```bash
conda run -n AIEnv python rl/train.py --minutes 45
```

- `rl/env_worker.ts`：Node 训练环境，每个进程跑一批对局，通过 stdin/stdout 的 JSON 行与 Python 交互。
- `rl/train.py`：PPO。网络对每个合法动作单独打分（状态编码 + 动作编码），所以动作数量可变。
- 对手：先是简单 / 普通各一半；对普通档评估胜率达到 55% 后，加入自己的历史快照（自我对战）。
- 奖励：胜 +1、负 −1，另有生命差的小额塑形奖励（每张 ±0.05）。
- 每 10 次更新评估一次（贪心策略对普通档 200 局），胜率最高的模型（持平时取较新的）复制到 `src/shared/ai/policy-weights.json`。对普通档接近 100% 以后这个评估就分不出强弱了，要用 `rl/evaluate.ts` 让模型之间直接对战来比较。评估在单独的 Node 进程里异步进行，训练不停下来等；上一次评估还没结束时，这一次跳过。
- 默认 16 个环境进程（`--workers`）。PPO 更新默认用 MPS（Apple GPU），没有时用 CPU（`--device auto`）：更新要给每个样本的所有合法动作打分，在 CPU 上是最慢的一环。
- 检查点和日志在 `rl/checkpoints/`、`rl/logs/`（不提交）。

## 专家迭代（第 2 版网络）

强化学习只能从自己的对局结果里慢慢摸索；专家迭代先让更强的“老师”（网络 + 搜索）下棋，网络学着模仿老师，再接着强化学习。

```bash
# 1. 老师自对弈生成数据（在 Game/UNO/UNO WorkSpace 下运行；16 个进程并行，每个 280 局）
for i in $(seq 1 16); do npx tsx ../../unionarena/UnionArenaWorkSpace/Arknights/rl/expert_data.ts $i 280 ../../unionarena/UnionArenaWorkSpace/Arknights/rl/data/expert-$i "c=4,r=8,t=1,m=0.03" 0.5 & done; wait
# 2. 模仿学习：从上一版网络出发（卡牌向量那几列初始为 0，起点和上一版完全一样），学老师的选择，价值头学胜负
conda run -n AIEnv python rl/train_bc.py --init-v1 rl/checkpoints/master-v1.json
# 3. 强化学习微调：只看胜负、对手是历史快照池 + 上一版模型、一半随机牌组，按对上一版的胜率挑最好的模型
conda run -n AIEnv python rl/train.py --net v2 --resume rl/checkpoints/bc.pt --shaping 0 --random-decks 0.5 --lr 1e-4 \
  --mix '{"normal":0.1,"policy":0.9}' --pool 8 --pool-extra rl/checkpoints/master-v1.json rl/checkpoints/bc.json --self-play-at 0 \
  --eval-opponent policy:rl/checkpoints/master-v1.json --eval-games 400 --out checkpoints-v2 --no-ship --minutes 60
# 第二轮：从第一轮的 latest.pt 继续，把第一轮模型也放进对手池（--pool-extra … rl/checkpoints/v2-round1.json --out checkpoints-v2b）
# 4. 用 evaluate.ts 以新种子做大样本对战确认后，把胜出的权重复制到 src/shared/ai/policy-weights.json
```

- `expert_data.ts`：双方都是老师（设置写成 `c=候选数,r=每个候选模拟次数,t=模拟几个回合,m=保留首选的余量`），一半对局用随机牌组。记录每个多选一的决定：网络看到的输入、老师的选择、各候选的估值和最终胜负。网络本来就和老师一致的决定只保留 30%（训练时权重补回），不一致的全保留。
- `train_bc.py`：按对局划分训练 / 验证集，报告“与老师一致的比例”和“在旧网络与老师不一致的决定上学会了多少”，保留验证损失最低的一轮，写出 `bc.pt`（含价值头，供 `train.py --resume`）和 `bc.json`。
- `train.py` 的新选项：`--net v2`（带卡牌向量的网络）、`--init-v1`（从第 1 版权重无损起步）、`--shaping 0`（只奖励胜负，不再奖励生命差，否则网络会为了少掉血而乱挡）、`--pool N`（保留最近 N 个快照做对手）和 `--pool-extra`（固定对手）、`--random-decks`、`--eval-opponent policy:<权重>`（用与指定模型对战的胜率挑最好的模型；对普通档胜率早就接近 100%，分不出强弱）、`--out`、`--no-ship`（不覆盖线上权重）。

其它脚本：

```bash
# 两个电脑玩家对战评估（在 Game/UNO/UNO WorkSpace 下运行）；选手可以是 easy / normal / hard / policy:<权重> / teacher:<设置>，
# 最后一个参数 random 表示每局双方各用一副随机牌组（默认轮流用四副预设牌组）
npx tsx ../../unionarena/UnionArenaWorkSpace/Arknights/rl/evaluate.ts policy:../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/policy-weights.json normal 400 1 random
# 校验 PyTorch 与浏览器端推理一致（--v2：第 2 版网络）
conda run -n AIEnv python rl/check_parity.py
conda run -n AIEnv python rl/check_parity.py rl/checkpoints/bc.pt --v2
conda run -n AIEnv python rl/check_parity_winrate.py
```

## 胜率网络

```bash
conda run -n AIEnv python rl/train_winrate.py --games 60000
```

- `rl/winrate_data.ts` 生成数据：电脑玩家（简单、普通、大师策略随机搭配）对局，75% 用随机牌组（从可全自动结算的卡里随机组一到两色的合法牌组），25% 用预设牌组；从双方视角各记录一部分决策点，标签是这名玩家最后是否获胜。
- `rl/train_winrate.py` 按对局划分训练 / 验证 / 测试集，同一局的局面不会跨集合。取验证集损失最低的一轮，再在验证集上拟合温度做概率校准（并入最后一层），最后在测试集上报告对数损失、Brier 分数、准确率和校准表。
- 权重写到 `src/shared/ai/winrate-weights.json`。策略模型重训以后，最好也重新生成数据、重训胜率网络。

## 当前模型的评估结果

当前模型是第 2 版网络（带卡牌向量），按上面的专家迭代流程训练：老师自对弈 2226 局（12.8 万个决定）做模仿学习，再强化学习微调两轮各 60 分钟（MPS 更新、16 个环境进程、只奖励胜负、历史快照对手池、一半随机牌组）。评估都用训练时没用过的新种子，交替先后手；“预设”是四副预设牌组两两搭配，“随机”是每局双方各一副随机合法牌组：

| 对局 | 牌组 | 局数 | 前者胜率 |
| --- | --- | --- | --- |
| 新模型 对 上一版大师 | 预设 | 1024 | 62.2%（±3.0%） |
| 新模型 对 上一版大师 | 随机 | 512 | 65.4%（±4.1%） |
| 新模型 对 第一轮微调后的模型 | 预设 | 1024 | 53.3%（±3.1%） |
| 新模型 对 普通 | 预设 | 1024 | 98.8%（±0.7%） |
| 新模型 对 普通 | 随机 | 512 | 81.1%（±3.4%） |
| 上一版大师 对 普通 | 随机 | 512 | 64.8%（±4.1%） |
| 新模型 对 简单 | 预设 | 512 | 100% |
| 新模型 对 困难 | 预设 | 256 | 98.8%（±1.3%） |
| 困难 对 普通 | 预设 | 512 | 76.8%（±3.7%） |
| 普通 对 简单 | 预设 | 1024 | 85.4%（±2.2%） |
| 老师（c=4,r=8,t=1,m=0.03）对 上一版大师 | 预设 | 48 | 77% |

PyTorch 与浏览器端 TypeScript 推理的最大误差约 2e-5。

几点观察：

- 上一版大师只在预设牌组上训练过，换成随机牌组后对普通档只有 65%；新模型训练时一半是随机牌组，同样条件下是 81%。
- 老师（网络 + 搜索）比网络本身强很多，但模仿学习只把网络拉到和上一版持平：老师的很多“推翻”只是估值噪声，直接照抄反而变差，所以 `train_bc.py` 只按估值差的大小部分采纳。真正的提升来自之后的强化学习（去掉生命差塑形、历史对手池、随机牌组）。

胜率网络（`winrate-weights.json`）仍是上一版模型和启发式电脑的对局上训练的：在 6 万局（75% 随机牌组）的测试对局上准确率 79.4%，对数损失 0.423，Brier 分数 0.139，校准误差 0.9%。

## 限制

194 个卡号都能由引擎全自动结算（见 `src/shared/abilities/README.md`）。预设牌组和训练只用全自动的卡；观测向量编码卡面数值和关键字，第 2 版网络另有每个卡号一个可学习的向量，但不读能力文本，网络是从对局结果里间接学到每张卡能力的价值。
