# 鲸汐 · DSH 日记女仆（dsh-diary-maid）

> 主人讲，鲸汐记。日记是主人的，侧写是鲸汐的观察，抽屉里还有她自己的心事。

蓝色鲸鱼女仆住在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里，替主人保管日记：
一天一页 Markdown，一个独立 git 仓库，随时能翻回去；她还会写自己的日记和心事。

> 本项目是独立社区作品，不是 DeepSeek 官方功能。

## 现在是什么状态

**v0.2 · 她活过来了**。面板、日记本、git 回退、人设注入、今日卡片、三个写日记的工具和晚安仪式都已接上；房间在 v0.3。

- [x] 日记本自动初始化（目录、模板、`git init`）
- [x] Web 面板：侧边栏入口 + 全页面板
- [x] 今天 / 书页 / 侧写 / 鲸汐 四个视图
- [x] 快速记录、编辑保存、按天看历史、一键回退
- [x] 头像 / 人设设置（头像从 `人设/` 里选；人设暂存，v0.2 注入）
- [x] 人设注入（设置里可开关）、今日卡片
- [x] `diary_capture` / `diary_read` / `diary_write` 三个 agent 工具
- [x] 晚安仪式 skill（草稿 → 确认 → 定稿 → 侧写 → 鲸汐日记）
- [ ] 鲸汐的房间（v0.3）

## 安装

### 从 GitHub 安装

```bash
dsh plugin --profile web add github:<你的用户名>/dsh-diary-maid
```

### 本地开发

```bash
# 在 DSH 里
plugin_manager install_bundle <本目录绝对路径>
```

安装后在侧边栏点「鲸汐」图标；如果没看到，刷新一次页面。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `vaultPath` | `~/dsh-diary` | 日记本根目录；不存在会自动创建并 `git init` |
| `workspace` | `vaultPath` 的上级 | 日记 workspace；只有在这个目录下的会话才会看到「晚安仪式」skill |
| `git` | `true` | 每次保存自动提交；关掉则只用文件快照 |
| `dayCutoffHour` | `4` | 凌晨 4 点前算"前一天" |

配置写在 profile 的 `cordis.patch.yml` 里，或直接改安装后的 bundle 配置：

```yaml
- id: dsh-diary-maid
  name: dsh-diary-maid
  config:
    vaultPath: /sdcard/dsh日记/vault
    git: true
    dayCutoffHour: 4
```

## 日记本长什么样

```
vault/
├─ 2026/
│  ├─ 2026-10-23.md          # 今日日记（YAML frontmatter + 正文）
│  └─ 2026-10-23.inbox.md    # 当天随手记的碎片
├─ 鲸汐/
│  ├─ 2026-10-23.md          # 她的日记
│  └─ 心事/                   # 她的长期私房笔记
├─ 侧写/主人.md               # 持续更新的观察笔记
├─ 人设/                      # 立绘、表情包
├─ 序.md                      # 开卷的话
├─ 模板/
├─ .diary/index.json          # 派生索引，可随时重建
└─ .git/                      # 独立仓库
```

*一天一个文件*：agent 只读需要的那几天，上下文成本低；git diff 天然按天；单文件坏了不影响整本。

面板把文件渲染成**连续的书页**，不暴露文件树。

## 回退

每次保存自动 commit（消息形如 `日记 2026-10-23`）。

- 每天右上角「历史版本」→ 选一版 →「恢复这一版」；
- 回退本身也会 commit 一条「回退到 …」，**永远不 `reset --hard`**，所以手滑也能再回退；
- 没有 git 时，`.diary/history/` 保留最近 7 天文件快照。

## 隐私

- 不读会话历史、不联网；
- 日记与 git 历史都在你自己的机器上；
- 推远程仓库前请确认它是**私有仓库**——git 历史里同样是日记原文。

## 开发

```bash
node --check lib/index.js
node --check lib/client.js
```

结构：

| 文件 | 说明 |
| --- | --- |
| `lib/index.js` | Host：配置、HTTP API、静态资源 |
| `lib/vault.js` | 日记本读写、frontmatter、索引 |
| `lib/git.js` | commit / log / show（串行队列，不回滚历史） |
| `lib/client.js` | Web 面板（`__ModuleLoader__`，React via require） |
| `persona/鲸汐.md` | 人设正文 |
| `docs/设计方案.md` | 完整设计 |

## 路线图

- **v0.1** 面板 + 日记本 + git 回退（当前）
- **v0.2** 人设注入 + agent 工具 + 晚安仪式
- **v0.3** 日历热力图、搜索、全书模式、导出
- **v0.4** 心事编辑、提醒、备份

## 许可

MIT。日记内容归作者本人，不随代码发布。
