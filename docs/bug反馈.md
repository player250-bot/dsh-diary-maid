# Bug 反馈：点「开始聊」没出现存档抽屉，反而落到空白工作区/会话

> 记录时间：2026-10-26 00:38（Asia/Shanghai）
> 涉及版本：v0.6.0（会话存档 P0）
> 状态：已修（挂载注册工作区 + 可观测性），待真机回归

## 现象

主人点今天页的「开始聊」，预期弹出**存档抽屉**；实际没看到抽屉，
而是落在了一个「鲸汐的抽屉」工作区下的空白会话上（会话像是新建的、没有内容）。

## 现场证据

按时间顺序（本地时间 2026-10-26）：

1. **00:27** Host 重载插件，日志出现
   `[dsh-diary-maid] workspace registered · /sdcard/diary-vault`。
2. `~/.dsh/storages/workspace.json`：00:27:01 新增 workspace
   `60088575-…`，`path=/sdcard/diary-vault`，`title=鲸汐的抽屉`，`sessionIds=[]`；
   00:30:10 其 `sessionIds` 变成 `[session-c8e6f144-…]`（也就是"seat"被更新）。
3. `~/.dsh/sessions/--sdcard-diary-vault--/` 下有 4 个会话目录，解压
   `session.v4.jsonl.zstd` 后**只有一行 session 头**（无消息、无标题事件）：

   | 会话 | 创建时间 | 是否在 saves.json |
   | --- | --- | --- |
   | session-eaf69284… | 00:29:35.983 | 是 |
   | session-c8e6f144… | 00:30:10.423 | **否**（工作区 seat） |
   | session-ebb60285… | 00:30:16.125 | 是 |
   | session-8049264a… | 00:37:35.063 | 是 |

4. `/sdcard/diary-vault/.diary/saves.json` 里有 3 条 `source: "created"` 的
   「日记 · 2026-10-25」。**只有 v0.6.0 的 `createSave` 会发 `source: "created"`**，
   说明 00:29:36 之后新的 client bundle 已经在跑。
   vault 的 `.gitignore` 已含 `.diary/saves.json`，vault `git status` 干净。

## 根因

两个独立的坑叠在一起，谁都可能让主人看到"没有抽屉"。

### A. 插件挂载时自己注册 Workspace（已修）

`lib/index.js` 的 `ensureWorkspace` 在 mount 时 `resolveByPath` 找不到就
`create(vaultPath, '鲸汐的抽屉')`。

后果：
- 侧栏凭空多出一个空工作区，看起来像"新建的工作区"；
- 用户在侧栏点开它时，DSH 走
  `uiWorkspace.openWorkspace → openWorkspaceSession → connectBlank(workspaceId)`
  → `sessions.create({ workspaceId })`，**自己造一个空白会话并把主视图切过去**
  （`dsh-client-ui-workspace/lib/client.js:1403-1421`、`:1476-1489`）。
  这就是"空白会话"的来源——它跟「开始聊」无关，但主人会把两件事连在一起。

插件没有、也不应该替主人决定"这里要有一个工作区"。

### B. 页面可能还拿着旧的 client bundle（已加可观测性）

DSH 的 client bundle 是带 `?rev=` 的版本化资源（`dsh-client-modules`）。
插件重载会合成新 rev，但**已经打开的页面不会自动换模块**（除非
`pnpm run dev:web` 正在跑）。旧版 `startChat` 只做 `closePanel()`，
那段时间点「开始聊」= 关面板、停在当前会话，看起来就是"没反应 / 跳到别的会话"。

00:29:36 之后 saves.json 才有 `source: created` 记录，所以 00:27–00:29 是
"旧 bundle 窗口"，00:29 之后是新 bundle；日志里没有分钟级 HTTP 记录，
这一段无法再细分。结论：**两种解释都成立，都需要防住**。

## 修复（本轮，最小改动）

1. `lib/index.js`：`ensureWorkspace` → `lookupWorkspace`，**只 resolve、不再 create**；
   找不到时只 `console.warn` 一次（提示可在侧栏自行添加），不制造任何工作区/会话。
   已存在的「鲸汐的抽屉」保持不动。
2. `lib/client.js`：新增 `VERSION = 'v0.6.0'`、`BUILD = '2026-10-26.1'`，
   在 **设置 → 面板版本** 显示（`v0.6.0 · 2026-10-26.1` + 提示"不是最新就刷新页面"），
   存档抽屉标题旁也带 `v0.6.0` 小标——一眼能看出页面里跑的是哪一版。
3. `lib/client.js`：`openSaves` 外层加 try/catch，失败时在面板上显示
   「打不开存档抽屉：…」而不是静默关面板；`savesSheetBody` 的渲染也包一层
   try/catch（「存档抽屉出错了：…」），单个渲染错误不会带走整个面板。
4. `mountedRef` 在 effect 里重置为 `true`：即便 effect 被重复执行
   （StrictMode / HMR），抽屉也不会被永久钉在"读取存档…"。
5. 空白会话**没有程序化删除**：四个会话都只有 session 头、没有内容，
   属于 DSH 的正常空白记录；删除会话属于用户数据操作，留给主人在侧栏自行
   归档/删除，插件不碰 `~/.dsh/sessions/`。

## 回归步骤

1. 刷新页面（必要时强刷），打开日记面板 → 设置 → 面板版本应为
   `v0.6.0 · 2026-10-26.1`；不是就说明还在旧模块。
2. 点今天页「开始聊」→ 应出现标题带 `v0.6.0` 的存档抽屉，列出今天的存档或
   「今天还没有存档」。
3. 抽屉里点「＋ 新建存档」→ 会话创建 → 面板关闭、停在对话、输入框预填原句。
4. 关掉抽屉（✕）→ 面板还在；底部「继续当前对话」→ 只关面板、不切会话。
5. 重启 Host（不刷新页面）后再次点「开始聊」：版本号若变旧，即为旧 bundle，
   刷新即可——这正是本轮加版本号要暴露的问题。
6. `tail -f ~/dsh-web.log`：重载插件后**不应**再出现
   `workspace registered`；侧栏**不应**新增工作区。
7. `cat /sdcard/diary-vault/.diary/saves.json` + `cd /sdcard/diary-vault && git status`：
   存档表在、日记本 git 干净。

## 本轮没做（有意留白）

- 同一天出现 3 条同名「日记 · 2026-10-25」是 N:N 模型允许的（同日多档），
  但默认标题重名；P1 再处理（例如自动带序号 / 允许改名），不自动删主人的档。
- 不清理那 3 个工作区/会话外的东西；不改房间、人设；不动 vault 位置。
- client HMR：本机没跑 `pnpm run dev:web`，客户端改动仍需刷新页面才生效。
