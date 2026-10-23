window.__ModuleLoader__.load({
  id: 'dsh-diary-maid',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-diary-maid';
    const API = '/dsh-diary/api';

    const TEXT = {
      zh: {
        'panel': '鲸汐',
        'title': '鲸汐的抽屉',
        'subtitle': '把一天折好，收进抽屉里',
        'tab.today': '今天',
        'tab.pages': '书页',
        'tab.profile': '侧写',
        'tab.maid': '鲸汐',
        'action.close': '回到对话',
        'action.refresh': '刷新',
        'action.history': '历史版本',
        'action.save': '保存',
        'action.cancel': '取消',
        'action.edit': '编辑',
        'action.revert': '恢复这一版',
        'action.capture': '记下',
        'today.placeholder': '今天发生了什么？',
        'today.empty': '今天还没开始呢。',
        'today.captureHint': '先记一句，晚点再整理也行。',
        'today.saved': '记好了。',
        'today.streak': '已连续 {n} 天',
        'today.words': '{n} 字',
        'pages.empty': '还没有书页。',
        'pages.loadMore': '再往前翻',
        'profile.empty': '还没有侧写。',
        'maid.empty': '她今天还没写。',
        'history.title': '历史版本',
        'history.empty': '还没有历史版本。',
        'history.restored': '已经回到那一版了。',
        'history.confirm': '把这一页恢复到所选版本？当前内容会先被保存成一个新版本。',
        'error.load': '读取失败：{message}',
        'error.save': '保存失败：{message}',
        'empty.title': '抽屉还是空的',
        'empty.body': '从今天开始写第一页吧。',
        'git.on': 'git 已开启',
        'git.off': 'git 未开启',
        'private': '私密',
        'settings.title': '鲸汐的设置',
        'settings.avatar': '头像',
        'settings.avatarHint': '把图片放进日记本的 人设/ 目录，再点「重新扫描」。',
        'settings.rescan': '重新扫描',
        'settings.default': '默认',
        'settings.persona': '人设',
        'settings.personaHint': '现在只是存下来；v0.2 起，这份人设会被注入对话。',
        'settings.vault': '日记本',
        'settings.saved': '换好了。',
        'settings.personaSaved': '人设存好了。',
      },
      en: {
        'panel': 'Jingxi',
        'title': "Jingxi's Drawer",
        'subtitle': 'Fold the day, put it in the drawer',
        'tab.today': 'Today',
        'tab.pages': 'Pages',
        'tab.profile': 'Profile',
        'tab.maid': 'Jingxi',
        'action.close': 'Back to chat',
        'action.refresh': 'Refresh',
        'action.history': 'History',
        'action.save': 'Save',
        'action.cancel': 'Cancel',
        'action.edit': 'Edit',
        'action.revert': 'Restore this version',
        'action.capture': 'Note it',
        'today.placeholder': 'What happened today?',
        'today.empty': "Today hasn't started yet.",
        'today.captureHint': 'Jot one line now, tidy it later.',
        'today.saved': 'Noted.',
        'today.streak': '{n} days in a row',
        'today.words': '{n} words',
        'pages.empty': 'No pages yet.',
        'pages.loadMore': 'Load older pages',
        'profile.empty': 'No profile yet.',
        'maid.empty': "She hasn't written today.",
        'history.title': 'History',
        'history.empty': 'No history yet.',
        'history.restored': 'Restored that version.',
        'history.confirm': 'Restore this page to the selected version? The current text is saved as a new version first.',
        'error.load': 'Failed to load: {message}',
        'error.save': 'Failed to save: {message}',
        'empty.title': 'The drawer is empty',
        'empty.body': "Start with today's first page.",
        'git.on': 'git on',
        'git.off': 'git off',
        'private': 'private',
        'settings.title': "Jingxi's settings",
        'settings.avatar': 'Avatar',
        'settings.avatarHint': 'Drop images into 人设/ in the vault, then rescan.',
        'settings.rescan': 'Rescan',
        'settings.default': 'Default',
        'settings.persona': 'Persona',
        'settings.personaHint': 'Saved for now; from v0.2 this text is injected into chat.',
        'settings.vault': 'Vault',
        'settings.saved': 'Changed.',
        'settings.personaSaved': 'Persona saved.',
      },
    };

    const CSS = `
.dm-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;}
.dm-header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dm-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none;display:block;}
.dm-avatarbtn{border:0;background:none;padding:0;margin:0;cursor:pointer;flex:none;border-radius:50%;line-height:0;}
.dm-avatarbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.dm-headtext{min-width:0;}
.dm-titlerow{display:flex;align-items:center;gap:6px;min-width:0;}
.dm-title{font-size:15px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.dm-gearbutton{flex:none;border:0;background:none;color:var(--dsw-alias-label-secondary);padding:2px;line-height:0;cursor:pointer;border-radius:6px;}
.dm-gearbutton:hover{color:var(--dsw-alias-label-primary);}
.dm-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dm-actions{margin-left:auto;display:flex;gap:8px;align-items:center;}
.dm-iconbtn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit;}
.dm-iconbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}
.dm-tabs{display:flex;gap:2px;padding:4px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;flex:none;}
.dm-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;padding:9px 12px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;font-family:inherit;}
.dm-tab:hover{color:var(--dsw-alias-label-primary);}
.dm-tab.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600;}
.dm-body{flex:1;min-height:0;overflow-y:auto;padding:18px 20px 64px;width:100%;max-width:820px;margin:0 auto;box-sizing:border-box;}
.dm-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px 18px;margin-bottom:14px;}
.dm-row{display:flex;align-items:center;gap:10px;}
.dm-date{font-size:13px;font-weight:600;letter-spacing:.02em;}
.dm-meta{font-size:12px;color:var(--dsw-alias-label-secondary);margin-left:auto;display:flex;gap:8px;align-items:center;}
.dm-badge{font-size:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;color:var(--dsw-alias-label-secondary);}
.dm-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:10px;padding:12px 14px;font:inherit;font-size:14px;line-height:1.85;resize:vertical;min-height:120px;}
.dm-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}
.dm-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:9px;padding:7px 14px;font-size:13px;cursor:pointer;font-family:inherit;}
.dm-btn:hover{border-color:var(--dsw-alias-border-l2);}
.dm-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;}
.dm-btn.primary:hover{filter:brightness(1.05);}
.dm-btn:disabled{opacity:.5;cursor:default;}
.dm-btnrow{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;}
.dm-prose{font-size:14px;line-height:1.9;}
.dm-prose p{margin:0 0 12px;white-space:pre-wrap;}
.dm-prose h2{font-size:16px;margin:18px 0 10px;}
.dm-prose h3{font-size:14px;margin:16px 0 8px;color:var(--dsw-alias-label-primary);}
.dm-prose blockquote{margin:0 0 12px;padding:2px 0 2px 12px;border-left:2px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;}
.dm-prose ul{margin:0 0 12px;padding-left:20px;}
.dm-prose li{margin:2px 0;}
.dm-empty{text-align:center;padding:28px 16px 36px;color:var(--dsw-alias-label-secondary);}
.dm-empty img{width:120px;height:120px;object-fit:contain;border-radius:18px;margin-bottom:10px;opacity:.92;}
.dm-empty h3{font-size:14px;color:var(--dsw-alias-label-primary);margin:4px 0 6px;font-weight:600;}
.dm-empty p{font-size:13px;margin:0 0 14px;line-height:1.7;}
.dm-page{display:grid;grid-template-columns:64px 1fr;gap:16px;padding:16px 0;border-bottom:1px dashed var(--dsw-alias-border-l1);cursor:pointer;}
.dm-page:hover .dm-page-title{color:var(--dsw-alias-brand-primary);}
.dm-page-date{text-align:right;padding-top:2px;}
.dm-page-day{font-size:20px;font-weight:600;line-height:1;}
.dm-page-month{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;}
.dm-page-title{font-size:14px;font-weight:600;margin-bottom:5px;transition:color .12s;}
.dm-page-excerpt{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.dm-page-badges{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap;}
.dm-loadmore{display:block;margin:18px auto 0;}
.dm-toast{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);padding:8px 16px;border-radius:999px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);}
.dm-error{margin:12px 20px 0;padding:10px 14px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px;}
.dm-overlay{position:absolute;inset:0;background:rgba(0,0,0,.32);display:flex;justify-content:flex-end;z-index:20;}
.dm-sheet{width:min(400px,100%);height:100%;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.18);}
.dm-sheet-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px;font-weight:600;}
.dm-sheet-body{flex:1;overflow-y:auto;padding:8px 0 24px;}
.dm-commit{padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dm-commit time{font-size:11px;color:var(--dsw-alias-label-secondary);}
.dm-commit p{font-size:13px;margin:4px 0 8px;line-height:1.5;word-break:break-word;}
.dm-spin{font-size:12px;color:var(--dsw-alias-label-secondary);padding:24px 0;text-align:center;}
.dm-section{padding:16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dm-section h4{font-size:13px;font-weight:600;margin:0 0 10px;}
.dm-hint{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:10px 0 0;}
.dm-avatars{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.dm-avoption{width:54px;height:54px;border-radius:50%;border:2px solid transparent;padding:0;background:var(--dsw-alias-bg-layer-2);overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--dsw-alias-label-secondary);font-family:inherit;}
.dm-avoption img{width:100%;height:100%;object-fit:cover;display:block;}
.dm-avoption.selected{border-color:var(--dsw-alias-brand-primary);}
.dm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);word-break:break-all;margin:0;}
@media (max-width:640px){
  .dm-header{padding:10px 14px 10px 64px;}
  .dm-body{padding:14px 14px 80px;}
  .dm-page{grid-template-columns:52px 1fr;gap:12px;}
  .dm-page-day{font-size:18px;}
}
`;

    let ctxRef = null;

    function translator(dict) {
      return (key, vars) => {
        let text = dict[key] ?? key;
        if (vars) {
          for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
        }
        return text;
      };
    }

    async function request(path, options) {
      const response = await fetch(`${API}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || payload === null || payload.ok === false) {
        throw new Error((payload && payload.error) || `HTTP ${String(response.status)}`);
      }
      return payload;
    }

    function weekdays(lang) {
      return lang === 'en'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    }

    function formatDate(iso, lang) {
      const parts = String(iso).split('-').map(Number);
      if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return iso;
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      const label = lang === 'en'
        ? `${new Intl.DateTimeFormat('en', { month: 'short' }).format(date)} ${String(parts[2])}`
        : `${String(parts[1])}月${String(parts[2])}日`;
      return `${label} · ${weekdays(lang)[date.getDay()]}`;
    }

    function formatClock(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return String(iso);
      const pad = (value) => String(value).padStart(2, '0');
      return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function RichText({ text }) {
      const blocks = [];
      let paragraph = [];
      let list = [];
      let key = 0;

      const flushParagraph = () => {
        if (paragraph.length === 0) return;
        blocks.push(h('p', { key: `p${String(key++)}` }, paragraph.join('\n')));
        paragraph = [];
      };
      const flushList = () => {
        if (list.length === 0) return;
        blocks.push(h('ul', { key: `u${String(key++)}` }, list.map((item, index) => h('li', { key: String(index) }, item))));
        list = [];
      };

      for (const line of String(text ?? '').split('\n')) {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const quote = /^>\s?(.*)$/.exec(line);
        const item = /^[-*]\s+(.*)$/.exec(line);
        if (heading !== null) {
          flushParagraph();
          flushList();
          const level = heading[1].length;
          blocks.push(h(level <= 2 ? 'h2' : 'h3', { key: `h${String(key++)}` }, heading[2]));
        } else if (quote !== null) {
          flushParagraph();
          flushList();
          blocks.push(h('blockquote', { key: `q${String(key++)}` }, quote[1]));
        } else if (item !== null) {
          flushParagraph();
          list.push(item[1]);
        } else if (line.trim() === '') {
          flushParagraph();
          flushList();
        } else {
          flushList();
          paragraph.push(line);
        }
      }
      flushParagraph();
      flushList();
      return h('div', { className: 'dm-prose' }, blocks);
    }

    function GearGlyph() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
      },
      h('path', { d: 'M4 7h16M4 12h16M4 17h16' }),
      h('circle', { cx: 9, cy: 7, r: 2, fill: 'var(--dsw-alias-bg-base)' }),
      h('circle', { cx: 15, cy: 12, r: 2, fill: 'var(--dsw-alias-bg-base)' }),
      h('circle', { cx: 8, cy: 17, r: 2, fill: 'var(--dsw-alias-bg-base)' }));
    }

    function WhaleGlyph(props) {
      const size = props && props.size ? props.size : 18;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
        fill: 'currentColor',
      },
      h('path', {
        d: 'M2.6 12.9c0-3.1 3.2-5.6 7.1-5.6 2.9 0 5.4 1.3 6.6 3.2l3-1.5c-.5 2.5-1.8 4.2-3.7 5.1.2 3-2.4 5.4-6 5.4-3.9 0-7-2.5-7-5.5Z',
      }),
      h('circle', { cx: 7.4, cy: 11.6, r: 1.05, fill: 'var(--dsw-alias-bg-base)' }),
      h('path', { d: 'M10.8 6.2c0-1.2.5-1.8.5-2.7 0-.6-.3-1-.7-1.2.8-.1 1.4.4 1.4 1.1 0 1-.7 1.5-.7 2.8', fill: 'currentColor', opacity: '.85' }));
    }

    function App() {
      const locale = React.useMemo(() => {
        try {
          if (typeof ctxRef.locale.current === 'function') {
            const current = ctxRef.locale.current();
            if (typeof current === 'string' && current !== '') return current;
          }
        } catch {
          /* fall through to the default */
        }
        return 'zh';
      }, []);
      const t = React.useMemo(() => translator(TEXT[locale] ?? TEXT.zh), [locale]);

      const [boot, setBoot] = React.useState(null);
      const [tab, setTab] = React.useState('today');
      const [pageDate, setPageDate] = React.useState(null);
      const [entry, setEntry] = React.useState(null);
      const [maid, setMaid] = React.useState(null);
      const [profile, setProfile] = React.useState(null);
      const [editing, setEditing] = React.useState(false);
      const [draft, setDraft] = React.useState('');
      const [capture, setCapture] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const [error, setError] = React.useState('');
      const [history, setHistory] = React.useState(null);
      const [pages, setPages] = React.useState({ items: [], next: null, loading: false });
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [settings, setSettings] = React.useState(null);
      const [personaDraft, setPersonaDraft] = React.useState('');
      const [avatarUrl, setAvatarUrl] = React.useState(null);

      const lang = locale;
      const dayNumber = (iso) => String(iso).slice(8, 10).replace(/^0/u, '');
      const monthNumber = (iso) => String(iso).slice(5, 7).replace(/^0/u, '');

      const showNotice = (text) => {
        setNotice(text);
        window.setTimeout(() => setNotice(''), 2200);
      };

      const fail = (prefix) => (cause) => {
        setError(t(prefix, { message: cause instanceof Error ? cause.message : String(cause) }));
      };

      const loadState = async () => {
        setError('');
        try {
          const data = await request('/state');
          setBoot(data);
          setAvatarUrl(data.avatarUrl ?? null);
          setPageDate((current) => current ?? data.today);
        } catch (cause) {
          fail('error.load')(cause);
        }
      };

      const loadPage = async (date) => {
        try {
          const [one, her] = await Promise.all([
            request(`/entry?date=${encodeURIComponent(date)}`),
            request(`/maid?date=${encodeURIComponent(date)}`),
          ]);
          setEntry(one.entry);
          setMaid(her.entry);
          setDraft(one.entry.body ?? '');
          setEditing(false);
        } catch (cause) {
          fail('error.load')(cause);
        }
      };

      const loadPages = async (reset) => {
        setPages((current) => ({ ...current, loading: true }));
        try {
          const query = reset || pages.next === null
            ? '/entries?limit=30'
            : `/entries?limit=30&before=${encodeURIComponent(pages.next)}`;
          const data = await request(query);
          setPages((current) => ({
            items: reset || pages.next === null ? data.items : [...current.items, ...data.items],
            next: data.next,
            loading: false,
          }));
        } catch (cause) {
          setPages((current) => ({ ...current, loading: false }));
          fail('error.load')(cause);
        }
      };

      const loadProfile = async () => {
        try {
          const data = await request('/profile');
          setProfile(data.body ?? '');
        } catch (cause) {
          fail('error.load')(cause);
        }
      };

      React.useEffect(() => {
        if (boot !== null) return;
        loadState();
      }, [boot]);

      React.useEffect(() => {
        if (pageDate === null) return;
        loadPage(pageDate);
      }, [pageDate]);

      React.useEffect(() => {
        if (tab !== 'pages') return;
        loadPages(true);
      }, [tab]);

      React.useEffect(() => {
        if (tab !== 'profile' || profile !== null) return;
        loadProfile();
      }, [tab, profile]);

      const save = async () => {
        setBusy(true);
        setError('');
        try {
          const data = await request(`/entry?date=${encodeURIComponent(pageDate)}`, {
            method: 'PUT',
            body: JSON.stringify({ date: pageDate, body: draft }),
          });
          setEntry(data.entry);
          setEditing(false);
          setPages((current) => ({ ...current, items: [] }));
          showNotice(t('today.saved'));
        } catch (cause) {
          fail('error.save')(cause);
        } finally {
          setBusy(false);
        }
      };

      const remember = async () => {
        const text = capture.trim();
        if (text === '') return;
        setBusy(true);
        setError('');
        try {
          await request('/inbox', { method: 'POST', body: JSON.stringify({ date: boot.today, text }) });
          setCapture('');
          showNotice(t('today.saved'));
          setPageDate(boot.today);
        } catch (cause) {
          fail('error.save')(cause);
        } finally {
          setBusy(false);
        }
      };

      const openSettings = async () => {
        setSettingsOpen(true);
        setError('');
        try {
          const data = await request('/settings');
          setSettings(data);
          setPersonaDraft(data.persona?.text ?? '');
          const chosen = data.avatarName === null ? null : data.avatars.find((item) => item.name === data.avatarName);
          setAvatarUrl(chosen ? chosen.url : null);
        } catch (cause) {
          setSettingsOpen(false);
          fail('error.load')(cause);
        }
      };

      const chooseAvatar = async (name) => {
        try {
          const data = await request('/settings', {
            method: 'PUT',
            body: JSON.stringify({ avatarName: name }),
          });
          setSettings(data);
          const chosen = name === null ? null : data.avatars.find((item) => item.name === name);
          setAvatarUrl(chosen ? chosen.url : null);
          showNotice(t('settings.saved'));
        } catch (cause) {
          fail('error.save')(cause);
        }
      };

      const savePersona = async () => {
        if (personaDraft.trim() === '') return;
        try {
          await request('/persona', { method: 'PUT', body: JSON.stringify({ text: personaDraft }) });
          showNotice(t('settings.personaSaved'));
        } catch (cause) {
          fail('error.save')(cause);
        }
      };

      const openHistory = async (date) => {
        try {
          const data = await request(`/history?kind=diary&date=${encodeURIComponent(date)}`);
          setHistory({ date, commits: data.commits, loading: false });
        } catch (cause) {
          fail('error.load')(cause);
        }
      };

      const revert = async (commit) => {
        if (!window.confirm(t('history.confirm'))) return;
        try {
          const data = await request('/revert', {
            method: 'POST',
            body: JSON.stringify({ kind: 'diary', date: history.date, commit }),
          });
          setEntry(data.entry);
          setDraft(data.entry.body ?? '');
          setHistory(null);
          showNotice(t('history.restored'));
          setPages((current) => ({ ...current, items: [] }));
        } catch (cause) {
          fail('error.save')(cause);
        }
      };

      const closePanel = () => {
        try {
          ctxRef.layout.selectPanel(null);
        } catch {
          /* the shell may close the panel itself */
        }
      };

      const tabs = [
        ['today', t('tab.today')],
        ['pages', t('tab.pages')],
        ['profile', t('tab.profile')],
        ['maid', t('tab.maid')],
      ];

      const body = (() => {
        if (boot === null) return h('div', { className: 'dm-spin' }, '…');
        if (tab === 'pages') {
          if (pages.loading && pages.items.length === 0) return h('div', { className: 'dm-spin' }, '…');
          if (pages.items.length === 0) {
            return h('div', { className: 'dm-empty' },
              h('img', { src: boot.assets.sticker, alt: '' }),
              h('h3', null, t('pages.empty')),
              h('p', null, t('empty.body')));
          }
          return h('div', null,
            pages.items.map((item) => h('div', {
              key: item.date,
              className: 'dm-page',
              role: 'button',
              tabIndex: 0,
              onClick: () => { setPageDate(item.date); setTab('today'); },
              onKeyDown: (event) => { if (event.key === 'Enter') { setPageDate(item.date); setTab('today'); } },
            },
            h('div', { className: 'dm-page-date' },
              h('div', { className: 'dm-page-day' }, dayNumber(item.date)),
              h('div', { className: 'dm-page-month' }, `${monthNumber(item.date)}月`)),
            h('div', null,
              h('div', { className: 'dm-page-title' }, item.title || item.date),
              h('div', { className: 'dm-page-excerpt' }, item.excerpt || t('today.empty')),
              h('div', { className: 'dm-page-badges' },
                item.private ? h('span', { className: 'dm-badge' }, t('private')) : null,
                h('span', { className: 'dm-badge' }, t('today.words', { n: item.words })),
                item.hasMaid ? h('span', { className: 'dm-badge' }, '🐋') : null)))),
            pages.next !== null ? h('button', {
              className: 'dm-btn dm-loadmore',
              disabled: pages.loading,
              onClick: () => loadPages(false),
            }, t('pages.loadMore')) : null);
        }
        if (tab === 'profile') {
          if (profile === null) return h('div', { className: 'dm-spin' }, '…');
          return profile.trim() === ''
            ? h('div', { className: 'dm-empty' }, h('h3', null, t('profile.empty')))
            : h('div', { className: 'dm-card' }, h(RichText, { text: profile }));
        }
        if (tab === 'maid') {
          const bodyText = maid && maid.body ? maid.body : '';
          return bodyText.trim() === ''
            ? h('div', { className: 'dm-empty' },
              h('img', { src: boot.assets.sticker, alt: '' }),
              h('h3', null, t('maid.empty')),
              h('p', null, t('today.captureHint')))
            : h('div', { className: 'dm-card' },
              h('div', { className: 'dm-row' },
                h('div', { className: 'dm-date' }, formatDate(pageDate, lang)),
                h('div', { className: 'dm-meta' }, maid.meta && maid.meta.mood ? maid.meta.mood : '')),
              h(RichText, { text: bodyText }));
        }

        if (entry === null) return h('div', { className: 'dm-spin' }, '…');
        const hasText = (entry.body ?? '').trim() !== '';
        return h('div', null,
          h('div', { className: 'dm-row', style: { marginBottom: '12px' } },
            h('div', { className: 'dm-date' }, formatDate(pageDate, lang)),
            h('div', { className: 'dm-meta' },
              boot.streak > 0 ? h('span', { className: 'dm-badge' }, t('today.streak', { n: boot.streak })) : null,
              h('span', { className: 'dm-badge' }, boot.git.available ? t('git.on') : t('git.off')))),

          pageDate === boot.today ? h('div', { className: 'dm-card' },
            h('textarea', {
              className: 'dm-textarea',
              rows: 2,
              placeholder: t('today.captureHint'),
              value: capture,
              onChange: (event) => setCapture(event.target.value),
              style: { minHeight: '54px' },
            }),
            h('div', { className: 'dm-btnrow' },
              h('button', { className: 'dm-btn primary', disabled: busy || capture.trim() === '', onClick: remember }, t('action.capture')))) : null,

          h('div', { className: 'dm-card' },
            editing
              ? h('div', null,
                h('textarea', {
                  className: 'dm-textarea',
                  rows: 14,
                  value: draft,
                  autoFocus: true,
                  onChange: (event) => setDraft(event.target.value),
                }),
                h('div', { className: 'dm-btnrow' },
                  h('button', { className: 'dm-btn', onClick: () => { setDraft(entry.body ?? ''); setEditing(false); } }, t('action.cancel')),
                  h('button', { className: 'dm-btn primary', disabled: busy, onClick: save }, t('action.save'))))
              : hasText
                ? h('div', null,
                  h(RichText, { text: entry.body }),
                  h('div', { className: 'dm-btnrow', style: { marginTop: '18px' } },
                    h('button', { className: 'dm-btn', onClick: () => openHistory(pageDate) }, t('action.history')),
                    h('button', { className: 'dm-btn', onClick: () => { setDraft(entry.body ?? ''); setEditing(true); } }, t('action.edit'))))
                : h('div', { className: 'dm-empty' },
                  h('img', { src: boot.assets.sticker, alt: '' }),
                  h('h3', null, t('today.empty')),
                  h('p', null, t('empty.body')),
                  h('button', { className: 'dm-btn primary', onClick: () => { setDraft(''); setEditing(true); } }, t('action.edit')))),
        );
      })();

      return h('div', { className: 'dm-root' },
        h('style', null, CSS),
        h('div', { className: 'dm-header' },
          h('button', {
            className: 'dm-avatarbtn',
            onClick: openSettings,
            title: t('settings.title'),
            'aria-label': t('settings.title'),
          }, h('img', {
            className: 'dm-avatar',
            src: avatarUrl ?? (boot ? boot.assets.portrait : undefined),
            alt: '',
          })),
          h('div', { className: 'dm-headtext' },
            h('div', { className: 'dm-titlerow' },
              h('div', { className: 'dm-title' }, t('title')),
              h('button', {
                className: 'dm-gearbutton',
                onClick: openSettings,
                title: t('settings.title'),
                'aria-label': t('settings.title'),
              }, h(GearGlyph))),
            h('div', { className: 'dm-sub' },
              boot === null ? t('subtitle') : `${formatDate(boot.today, lang)} · ${String(boot.count)} 页`)),
          h('div', { className: 'dm-actions' },
            h('button', { className: 'dm-iconbtn', onClick: () => { setProfile(null); setPages({ items: [], next: null, loading: false }); loadState(); } }, t('action.refresh')),
            h('button', { className: 'dm-iconbtn', onClick: closePanel }, t('action.close')))),
        h('div', { className: 'dm-tabs' },
          tabs.map(([id, label]) => h('button', {
            key: id,
            className: `dm-tab${tab === id ? ' active' : ''}`,
            onClick: () => setTab(id),
          }, label))),
        h('div', { className: 'dm-body' }, body),
        error !== '' ? h('div', { className: 'dm-error', onClick: () => setError('') }, error) : null,
        notice !== '' ? h('div', { className: 'dm-toast' }, notice) : null,
        settingsOpen ? h('div', { className: 'dm-overlay', onClick: () => setSettingsOpen(false) },
          h('div', { className: 'dm-sheet', onClick: (event) => event.stopPropagation() },
            h('div', { className: 'dm-sheet-head' },
              h('span', null, t('settings.title')),
              h('button', { className: 'dm-iconbtn', style: { marginLeft: 'auto' }, onClick: () => setSettingsOpen(false) }, '✕')),
            settings === null
              ? h('div', { className: 'dm-spin' }, '…')
              : h('div', { className: 'dm-sheet-body' },
                h('div', { className: 'dm-section' },
                  h('h4', null, t('settings.avatar')),
                  h('div', { className: 'dm-avatars' },
                    h('button', {
                      className: `dm-avoption${settings.avatarName === null ? ' selected' : ''}`,
                      onClick: () => chooseAvatar(null),
                      title: t('settings.default'),
                    }, h('img', { src: boot ? boot.assets.portrait : undefined, alt: t('settings.default') })),
                    settings.avatars.map((item) => h('button', {
                      key: item.name,
                      className: `dm-avoption${settings.avatarName === item.name ? ' selected' : ''}`,
                      onClick: () => chooseAvatar(item.name),
                      title: item.name,
                    }, h('img', { src: item.url, alt: item.name })))),
                  h('p', { className: 'dm-hint' }, t('settings.avatarHint')),
                  h('div', { className: 'dm-btnrow' },
                    h('button', { className: 'dm-btn', onClick: openSettings }, t('settings.rescan')))),
                h('div', { className: 'dm-section' },
                  h('h4', null, t('settings.persona')),
                  h('textarea', {
                    className: 'dm-textarea',
                    rows: 12,
                    value: personaDraft,
                    onChange: (event) => setPersonaDraft(event.target.value),
                  }),
                  h('p', { className: 'dm-hint' }, t('settings.personaHint')),
                  h('div', { className: 'dm-btnrow' },
                    h('button', { className: 'dm-btn primary', onClick: savePersona }, t('action.save')))),
                h('div', { className: 'dm-section' },
                  h('h4', null, t('settings.vault')),
                  h('p', { className: 'dm-mono' }, settings.vault))))) : null,
        history !== null ? h('div', { className: 'dm-overlay', onClick: () => setHistory(null) },
          h('div', { className: 'dm-sheet', onClick: (event) => event.stopPropagation() },
            h('div', { className: 'dm-sheet-head' },
              h('span', null, `${t('history.title')} · ${formatDate(history.date, lang)}`),
              h('button', { className: 'dm-iconbtn', style: { marginLeft: 'auto' }, onClick: () => setHistory(null) }, '✕')),
            h('div', { className: 'dm-sheet-body' },
              history.commits.length === 0
                ? h('div', { className: 'dm-spin' }, t('history.empty'))
                : history.commits.map((commit) => h('div', { className: 'dm-commit', key: commit.hash },
                  h('time', null, formatClock(commit.at)),
                  h('p', null, commit.subject),
                  h('button', { className: 'dm-btn', onClick: () => revert(commit.hash) }, t('action.revert'))))))) : null,
      );
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctxRef = ctx;
        ctx.effect(() => ctx.locale.register(NS, { zh: TEXT.zh, en: TEXT.en }), 'dsh-diary-maid: dictionaries');
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'diary-maid',
          order: 6,
          locale: NS,
          label: () => ctx.locale.bind(NS)('panel'),
        }, WhaleGlyph));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'diary-maid',
          locale: NS,
        }, App));
      },
    };
  },
});
