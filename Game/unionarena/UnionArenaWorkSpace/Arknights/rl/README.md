# 人机对战与强化学习

## 电脑对手（`src/shared/ai/`）

| 文件 | 作用 |
| --- | --- |
| `legal.ts` | 当前所有合法动作（规则书动作；不含手动结算与认输）。是电脑对手和强化学习的动作空间。 |
| `match.ts` | 不依赖服务器的整局对战：可指定种子的随机数、发牌与换牌（`dealMatch` / `decideMulligan` / `createMatch`）、整局复制。 |
| `heuristic.ts` | 简单 / 普通：按常识给每个合法动作打分。简单档有 35% 随机走法。 |
| `search.ts` | 困难：确定化蒙特卡洛搜索。把自己看不到的牌随机补全，每个候选动作用普通策略模拟到终局，选胜率最高的。 |
| `features.ts` | 强化学习用的观测向量（978 维）和动作向量（每个动作 92 维），只编码该玩家能看到的信息。 |
| `policy.ts` | 大师：在浏览器 / Node 里用纯 TypeScript 运行训练好的网络。 |
| `decks.ts` | 四副单色预设牌组（罗德岛 蓝、龙门 红、整合运动 黄、切尔诺伯格 紫），只含引擎能全自动结算的卡。 |
| `policy-weights.json` | 训练好的网络权重（由 `rl/train.py` 生成）。 |
| `winrate.ts` / `winrate-weights.json` | 胜率网络：从一名玩家能看到的局面（同一个观测向量）估计他获胜的概率。玩家对战由服务器为每名玩家各算一份，人机对战在浏览器里算；不知道对手手牌和卡组，所以显示给玩家不会泄露信息。界面上是操作栏右端一个没有文字的小圆环，蓝色弧长就是胜率。 |

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

其它脚本：

```bash
# 两个电脑玩家对战评估（在 Game/UNO/UNO WorkSpace 下运行）
npx tsx ../../Arknights/ArknightsWorkSpace/rl/evaluate.ts policy:../../Arknights/ArknightsWorkSpace/src/shared/ai/policy-weights.json normal 400
# 校验 PyTorch 与浏览器端推理一致
conda run -n AIEnv python rl/check_parity.py
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

当前模型在四副单色预设牌组（蓝、红、黄、紫，含 171 张能力卡中的大量卡牌）上，从上一版模型继续训练了 60 分钟（MPS 更新、16 个环境进程，约 2400 万步）。评估都用训练时没用过的新种子，交替先后手和牌组：

| 对局 | 局数 | 前者胜率 |
| --- | --- | --- |
| 大师 对 普通 | 1000 | 99.4%（±0.5%） |
| 大师 对 简单 | 500 | 100% |
| 大师 对 困难 | 240 | 99.6%（±0.8%） |
| 普通 对 简单 | 1000 | 87.3%（±2.1%） |
| 新模型 对 上一版模型 | 1000 | 96.7%（±1.1%） |
| 新模型 对 本次训练第 5 分钟的模型 | 1000 | 70.1%（±2.8%） |

PyTorch 与浏览器端 TypeScript 推理的最大误差约 2e-5。

胜率网络（`winrate-weights.json`）用新模型和启发式电脑在 6 万局对局（75% 随机牌组）上训练，在没参与训练的测试对局上：准确率 79.4%，对数损失 0.423，Brier 分数 0.139，校准误差 0.9%。

## 限制

194 个卡号都能由引擎全自动结算（见 `src/shared/abilities/README.md`）。预设牌组和训练只用全自动的卡；观测向量只编码卡面数值和关键字，不编码能力文本，网络是从对局结果里间接学到能力的价值。
