# Changelog

## 0.6.3 — 2026-10-26

### Added

- 房间归档/恢复：`.diary/rooms.json` 本地表 + `PUT/DELETE /api/rooms`；归档只把房间从列表收起，
  不删对话、不删房间日志、不 commit、不碰日记；坏表只读不覆盖；「显示归档」可恢复。
- `PUT /api/sessions` 返回真实结果：成功 `renamed:true`，失败 200 + `renamed:false` + error，
  不再假成功；`room_log` 内部顺带改名仍吞错。
- **人设 v4**：新增「四种腔一次都不许出现」（格言/总结/记录/玄乎）、「灵动三做法」（抓词/落地/有来有回）、
  口头禅与动作库、以及来自真实对话的反例黑名单 + 改写。
- 房间不再喊「记下了」：今日卡片提示词区分书房/房间，房间 skill 明确不调用 `diary_capture`、不宣告记录。

### Changed

- 人设约 10KB；vault `人设/鲸汐.md` 与 `persona/鲸汐.md` 同步为 v4（热更新约 1.5s，不用重载）。
- 测试 62 条（房间归档/坏表/sessions 真实 renamed/前端守卫）。
- 面板版本 `v0.6.3 · 2026-10-26.5`；`npm run check` 纳入 `lib/rooms.js`。

## 0.6.2 — 2026-10-26

### Added

- 房间不写日记做成**硬边界**：房间会话调 `diary_write(kind='diary')` 直接报错、不落盘；
  `maid`/`profile` 仍可用，书房行为不变。判定读会话自己的持久事件日志
  （`tool/call` 里的 `room-chat`/`diary-ritual`、`room_log` 调用、`session/title` 的「房间 · …」），
  不靠提示词；判不出来按书房放行并 warn 一次（宁可少拦）。
- `profile_append` 工具：侧写只增追加，旧正文逐字节保留、幂等去重、覆盖前快照 + git commit。
- 房间列表手动改名（`PUT /api/sessions`），改名后核对 `displayTitle`，没存上会明说，不假成功。
- 360–430px 窄屏规则：六个视图与存档抽屉/管理页/确认层不横向溢出。

### Changed

- 面板版本 `v0.6.2 · 2026-10-26.4`；`diary_write` 描述里明确「房间写日记会被拒绝」「侧写优先用 profile_append」。
- 测试 55 条（新增边界判定、profile_append、房间改名与窄屏守卫）。

## 0.6.1 — 2026-10-26

### Added

- 自动收档（P2）：`diary_write(kind=diary, mode=final)` 与 `PUT /api/entry` 写回 final 后，
  把当天所有 active 存档标 `sealed`（同日多档全收）；幂等，失败只 warn，不回滚日记，不新增 frontmatter。
- 存档逐档管理：抽屉每行「⋯」可改名 / 标签（≤5）/ 备注，收档 ↔ 恢复进行中、归档 ↔ 恢复；
  硬删除在抽屉内二次确认，文案明确「只删存档条目，不删对话、不删日记」；busy 防连点。
- 未绑定会话列表可手动刷新（快照说明 + 冷会话不显示百分比）。

### Changed

- 存档表操作成功后同步刷新抽屉列表；失败留在管理页显示错误，不清空输入。

## 0.6.0 — 2026-10-26

### Added

- 会话存档：点「开始聊」先开存档抽屉，可继续今天的档、切换已有档、新建存档、读取未绑定会话。
- `.diary/saves.json`：一段对话 + 一组日记日期；`dates[]` 为真相，`bindings` 派生；
  gitignore，不进日记历史；日记 frontmatter 不加 sessionId。
- `/api/saves` GET/POST/PUT/DELETE；新建走客户端 `sessions.create`，避免 `unknown session`。
- 日记本迁到独立工作区 `/sdcard/diary-vault`，启动时自动注册「鲸汐的抽屉」。

### Changed

- 「开始聊」不再直接预填当前会话；所有 `await` 在 `openSession` 之前，之后只同步预填。
- 「回到对话」保持只关面板；读取旧档不预填。

### Fixed

- 房间页缺失的 7 个文案键（房间列表 / 开新房间 / 进入 / 空态等）。
- 「开始聊」落到空白工作区/会话：挂载不再创建 workspace，只 lookup；面板显示版本号，
  抽屉打开失败不再静默卸载。

## 0.5.1 — 2026-10-25

### Changed

- 人设 v3：从 5 条例句扩到 16 条，补场景反应表、偏好、禁用句式、退场规则；
  结构参考 dafeiyu-persona / SillyTavern 角色卡，正文仍为原创。
- 新增 [人设设计](docs/人设设计.md)，记录原则、结构、成本与测试方法。

## 0.5.0 — 2026-10-24

### Added

- 书房 / 房间两个空间：房间随便聊，写房间日志；书房负责记录。
- 房间日志：`鲸汐/房间/YYYY-MM-DD-HHMMSS.md`，带副标题、摘要、标签。
- 房间目录：`鲸汐/房间/目录.md` 自动生成；今日卡片带最近三条。
- 工具：`room_log`、`room_read`、`memory_search`。
- 多会话房间：房间列表、开新房间、上下文百分比、按日志副标题自动重命名。
- 上下文提示：70% 起今日卡片提示换房间；72% 起列表标「快满了」。

### Changed

- 「访谈」全部改成「房间日志」；`diary-interview` → `room-chat`。
- 面板「今天」改成聊天优先：开始聊 / 晚安 / 手动补一句。
- 房间日志不再使用问答格式。

### Removed

- `interview` 工具类型、`/api/interviews`、`diary-interview` skill。

## 0.4.0 — 2026-10-24

### Added

- 搜索（日记 / 鲸汐日记 / 房间日志 / 侧写）。
- 日历月视图、全书模式、导出整本 Markdown。
- 心事只读列表。

## 0.3.0 — 2026-10-24

### Added

- 房间 tab、访谈日志、访谈 skill。
- 已知：访谈格式在 0.5.0 被房间日志取代。

## 0.2.0 — 2026-10-24

### Added

- 鲸汐人设注入（独立段名，可开关）。
- 今日卡片（日期、状态、最近、侧写、她上次的话）。
- 工具：`diary_capture`、`diary_read`、`diary_write`。
- 晚安仪式 skill。

### Fixed

- 人设开关重启后会先亮一下：改为启动时同步读设置。

## 0.1.0 — 2026-10-23

### Added

- 面板五个 tab（今天 / 书页 / 侧写 / 鲸汐 / 房间）。
- 独立 git 日记本、按天回退、快照。
- 设置：头像、人设正文。

### Fixed

- 头像被手机返回键遮挡。
- 宿主与客户端版本不同步导致的 404。
