import { countWords, isValidDate } from './vault.js';

const KINDS = ['diary', 'maid', 'profile', 'interview'];

function text(value) {
  return [{ type: 'text', text: value }];
}

/**
 * The three tools 鲸汐 uses to write.
 *
 * They are deliberately boring: validate, write through the vault (which
 * snapshots and commits), then tell the model exactly what landed where.
 * The model is not allowed to invent a fourth path around them.
 */
export function registerDiaryTools(ctx, { vault, refreshCard }) {
  const disposers = [];

  const add = (definition) => {
    disposers.push(ctx.effect(() => ctx.tools.register(definition), `dsh-diary-maid: ${definition.name}`));
  };

  add({
    name: 'diary_capture',
    description: '把主人刚说的一句话先记进今天的碎片（inbox），不整理、不改正文。主人随口讲今天发生了什么时用它；正式写日记用 diary_write。',
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
    description: '读一天的真实文字：主人的日记（diary）、鲸汐自己的日记（maid），或主人侧写（profile）。写之前先读，别靠记忆猜。',
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
    description: '写一天的一页：主人的日记、鲸汐自己的日记，或整份主人侧写。默认草稿（draft），主人确认后才用 final。只写主人说过的事，第一人称，不美化。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: KINDS, description: 'diary=主人的日记（默认），maid=鲸汐日记，profile=整份侧写，interview=访谈摘要。' },
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

      if (kind === 'interview') {
        const date = args.date ?? vault.today();
        if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD');
        const meta = { status, source: 'agent' };
        if (typeof args.mood === 'string' && args.mood.trim() !== '') meta.mood = args.mood.trim().slice(0, 40);
        const saved = await vault.write('interview', date, { meta, body }, `访谈 ${date}`);
        void refreshCard();
        return { kind, date, path: saved.path, words: countWords(body), status };
      }

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

  return () => {
    for (const dispose of disposers) dispose();
  };
}
