import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../utils/config';
import {
  apiCall,
  API_BASE_KEY,
  clearSession,
  getApiBase,
  getStored,
  LAST_PROJECT_KEY,
  setStored,
} from '../../utils/api';
import type { AskResult, CapturePageData, CapturePageResult, ProjectRow, StoredSession } from '../../utils/types';

type Tab = 'capture' | 'ask';

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
            {(['capture', 'ask'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2 text-sm font-medium ${
                  tab === t ? 'border-b-2 border-emerald-500 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t === 'capture' ? '1 · Capture' : '2 · Ask'}
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
                      <p className="mb-1 font-semibold text-zinc-200">{capResult.title}</p>
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
          ) : (
            <div className="p-4">
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