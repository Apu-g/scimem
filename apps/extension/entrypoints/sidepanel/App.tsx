import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../utils/config';
import {
  apiCall,
  apiCallText,
  API_BASE_KEY,
  clearSession,
  getApiBase,
  getStored,
  LAST_PROJECT_KEY,
  setStored,
} from '../../utils/api';
import type { AskResult, CapturePageData, CapturePageResult, ProjectRow, StoredSession } from '../../utils/types';

type Tab = 'capture' | 'ask' | 'drop';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<StoredSession | null>(null);

  // auth
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  // project
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // capture
  const [capBusy, setCapBusy] = useState(false);
  const [capMsg, setCapMsg] = useState<string | null>(null);
  const [capResult, setCapResult] = useState<CapturePageResult | null>(null);

  // ask
  const [tab, setTab] = useState<Tab>('capture');
  const [question, setQuestion] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [sources, setSources] = useState<NonNullable<AskResult['sources']>>([]);

  // context export
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // ⚡ / 🧠 drop cards
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [analysisMsg, setAnalysisMsg] = useState<string | null>(null);
  const [contextMd, setContextMd] = useState('');
  const [askMeta, setAskMeta] = useState<string | null>(null);

  // settings
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    void (async () => {
      const [stored, base] = await Promise.all([getStored<StoredSession>('scimem_session_v1'), getApiBase()]);
      setApiBase(base);
      if (stored?.access_token) {
        setSession(stored);
        const name = await getStored<string>(LAST_PROJECT_KEY);
        if (name) setProjectName(name);
        await loadProjects(stored.access_token);
      }
      setLoading(false);
    })();
  }, []);

  const token = useMemo(() => session?.access_token ?? '', [session]);

  async function loadProjects(tk: string) {
    try {
      const res = await apiCall<{ projects: ProjectRow[] }>('/api/projects', { token: tk });
      setProjects(res.projects ?? []);
    } catch {
      setProjects([]);
    }
  }

  async function doSignIn() {
    if (!email.trim() || !password) return;
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        setAuthMsg(`Sign-in failed: ${error?.message ?? 'no session'}`);
        return;
      }
      const store: StoredSession = {
        access_token: data.session.access_token,
        ...(data.session.refresh_token ? { refresh_token: data.session.refresh_token } : {}),
        ...(data.session.user.email ? { email: data.session.user.email } : {}),
      };
      await setStored('scimem_session_v1', store);
      setSession(store);
      await loadProjects(store.access_token);
      setPassword('');
      setEmail('');
    } catch (e) {
      setAuthMsg(`Unexpected: ${(e as Error).message}`);
    } finally {
      setAuthBusy(false);
    }
  }

  async function doSignOut() {
    await clearSession();
    setSession(null);
    setProjects([]);
    setCapResult(null);
    setAnswer(null);
  }

  async function doCapture() {
    if (capBusy) return;
    setCapBusy(true);
    setCapMsg(null);
    setCapResult(null);
    try {
      const res = await browser.runtime.sendMessage({ type: 'scimem:capture' });
      if (!res?.ok) {
        setCapMsg(`Could not read the page: ${res?.error ?? 'unknown'} — is this a chrome:// or store page?`);
        return;
      }
      const data = res.data as CapturePageData;
      await setStored(LAST_PROJECT_KEY, projectName.trim());

      const result = await apiCall<CapturePageResult>('/api/capture-page', {
        method: 'POST',
        body: {
          url: data.url,
          title: data.title,
          html: data.html,
          screenshot: data.screenshot ?? undefined,
          projectName: projectName.trim() || undefined,
        },
        token,
      });
      setCapResult(result);
      if (result.project && result.project !== projectName.trim() && !projects.some((p) => p.name === result.project)) {
        await loadProjects(token);
      }
      // refresh project list when a new project was created
      await loadProjects(token);
    } catch (e) {
      setCapMsg(`Capture failed: ${(e as Error).message}`);
    } finally {
      setCapBusy(false);
    }
  }

  async function doAsk() {
    const q = question.trim();
    if (!q || askBusy) return;
    setAskBusy(true);
    setAnswer(null);
    setAskNote(null);
    setSources([]);
    setAskMeta(null);
    try {
      const result = await apiCall<AskResult>('/api/ask', {
        method: 'POST',
        body: { question: q, projectName: projectName.trim() || undefined },
        token,
      });
      setAnswer(result.answer);
      setAskNote(result.note ?? null);
      setSources(result.sources ?? []);
      setAskMeta(
        `${((result.latency_ms ?? 0) / 1000).toFixed(1)}s · ${result.model ?? ''}${result.reranked ? ' · reranked' : ''}`,
      );
    } catch (e) {
      setAskNote((e as Error).message);
    } finally {
      setAskBusy(false);
    }
  }

  async function saveApiBase() {
    await setStored(API_BASE_KEY, apiBase.trim() || 'http://localhost:3000');
    setApiBase(apiBase.trim() || 'http://localhost:3000');
  }

  /** The project the drop cards act on. */
  function activeProject(): string {
    return (projectName || projects[0]?.name || '').trim();
  }

  async function doAnalyze() {
    const name = activeProject();
    if (analysisBusy || !session || !name) {
      if (!name) setAnalysisMsg('type a project name first');
      return;
    }
    setAnalysisBusy(true);
    setAnalysisMsg(null);
    try {
      const j = await apiCall<{ plain?: string; markdown?: string; latency_ms?: number }>(
        `/api/analyze?projectName=${encodeURIComponent(name)}`,
      );
      const body = j.plain || j.markdown || '';
      if (!body.trim()) throw new Error('the model returned nothing');
      setAnalysis(body);
      setAnalysisMsg(`${body.length} chars from ${j.latency_ms ?? 0}ms — drag it below`);
    } catch (e) {
      setAnalysisMsg((e as Error).message);
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function doFetchContext() {
    const name = activeProject();
    if (exportBusy || !session || !name) {
      if (!name) setExportMsg('type a project name first');
      return;
    }
    setExportBusy(true);
    setExportMsg(null);
    try {
      const text = await apiCallText(`/api/context-export?projectName=${encodeURIComponent(name)}`);
      setContextMd(text);
      setExportMsg(`${(text.length / 1000).toFixed(0)} KB ready to drag or save`);
    } catch (e) {
      setExportMsg((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  }

  async function doSaveContext(text: string) {
    const name = activeProject();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `scimem-${slug}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  /** Kept for the Ask tab's download button: fetch and save in one go. */
  async function doExportContext() {
    await doFetchContext();
    if (contextMd) await doSaveContext(contextMd);
  }

  if (loading) return <div className="p-4 text-zinc-500">Loading…</div>;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Project selector always on top */}
      {session && (
        <div className="border-b border-zinc-800 p-3">
          <label className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-zinc-500">
            Project (context stays in this project)
          </label>
          <input
            list="scimem-projects"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. scimem-build"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 outline-none focus:border-emerald-500"
          />
          <datalist id="scimem-projects">
            {projects.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <p className="mt-1 text-[0.7rem] leading-snug text-zinc-600">
            Capture and Ask act on this project. A name you type that doesn't exist yet is{' '}
            <em>created on capture</em>.
          </p>
        </div>
      )}

      {/* signed-in strip */}
      {session && (
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-500">
          <span className="truncate">{session.email}</span>
          <button onClick={doSignOut} className="text-zinc-400 hover:text-zinc-200">
            sign out
          </button>
        </div>
      )}

      {!session ? (
        <div className="p-4">
          <h1 className="mb-1 text-base font-semibold">Sign in to SCIMEM</h1>
          <p className="mb-3 text-xs text-zinc-500">
            Same account as the web playground (your e-mail + password — the same one you used to log in there).
          </p>
          <div className="flex flex-col gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 outline-none focus:border-emerald-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              onKeyDown={(e) => e.key === 'Enter' && void doSignIn()}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 outline-none focus:border-emerald-500"
            />
            {authMsg && <p className="text-xs text-amber-400">{authMsg}</p>}
            <button
              onClick={doSignIn}
              disabled={authBusy}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {authBusy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1">
          {/* tabs */}
          <div className="flex border-b border-zinc-800">
            {(['capture', 'ask', 'drop'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2 text-sm font-medium ${
                  tab === t ? 'border-b-2 border-emerald-500 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t === 'capture' ? '1 · Capture' : t === 'ask' ? '2 · Ask' : '3 · ⚡🧠 Drop'}
              </button>
            ))}
          </div>

          {tab === 'capture' ? (
            <div className="p-4">
              <p className="mb-3 text-xs text-zinc-500">
                One click: reads the <em>current tab</em> (url, title, live DOM, screenshot), extracts the readable text
                server-side, embeds it, and stores an HTML + screenshot snapshot in the <code>snapshots</code> bucket.
              </p>
              <button
                onClick={doCapture}
                disabled={capBusy}
                className="w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {capBusy ? 'Capturing page…' : 'Capture this page'}
              </button>

              {capMsg && <p className="mt-3 text-xs text-amber-400">{capMsg}</p>}

              {capResult && (
                <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">
                  {capResult.note ? (
                    <p className="text-amber-400">{capResult.note}</p>
                  ) : (
                    <>
                      <p className="mb-1 font-semibold text-zinc-200">
                        {capResult.title}
                        {capResult.platform && capResult.platform !== 'unknown' && (
                          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[0.65rem] font-normal uppercase text-zinc-400">
                            {capResult.platform}
                          </span>
                        )}
                      </p>
                      <p className="mb-2 break-all text-zinc-500">{capResult.url}</p>
                      <ul className="grid grid-cols-2 gap-1 text-zinc-400">
                        <li>chunks: {capResult.chunks ?? 0}</li>
                        <li>chars: {capResult.text_chars ?? 0}</li>
                        <li>
                          {capResult.duplicate ? 'duplicate ✓' : `${((capResult.latency_ms ?? 0) / 1000).toFixed(1)}s`}
                        </li>
                        <li>project: {capResult.project}</li>
                        <li className="col-span-2 break-all text-zinc-600">
                          html:{' '}
                          {capResult.snapshot_path ? `snapshots/${capResult.snapshot_path.split('/').slice(-3).join('/')}` : '—'}
                        </li>
                        <li className="col-span-2 break-all text-zinc-600">
                          shot:{' '}
                          {capResult.screenshot_path
                            ? `snapshots/${capResult.screenshot_path.split('/').slice(-3).join('/')}`
                            : '—'}
                        </li>
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : tab === 'ask' ? (
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[0.7rem] text-zinc-500">Ask only within this project</span>
                <button
                  onClick={doExportContext}
                  disabled={exportBusy}
                  className="rounded border border-zinc-700 px-2 py-1 text-[0.7rem] hover:bg-zinc-800 disabled:opacity-50"
                >
                  {exportBusy ? 'downloading…' : '⬇ Context file (.md)'}
                </button>
              </div>
              {exportMsg && <p className="mb-2 text-[0.7rem] text-emerald-400">{exportMsg}</p>}
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void doAsk()}
                  placeholder="Ask only within this project…"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={doAsk}
                  disabled={askBusy || !question.trim()}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {askBusy ? '…' : 'Ask'}
                </button>
              </div>
              {askMeta && <p className="mt-2 text-xs text-zinc-500">{askMeta}</p>}
              {askNote && <p className="mt-2 text-xs text-amber-400">{askNote}</p>}
              {answer && (
                <div className="answer mt-3 max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {answer}
                </div>
              )}
              {sources && sources.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-zinc-400">{sources.length} source chunk(s)</summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {sources.map((s) => (
                      <li key={s.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                        <div className="mb-0.5 text-zinc-500">
                          {s.ref} {s.id.slice(0, 8)}… · sim {s.similarity?.toFixed(3) ?? '—'}
                        </div>
                        <p className="text-zinc-300">{s.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <p className="text-xs text-zinc-500">
                Take this project's memory anywhere. Both cards drag straight into ChatGPT, Gemini or Claude, and
                every one carries the source links so what you paste stays traceable.
              </p>

              <DropCard
                icon="⚡"
                label="Compressed analysis"
                hint="TL;DR + the concrete facts + key sources. Small enough for any chat."
                text={analysis}
                busy={analysisBusy}
                error={analysisMsg}
                onBuild={doAnalyze}
              />
              <DropCard
                icon="🧠"
                label="Full context"
                hint="Everything captured, in markdown, links included."
                text={contextMd}
                busy={exportBusy}
                error={exportMsg}
                onBuild={doFetchContext}
                onSave={contextMd ? () => doSaveContext(contextMd) : undefined}
              />
            </div>
          )}
        </div>
      )}

      {/* API base settings */}
      <div className="flex items-center gap-2 border-t border-zinc-900 p-3">
        <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder="http://localhost:3000"
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-emerald-600"
        />
        <button onClick={saveApiBase} className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
          api
        </button>
      </div>
    </div>
  );
}

/**
 * A card you drag into any chat.
 *
 * Dragging out of a Chrome side panel into a web page is less reliable than
 * dragging inside a normal tab (the panel is its own document), so the copy
 * button is not a fallback afterthought — on several sites it is the only path
 * that works at all.
 */
function DropCard({
  icon,
  label,
  hint,
  text,
  busy,
  error,
  onBuild,
  buildLabel,
  onSave,
}: {
  icon: string;
  label: string;
  hint: string;
  text: string;
  busy: boolean;
  error: string | null;
  onBuild: () => void | Promise<void>;
  buildLabel?: string | undefined;
  onSave?: (() => void | Promise<void>) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const ready = text.trim().length > 0;

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData('text/html', `<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-zinc-200">{label}</div>
          <div className="text-[0.65rem] leading-snug text-zinc-500">{hint}</div>
        </div>
      </div>

      <button
        onClick={onBuild}
        disabled={busy}
        className="mt-2 w-full rounded border border-zinc-700 px-2 py-1 text-[0.7rem] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        {busy ? 'building…' : (buildLabel ?? 'build')}
      </button>
      {error && <p className="mt-1 text-[0.65rem] text-amber-400">{error}</p>}

      <div
        draggable={ready}
        onDragStart={onDragStart}
        title={ready ? 'drag into any chat' : 'build it first'}
        className={`mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[0.65rem] leading-snug text-zinc-400 ${
          ready ? 'cursor-grab active:cursor-grabbing' : 'opacity-50'
        }`}
      >
        {ready ? `${text.slice(0, 500)}${text.length > 500 ? '\n…' : ''}` : busy ? 'building…' : 'nothing to drag yet'}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          onClick={copy}
          disabled={!ready}
          className="flex-1 rounded border border-zinc-700 px-2 py-1 text-[0.65rem] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {copied ? 'copied ✓' : 'copy'}
        </button>
        {onSave && (
          <button
            onClick={onSave}
            className="rounded border border-zinc-700 px-2 py-1 text-[0.65rem] text-zinc-300 hover:bg-zinc-800"
          >
            save .md
          </button>
        )}
      </div>
    </div>
  );
}