import { countWords, isValidDate } from './vault.js';

const KINDS = ['diary', 'maid', 'profile'];

function text(value) {
  return [{ type: 'text', text: value }];
}

/**
 * 鲸汐's writing tools.
 *
 * Two spaces, two sets:
 *  - 书房: diary_capture / diary_read / diary_write (diary, her diary, profile);
 *  - 房间: room_log / room_read, plus memory_search for recall.
 *
 * The room tools never write the diary page: `diary_write` has no room kind,
 * and the room skill forbids calling it. Every write goes through the vault,
 * which snapshots and commits.
 */
export function registerDiaryTools(ctx, { vault, refreshCard, renameSession = async () => {} }) {
  const disposers = [];
  const add = (definition) => {
    disposers.push(ctx.effect(() => ctx.tools.register(definition), `dsh-diary-maid: ${definition.name}`));
  };

  add({
    name: 'diary_capture',
    description: '把主人刚说的一句话先记进今天的碎片（inbox），不整理、不改正文。主人随口讲今天发生的事时用它；正式写日记用 diary_write。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: '主人说的那句话，尽量保留原词。' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天（凌晨 4 点前算前一天）。' },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          line: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['date', 'line', 'path'],
      },
      render: (_args, value) => text(`记下了（${value.date}）：${value.line}`),
    },
    async execute(args) {
      const date = args.date ?? vault.today();
      if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD');
      const body = String(args.text ?? '').trim();
      if (body === '') throw new Error('要记的内容不能为空');
      if (body.length > 5000) throw new Error('一条碎片最多 5000 字');
      const saved = await vault.appendInbox(date, body);
      void refreshCard();
      return { date, line: saved.line, path: saved.path };
    },
  });

  add({
    name: 'diary_read',
    description: '读书房里的真实文字：主人的日记（diary）、鲸汐自己的日记（maid），或主人侧写（profile）。写之前先读；房间日志用 room_read。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: KINDS, description: 'diary=主人的日记，maid=鲸汐日记，profile=主人侧写。' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天；profile 忽略日期。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          date: { type: 'string' },
          exists: { type: 'boolean' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['kind', 'date', 'exists', 'title', 'body'],
      },
      render: (_args, value) => text(value.exists
        ? `${value.date}（${value.kind}）${value.title === '' ? '' : ` · ${value.title}`}\n\n${value.body}`
        : `${value.date} 的${value.kind}还没有写。`),
    },
    async execute(args) {
      const kind = KINDS.includes(args.kind) ? args.kind : 'diary';
      if (kind === 'profile') {
        const entry = await vault.read('profile');
        return { kind, date: '', exists: entry.exists, title: '', body: entry.body };
      }
      const date = args.date ?? vault.today();
      if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD');
      const entry = await vault.read(kind, date);
      return { kind, date, exists: entry.exists, title: entry.title, body: entry.body };
    },
  });

  add({
    name: 'diary_write',
    description: '写书房里的一页：主人的日记、鲸汐自己的日记，或整份主人侧写。默认草稿（draft），主人确认后才用 final。只写主人说过的事，第一人称，不美化。房间聊天用 room_log，不要用它写日记。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: KINDS, description: 'diary=主人的日记（默认），maid=鲸汐日记，profile=整份侧写。' },
        body: { type: 'string', description: '完整正文（不是片段）。' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天；profile 忽略日期。' },
        title: { type: 'string', description: '标题，可留空。' },
        mood: { type: 'string', description: '心情，一两个词。' },
        mode: { type: 'string', enum: ['draft', 'final'], description: 'draft=草稿，final=主人确认后定稿。' },
        private: { type: 'boolean', description: '是否私密：私密页不参与侧写、不进导出。' },
      },
      required: ['body'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          date: { type: 'string' },
          path: { type: 'string' },
          words: { type: 'number' },
          status: { type: 'string' },
        },
        required: ['kind', 'date', 'path', 'words', 'status'],
      },
      render: (_args, value) => text(`写好了：${value.path}（${value.words} 字，${value.status}）`),
    },
    async execute(args) {
      const kind = KINDS.includes(args.kind) ? args.kind : 'diary';
      const body = String(args.body ?? '');
      if (body.trim() === '') throw new Error('正文不能为空');
      if (body.length > 200_000) throw new Error('正文太长了');
      const mode = args.mode === 'final' ? 'final' : 'draft';
      const status = kind === 'profile' ? 'profile' : mode;

      if (kind === 'profile') {
        await vault.write('profile', null, {
          meta: { updated: vault.today() },
          body,
        }, '侧写更新');
        void refreshCard();
        return { kind, date: '', path: '侧写/主人.md', words: countWords(body), status };
      }

      const date = args.date ?? vault.today();
      if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD');
      const meta = { status, source: 'agent' };
      if (typeof args.title === 'string' && args.title.trim() !== '') meta.title = args.title.trim().slice(0, 120);
      if (typeof args.mood === 'string' && args.mood.trim() !== '') meta.mood = args.mood.trim().slice(0, 40);
      if (typeof args.private === 'boolean') meta.private = args.private;

      const saved = await vault.write(kind, date, { meta, body }, `${mode === 'final' ? '日记' : '草稿'} ${date}`);
      void refreshCard();
      return { kind, date, path: saved.path, words: countWords(body), status };
    },
  });

  add({
    name: 'room_log',
    description: '把这次房间聊天收成一条日志：副标题、一句摘要、标签、正文。房间只写日志，不写日记；要记今天，用书房流程。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '副标题，几个字，概括这次聊了什么。' },
        body: { type: 'string', description: '正文，用鲸汐的口吻，150–400 字，可以有一两句房间里的动作。' },
        summary: { type: 'string', description: '一句话摘要，给目录用。' },
        tags: { type: 'array', items: { type: 'string' }, description: '1–3 个标签，比如 房间、工作、心情。' },
        mood: { type: 'string', description: '这次聊天的心情，一两个词。' },
      },
      required: ['title', 'body'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          time: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['id', 'title', 'time', 'path'],
      },
      render: (_args, value) => text(`房间日志写好了：${value.time} · ${value.title}（${value.id}）`),
    },
    async execute(args, exec) {
      const title = String(args.title ?? '').trim();
      if (title === '') throw new Error('给这条日志起个副标题');
      const body = String(args.body ?? '');
      if (body.trim() === '') throw new Error('正文不能为空');
      const saved = await vault.writeRoomLog({
        title,
        body,
        summary: args.summary,
        tags: args.tags,
        mood: args.mood,
      });
      void renameSession(exec?.agent?.id, `房间 · ${saved.title}`);
      void refreshCard();
      return { id: saved.id, title: saved.title, time: saved.time, path: saved.path };
    },
  });

  add({
    name: 'room_read',
    description: '读一条房间日志的全文。先 memory_search 找编号，再用它打开。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '房间日志编号，例如 2026-10-23-234012。' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          time: { type: 'string' },
          summary: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['id', 'title', 'time', 'summary', 'body'],
      },
      render: (_args, value) => text(`${value.time} · ${value.title}\n\n${value.body}`),
    },
    async execute(args) {
      const id = String(args.id ?? '').trim();
      const entry = await vault.readRoomLog(id);
      if (!entry.exists) throw new Error('找不到这条房间日志');
      return { id: entry.id, title: entry.title, time: entry.time, summary: entry.summary, body: entry.body };
    },
  });

  add({
    name: 'memory_search',
    description: '想回忆以前聊过什么时，先搜这里：同时搜房间日志、日记、鲸汐日记和侧写，返回日期、标题和摘录。搜到后再用 room_read / diary_read 打开。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '要回忆的关键词或一句话。' },
        limit: { type: 'number', description: '最多几条，默认 10。' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string' },
                date: { type: 'string' },
                title: { type: 'string' },
                excerpt: { type: 'string' },
              },
              required: ['kind', 'date', 'title', 'excerpt'],
            },
          },
        },
        required: ['items'],
      },
      render: (_args, value) => text(value.items.length === 0
        ? '没有搜到。'
        : value.items.map((item) => `[${item.kind}] ${item.date} · ${item.title}\n${item.excerpt}`).join('\n\n')),
    },
    async execute(args) {
      const query = String(args.query ?? '').trim();
      if (query === '') throw new Error('要给个关键词');
      const items = await vault.search(query, args.limit ?? 10);
      return { items };
    },
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}
