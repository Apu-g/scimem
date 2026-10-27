'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';
import { isNetworkError, NETWORK_HINT } from '@/lib/supabase/errors';

interface StatsRes {
  totals: {
    projects: number;
    events: number;
    chunks: number;
    snapshots: number;
    screenshots: number;
    queries: number;
  };
  projects: Array<{
    id: string;
    name: string;
    created_at: string;
    events: number;
    chunks: number;
    snapshots: number;
    screenshots: number;
    queries: number;
    last_event_at: string | null;
  }>;
  captures: Array<{
    id: string;
    project: string;
    platform: string;
    url: string;
    title: string;
    captured_at: string;
    chunks?: number;
  }>;
  asks: Array<{
    id: string;
    project: string;
    client: string;
    question: string;
    latency_ms: number | null;
    tokens_raw: number | null;
    tokens_compiled: number | null;
    created_at: string;
  }>;
}

interface TraceRes {
  project: { id: string; name: string };
  totals: {
    sources: number;
    chunks: number;
    asks: number;
    first_captured_at: string | null;
    last_captured_at: string | null;
  };
  sources: Array<{
    id: string;
    title: string;
    url: string | null;
    platform: string;
    source_type: string;
    captured_at: string;
    chunks: number;
    visits: number | null;
    has_snapshot: boolean;
    has_screenshot: boolean;
  }>;
  asks: Array<{
    id: string;
    question: string;
    answer: string | null;
    client: string;
    latency_ms: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    created_at: string;
  }>;
}

interface BuildStatus {
  built: boolean;
  stale: boolean;
  builtAt: string | null;
  sourceChangedAt: string | null;
  detail: string;
}

interface ChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
}

interface AnalysisRes {
  markdown: string;
  plain: string;
  sources: number;
  model?: string;
  latency_ms?: number;
}

export default function Page() {
  // auth
  const [session, setSession] = useState<'loading' | 'anon' | 'user'>('loading');
  const [user, setUser] = useState<{ id: string; email?: string | undefined } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  // stats / dashboard
  const [stats, setStats] = useState<StatsRes | null>(null);
  const [statsMsg, setStatsMsg] = useState<string | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dlMsg, setDlMsg] = useState<string | null>(null);

  // trace view: click a project → its captured sources + ask history
  const [traceProject, setTraceProject] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceRes | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceMsg, setTraceMsg] = useState<string | null>(null);

  // ⚡ compressed analysis (generated on demand, cached per project in state)
  const [analysis, setAnalysis] = useState<Record<string, AnalysisRes>>({});
  const [analysisBusy, setAnalysisBusy] = useState<string | null>(null);
  const [analysisMsg, setAnalysisMsg] = useState<string | null>(null);

  // 🧠 full context markdown, fetched on demand for the drag card
  const [mdBusy, setMdBusy] = useState<string | null>(null);
  const [mdMsg, setMdMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const supabase = browserSupabase();
        const {
          data: { session: s },
        } = await supabase.auth.getSession();
        if (!alive) return;
        if (s) {
          setUser({ id: s.user.id, email: s.user.email ?? undefined });
          setSession('user');
          void loadStats();
        } else {
          setSession('anon');
        }
      } catch {
        if (alive) setSession('anon');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadStats = async () => {
    setStatsBusy(true);
    setStatsMsg(null);
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) {
        setStatsMsg(`stats load failed (${res.status})`);
        setStats(null);
        return;
      }
      setStats((await res.json()) as StatsRes);
    } catch (e) {
      setStatsMsg((e as Error).message);
    } finally {
      setStatsBusy(false);
    }
  };

  const afterLogin = async (u: { id: string; email?: string | undefined }) => {
    setUser(u);
    setSession('user');
    void loadStats();
  };

  const doAuth = async (mode: 'signin' | 'signup') => {
    if (authBusy || !email.trim() || !password) return;
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      const supabase = browserSupabase();

      // Sign-up goes through our own route: it creates the account pre-confirmed,
      // so it works even when the Supabase project requires e-mail confirmation
      // (where plain signUp returns no session and sign-in is refused).
      if (mode === 'signup') {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setAuthMsg(body.error ?? `sign up failed (${res.status})`);
          return;
        }
        // 503 from our route means Supabase itself was unreachable — the browser
        // sign-in below would fail the same way, so say so now.
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        // "Failed to fetch" means the Supabase host is unreachable, which is a
        // network problem — saying "Invalid login credentials" would be a lie.
        setAuthMsg(isNetworkError(error) ? NETWORK_HINT : error.message);
        return;
      }
      if (!data.user) {
        setAuthMsg('signed up, but sign-in returned no user — try the password once more');
        return;
      }
      await afterLogin({ id: data.user.id, email: data.user.email ?? undefined });
    } catch (e) {
      setAuthMsg(isNetworkError(e) ? NETWORK_HINT : (e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const doSignOut = async () => {
    await browserSupabase().auth.signOut();
    setSession('anon');
    setUser(null);
    setStats(null);
    setStatsMsg(null);
  };

  const doDownloadExtension = async () => {
    if (downloading) return;
    setDownloading(true);
    setDlMsg(null);
    try {
      const res = await fetch('/api/extension-download');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDlMsg(body.error ?? `download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scimem-extension.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDlMsg('Saved scimem-extension.zip — unzip it, then load at chrome://extensions → Load unpacked.');
    } catch (e) {
      setDlMsg(`download failed: ${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  };

  const openTrace = async (name: string) => {
    if (traceProject === name) {
      setTraceProject(null);
      setTrace(null);
      return;
    }
    setTraceProject(name);
    setTrace(null);
    setTraceBusy(true);
    setTraceMsg(null);
    try {
      const res = await fetch(`/api/trace?projectName=${encodeURIComponent(name)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setTraceMsg((body as { error?: string } | null)?.error ?? `trace failed (${res.status})`);
        return;
      }
      setTrace(body as TraceRes);
    } catch (e) {
      setTraceMsg((e as Error).message);
    } finally {
      setTraceBusy(false);
    }
  };

  /** ⚡ — compressed analysis, generated once per project and kept. */
  const loadAnalysis = async (name: string) => {
    if (analysis[name]) return;
    setAnalysisBusy(name);
    setAnalysisMsg(null);
    try {
      const res = await fetch(`/api/analyze?projectName=${encodeURIComponent(name)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setAnalysisMsg((body as { error?: string } | null)?.error ?? `analysis failed (${res.status})`);
        return;
      }
      setAnalysis((prev) => ({ ...prev, [name]: body as AnalysisRes }));
    } catch (e) {
      setAnalysisMsg((e as Error).message);
    } finally {
      setAnalysisBusy(null);
    }
  };

  // chunk-level inspection + deletion, inside the trace view
  const [openChunks, setOpenChunks] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Record<string, ChunkRow[]>>({});
  const [chunksBusy, setChunksBusy] = useState(false);
  const [busyChunks, setBusyChunks] = useState<string | null>(null);
  const [chunkMsg, setChunkMsg] = useState<string | null>(null);

  /** 🧠 — the full project context as markdown, for the drag card. */  const loadMarkdown = async (name: string) => {
    setMdBusy(name);
    setMdMsg(null);
    try {
      const res = await fetch(`/api/context-export?projectName=${encodeURIComponent(name)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMdMsg(body.error ?? `context load failed (${res.status})`);
        return;
      }
      const markdown = await res.text();
      // separate key so the full context never overwrites the ⚡ analysis
      setAnalysis((prev) => ({ ...prev, [`${name}::md`]: { markdown, plain: markdown, sources: 0 } }));
      downloadText(`${slug(name)}.md`, markdown);
    } catch (e) {
      setMdMsg((e as Error).message);
    } finally {
      setMdBusy(null);
    }
  };

  const chunksOf = (eventId: string): ChunkRow[] => chunks[eventId] ?? [];

  const toggleChunks = async (eventId: string, title: string) => {
    if (openChunks === eventId) {
      setOpenChunks(null);
      return;
    }
    setOpenChunks(eventId);
    if (chunks[eventId]) return;
    setChunksBusy(true);
    setChunkMsg(null);
    try {
      const res = await fetch(`/api/chunks?eventId=${encodeURIComponent(eventId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setChunkMsg((body as { error?: string } | null)?.error ?? `chunks failed (${res.status})`);
        return;
      }
      setChunks((prev) => ({ ...prev, [eventId]: (body as { chunks: ChunkRow[] }).chunks }));
    } catch (e) {
      setChunkMsg((e as Error).message);
    } finally {
      setChunksBusy(false);
    }
    void title;
  };

  const deleteChunk = async (id: string) => {
    const res = await fetch(`/api/chunks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setChunkMsg(body.error ?? `delete failed (${res.status})`);
      return;
    }
    setChunks((prev) => {
      const next = { ...prev };
      for (const [eventId, rows] of Object.entries(next)) {
        if (rows.some((r) => r.id === id)) next[eventId] = rows.filter((r) => r.id !== id);
      }
      return next;
    });
    void loadStats();
    if (openChunks) void refreshTraceCounts();
  };

  /** Drop every chunk of one source (the capture shell stays for the audit trail). */
  const deleteChunks = async (eventId: string, title: string) => {
    const rows = chunks[eventId];
    if (!rows || rows.length === 0) {
      setChunkMsg('open the source first so I know which chunks to delete');
      return;
    }
    if (!window.confirm(`Delete ${rows.length} chunk(s) from "${title}"?\n\nThe source stays in your history.`)) return;
    setBusyChunks(eventId);
    setChunkMsg(null);
    const results = await Promise.all(rows.map((r) => fetch(`/api/chunks?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' })));
    const failed = results.filter((r) => !r.ok).length;
    setChunks((prev) => ({ ...prev, [eventId]: [] }));
    setChunkMsg(failed > 0 ? `${failed} of ${rows.length} chunk(s) failed to delete` : `deleted ${rows.length} chunk(s)`);
    setBusyChunks(null);
    void loadStats();
    void refreshTraceCounts();
  };

  const refreshTraceCounts = async () => {
    if (!traceProject) return;
    const res = await fetch(`/api/trace?projectName=${encodeURIComponent(traceProject)}`);
    const body = await res.json().catch(() => null);
    if (res.ok && body) setTrace(body as TraceRes);
  };

  const { totals, projects } = useMemo(() => {
    const t = stats?.totals;
    const p = stats?.projects ?? [];
    const sp = p.every((x) => x.snapshots === 0 && x.screenshots === 0)
      ? p // missing snapshots row? keep raw
      : p;
    return {
      totals: t,
      projects: sp,
    };
  }, [stats]);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SCIMEM <span className="text-emerald-400">monitoring</span>
          </h1>
          <p className="text-sm text-zinc-400">
            your project-memory department — everything in order from the database
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          {session === 'user' && <span className="truncate">{user?.email}</span>}
          {session === 'user' && (
            <button onClick={doSignOut} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800">
              sign out
            </button>
          )}
        </div>
      </header>

      {session === 'loading' && <p className="text-zinc-500">Loading…</p>}

      {session === 'anon' && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* left: sign in / sign up */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-1 font-semibold">Your SCIMEM account</h2>
            <p className="mb-4 text-xs text-zinc-400">
              Same account as the extension. New here? <em>Sign up</em> — it works immediately, no e-mail
              confirmation to click through.
            </p>
            <div className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                onKeyDown={(e) => e.key === 'Enter' && void doAuth('signin')}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              {authMsg && <p className="text-xs text-amber-400">{authMsg}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => void doAuth('signin')}
                  disabled={authBusy || !email.trim() || !password}
                  className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {authBusy ? '…' : 'Sign in'}
                </button>
                <button
                  onClick={() => void doAuth('signup')}
                  disabled={authBusy || !email.trim() || !password}
                  className="flex-1 rounded-md border border-emerald-700 px-3 py-2 text-sm text-emerald-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Sign up
                </button>
              </div>
            </div>
          </section>

          {/* right: download the extension */}
          <DownloadCard busy={downloading} msg={dlMsg} onDownload={doDownloadExtension} />
        </div>
      )}

      {session === 'user' && (
        <div className="flex flex-col gap-6">
          <DownloadCard busy={downloading} msg={dlMsg} onDownload={doDownloadExtension} />

          {/* totals */}
          {statsBusy && !stats && <p className="text-zinc-500">Loading stats…</p>}
          {statsMsg && <p className="text-xs text-amber-400">{statsMsg}</p>}
          {totals && (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Projects" value={totals.projects} hint="project-memory folders" />
              <StatCard label="Context taken" value={totals.events} hint="sources captured into the projects" />
              <StatCard label="Context chunks" value={totals.chunks} hint="embedded, retrievable chunks (pgvector)" />
              <StatCard label="Snapshots" value={totals.snapshots} hint="raw DOM / snapshot blobs" />
              <StatCard label="Screenshots" value={totals.screenshots} hint="browser screenshots taken" />
              <StatCard label="Questions asked" value={totals.queries} hint="asks logged from all clients" />
            </section>
          )}

          {/* project table */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-1 font-semibold">Projects · in order</h2>
            <p className="mb-3 text-xs text-zinc-400">Each row is one project with its contexts, chunks, snapshots, screenshots and questions.</p>
            {projects.length === 0 && !statsBusy && <p className="text-xs text-zinc-500">No projects yet — capture a page into one with the extension.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Project</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 pr-3 text-right font-medium">Context</th>
                    <th className="py-2 pr-3 text-right font-medium">Chunks</th>
                    <th className="py-2 pr-3 text-right font-medium">Snapshots</th>
                    <th className="py-2 pr-3 text-right font-medium">Screenshots</th>
                    <th className="py-2 pr-3 text-right font-medium">Questions</th>
                    <th className="py-2 pl-2 text-right font-medium">Danger</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => void openTrace(p.name)}
                      className={`cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/60 ${
                        traceProject === p.name ? 'bg-zinc-900/80' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-medium text-emerald-300">
                        {traceProject === p.name ? '▾ ' : '▸ '}
                        {p.name}
                      </td>
                      <td className="py-2 pr-3 text-xs text-zinc-500">{new Date(p.created_at).toLocaleDateString()}</td>
                      <td className="py-2 pr-3 text-right">{p.events}</td>
                      <td className="py-2 pr-3 text-right">{p.chunks}</td>
                      <td className="py-2 pr-3 text-right">{p.snapshots}</td>
                      <td className="py-2 pr-3 text-right">{p.screenshots}</td>
                      <td className="py-2 pr-3 text-right">{p.queries}</td>
                      <td className="py-2 pl-2 text-right">
                        <DeleteProjectButton
                          project={{ id: p.id, name: p.name, events: p.events, chunks: p.chunks }}
                          onDeleted={(name) => {
                            if (traceProject === name) {
                              setTraceProject(null);
                              setTrace(null);
                            }
                            void loadStats();
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* trace: the sources behind the selected project, plus the drag cards */}
          {traceProject && (
            <section className="rounded-xl border border-emerald-900/60 bg-zinc-900/50 p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Trace · {traceProject}</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void loadAnalysis(traceProject)}
                    disabled={analysisBusy === traceProject}
                    className="rounded-md bg-amber-500/90 px-2.5 py-1 text-[0.7rem] font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                  >
                    ⚡ {analysis[traceProject] ? 'analysis ready' : 'compressed analysis'}
                  </button>
                  <button
                    onClick={() => void loadMarkdown(traceProject)}
                    disabled={mdBusy === traceProject}
                    className="rounded-md bg-fuchsia-500/90 px-2.5 py-1 text-[0.7rem] font-semibold text-black hover:bg-fuchsia-400 disabled:opacity-50"
                  >
                    🧠 {mdBusy === traceProject ? 'preparing…' : 'context .md'}
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-zinc-400">
                Every source this project learned from. Drag ⚡ or 🧠 into any chat — the links travel with the
                text, so the pasted context stays traceable.
              </p>

              {analysisMsg && <p className="mb-2 text-xs text-amber-400">{analysisMsg}</p>}
              {mdMsg && <p className="mb-2 text-xs text-amber-400">{mdMsg}</p>}
              {chunkMsg && <p className="mb-2 text-xs text-amber-400">{chunkMsg}</p>}

              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <DragCard
                  icon="⚡"
                  label={`Compressed analysis · ${traceProject}`}
                  hint="Dense brief: TL;DR + facts + key sources. Small enough for any chat."
                  text={analysis[traceProject]?.plain ?? ''}
                  html={analysis[traceProject] ? `<pre>${escapeHtml(analysis[traceProject]!.markdown)}</pre>` : undefined}
                  busy={analysisBusy === traceProject}
                  note={
                    analysis[traceProject]
                      ? `${analysis[traceProject]!.plain.length} chars · ${analysis[traceProject]!.sources} sources`
                      : null
                  }
                />
                <DragCard
                  icon="🧠"
                  label={`Full context · ${traceProject}`}
                  hint="The complete captured markdown, every source in full, links included."
                  text={analysis[`${traceProject}::md`]?.plain ?? ''}
                  busy={mdBusy === traceProject}
                  note={
                    analysis[`${traceProject}::md`]
                      ? `${analysis[`${traceProject}::md`]!.plain.length} chars — also saved as a .md file`
                      : 'press 🧠 to build it'
                  }
                />
              </div>

              {traceBusy && <p className="text-xs text-zinc-500">Loading trace…</p>}
              {traceMsg && <p className="text-xs text-amber-400">{traceMsg}</p>}

              {trace && (
                <>
                  <p className="mb-2 text-[0.7rem] text-zinc-500">
                    {trace.totals.sources} source(s) · {trace.totals.chunks} chunk(s) · {trace.totals.asks} question(s)
                  </p>
                  <ol className="space-y-1.5">
                    {trace.sources.map((s, i) => (
                      <li key={s.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5 text-xs">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <button
                            onClick={() => void toggleChunks(s.id, s.title)}
                            className="text-left font-medium text-zinc-200 hover:text-emerald-300"
                            title="show / hide the chunks of this source"
                          >
                            <span className="text-zinc-600">{openChunks === s.id ? '▾' : '▸'}</span>{' '}
                            {i + 1}. {s.title}
                          </button>
                          <span className="flex items-center gap-2 text-[0.65rem] text-zinc-500">
                            {s.platform} · {s.chunks} chunk(s)
                            {s.visits ? ` · ${s.visits} visit(s)` : ''}
                            {s.has_screenshot ? ' · 📷' : ''}
                            {s.chunks > 0 && (
                              <button
                                onClick={() => void deleteChunks(s.id, s.title)}
                                disabled={busyChunks === s.id}
                                title={`Delete all ${s.chunks} chunk(s) of this source`}
                                className="rounded border border-red-900 px-1 text-[0.6rem] text-red-400 hover:bg-red-950/50 disabled:opacity-50"
                              >
                                {busyChunks === s.id ? '…' : 'drop chunks'}
                              </button>
                            )}
                          </span>
                        </div>
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block truncate text-[0.7rem] text-emerald-400 hover:underline"
                          >
                            {s.url}
                          </a>
                        )}
                        <p className="mt-0.5 text-[0.65rem] text-zinc-600">
                          {new Date(s.captured_at).toLocaleString()}
                        </p>
                        {openChunks === s.id && (
                          <div className="mt-2 space-y-1 border-l border-zinc-800 pl-2">
                            {chunksBusy ? (
                              <p className="text-[0.65rem] text-zinc-500">loading chunks…</p>
                            ) : chunksOf(s.id).length === 0 ? (
                              <p className="text-[0.65rem] text-zinc-500">no chunks left for this source</p>
                            ) : (
                              chunksOf(s.id).map((c) => (
                                <div key={c.id} className="flex items-start gap-2">
                                  <p className="min-w-0 flex-1 text-[0.65rem] text-zinc-400">
                                    #{c.chunk_index} · {c.content.slice(0, 180)}
                                    {c.content.length > 180 ? '…' : ''}
                                  </p>
                                  <button
                                    onClick={() => void deleteChunk(c.id)}
                                    title="delete this chunk"
                                    className="shrink-0 rounded border border-red-900 px-1 text-[0.6rem] text-red-400 hover:bg-red-950/50"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                    {trace.sources.length === 0 && (
                      <li className="text-xs text-zinc-500">Nothing captured into this project yet.</li>
                    )}
                  </ol>

                  {trace.asks.length > 0 && (
                    <>
                      <h3 className="mt-4 mb-2 text-xs font-semibold text-zinc-300">Questions asked</h3>
                      <ul className="space-y-1.5">
                        {trace.asks.map((a) => (
                          <li key={a.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5 text-xs">
                            <p className="text-zinc-200">{a.question}</p>
                            {a.answer && <p className="mt-1 text-zinc-500">{a.answer}</p>}
                            <p className="mt-1 text-[0.65rem] text-zinc-600">
                              {a.client} · {new Date(a.created_at).toLocaleString()}
                              {a.tokens_in ? ` · ${a.tokens_in} in / ${a.tokens_out ?? 0} out tokens` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </section>
          )}

          {/* capture feed + question feed side by side; stack on mobile */}
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-1 font-semibold">Recent context taken</h2>
              <p className="mb-3 text-xs text-zinc-400">Latest captures across all projects, recency first.</p>
              <ul className="flex flex-col gap-2">
                {(stats?.captures ?? []).slice(0, 9).map((c) => (
                  <li key={c.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5 text-xs">
                    <div className="mb-0.5 flex justify-between gap-2">
                      <span className="font-medium text-zinc-200">{c.title || c.url || 'capture'}</span>
                      <span className="shrink-0 text-zinc-500">
                        {c.platform && c.platform !== 'web' ? c.platform : c.project}
                      </span>
                    </div>
                    <p className="truncate text-zinc-500">{c.url}</p>
                    <p className="mt-1 text-zinc-600">
                      {new Date(c.captured_at).toLocaleString()}
                      {c.chunks ? ` · ${c.chunks} chunk(s)` : ''}
                    </p>
                  </li>
                ))}
                {(stats?.captures ?? []).length === 0 && <p className="text-xs text-zinc-500">No captures yet.</p>}
              </ul>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-1 font-semibold">Questions asked</h2>
              <p className="mb-3 text-xs text-zinc-400">Everything the extensions and users asked, recency first.</p>
              <ul className="flex flex-col gap-2">
                {(stats?.asks ?? []).slice(0, 9).map((a) => (
                  <li key={a.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5 text-xs">
                    <p className="text-zinc-200">{a.question}</p>
                    <p className="mt-1 text-zinc-500">
                      {a.project} · {a.client}
                      {a.latency_ms ? ` · ${(a.latency_ms / 1000).toFixed(1)}s` : ''}
                      {a.tokens_raw ? ` · ${a.tokens_raw} raw tokens` : ''}
                    </p>
                    <p className="mt-0.5 text-zinc-600">{new Date(a.created_at).toLocaleString()}</p>
                  </li>
                ))}
                {(stats?.asks ?? []).length === 0 && <p className="text-xs text-zinc-500">No questions yet.</p>}
              </ul>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

/**
 * A card you drag into any chat.
 *
 * HTML5 drag-and-drop is all that is needed for GPT/Gemini/Claude (they accept a
 * text/plain drop), but several web chats — WhatsApp among them — ignore drops
 * entirely, so every card ships a one-click copy that puts the exact same bytes
 * on the clipboard. Drag for the pretty sites, copy for the ones that refuse.
 *
 * Both text/plain and text/html are set because some editors prefer the HTML
 * variant and would otherwise paste escaped markup.
 */
function DragCard({
  icon,
  label,
  hint,
  text,
  html,
  disabled,
  busy,
  note,
}: {
  icon: string;
  label: string;
  hint: string;
  text: string;
  html?: string | undefined;
  disabled?: boolean;
  busy?: boolean;
  note?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const ready = Boolean(text) && !disabled;

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData('text/html', html ?? escapeHtml(text));
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
        <span className="text-2xl leading-none" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-zinc-200">{label}</div>
          <div className="text-[0.7rem] text-zinc-500">{hint}</div>
        </div>
      </div>

      <div
        draggable={ready}
        onDragStart={onDragStart}
        title={ready ? `Drag ${label} into any chat` : 'Nothing to drag yet'}
        className={`mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[0.7rem] text-zinc-400 ${
          ready ? 'cursor-grab active:cursor-grabbing' : 'opacity-50'
        }`}
      >
        {busy ? 'Generating…' : text ? text.slice(0, 600) : 'Nothing to drag yet.'}
        {text && text.length > 600 ? '\n…' : ''}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={copy}
          disabled={!ready}
          className="rounded border border-zinc-700 px-2 py-1 text-[0.7rem] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {copied ? 'copied ✓' : 'copy for a chat that blocks drag'}
        </button>
        <span className="text-[0.65rem] text-zinc-600">{note}</span>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Shown to signed-out visitors too — downloading the extension must never be
 * gated behind an account, and /api/extension-download serves a build artifact
 * of this repo rather than any user data.
 */
function DownloadCard({
  busy,
  msg,
  onDownload,
}: {
  busy: boolean;
  msg: string | null;
  onDownload: () => void;
}) {
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/extension-build');
        if (res.ok && alive) setBuild((await res.json()) as BuildStatus);
      } catch {
        /* status is advisory — the download still works without it */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rebuild = async () => {
    setRebuilding(true);
    setBuildMsg(null);
    try {
      const res = await fetch('/api/extension-build', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { status?: BuildStatus; error?: string } | null;
      if (!res.ok) {
        setBuildMsg(body?.error ?? `rebuild failed (${res.status})`);
        return;
      }
      if (body?.status) setBuild(body.status);
      setBuildMsg('Rebuilt — download again.');
    } catch (e) {
      setBuildMsg((e as Error).message);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h2 className="mb-1 font-semibold">Download the extension</h2>
      <p className="mb-4 text-xs text-zinc-400">
        One-click full-page capture (URL, live DOM, screenshot → clean readable text, embedded server-side) in an
        MV3 Chrome side panel. Unzip it, then load it at <code>chrome://extensions → Load unpacked</code>.
      </p>

      {build && build.stale && (
        <p className="mb-3 rounded border border-amber-700/60 bg-amber-950/40 p-2 text-[0.7rem] text-amber-300">
          ⚠ The extension source changed after the last build — this zip is old code.{' '}
          <button onClick={rebuild} disabled={rebuilding} className="underline hover:text-amber-200">
            {rebuilding ? 'rebuilding…' : 'Rebuild now'}
          </button>
        </p>
      )}
      {build && !build.stale && build.built && (
        <p className="mb-3 text-[0.65rem] text-zinc-600">up to date · {build.detail}</p>
      )}

      <button
        onClick={onDownload}
        disabled={busy}
        className="w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? 'Preparing…' : 'Download scimem-extension.zip'}
      </button>
      <div className="mt-2 flex gap-2">
        <button
          onClick={rebuild}
          disabled={rebuilding}
          className="flex-1 rounded border border-zinc-700 px-2 py-1.5 text-[0.7rem] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {rebuilding ? 'Rebuilding…' : 'Rebuild extension'}
        </button>
      </div>
      {buildMsg && <p className="mt-2 text-[0.7rem] text-emerald-400">{buildMsg}</p>}
      {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}
      <ul className="mt-4 space-y-1 text-[0.7rem] text-zinc-500">
        <li>· built from <code>.output/chrome-mv3</code> — no stale copy</li>
        <li>· reads the live DOM + screenshot from the active tab</li>
        <li>· chunks are embedded server-side, deduped by content hash</li>
        <li>· Ask returns only your project’s chunks, with [n] citations</li>
      </ul>
    </section>
  );
}

function DeleteProjectButton({
  project,
  onDeleted,
}: {
  project: { id: string; name: string; events: number; chunks: number };
  onDeleted: (name: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    const what = `${project.events} source(s) and ${project.chunks} chunk(s)`;
    if (!window.confirm(`Delete "${project.name}"?\n\nThis also deletes ${what}, plus its ask history. This cannot be undone.`))
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects?projectId=${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        cascaded?: { events: number; chunks: number };
      };
      if (!res.ok) {
        setMsg(body.error ?? `delete failed (${res.status})`);
        return;
      }
      setMsg(`deleted ${body.cascaded?.events ?? 0} source(s), ${body.cascaded?.chunks ?? 0} chunk(s)`);
      onDeleted(project.name);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          void remove();
        }}
        disabled={busy}
        title={`Delete ${project.name} and everything in it`}
        className="rounded border border-red-900 px-1.5 py-0.5 text-[0.65rem] text-red-400 hover:bg-red-950/50 disabled:opacity-50"
      >
        {busy ? '…' : 'delete'}
      </button>
      {msg && (
        <span className="text-[0.6rem] text-zinc-500" onClick={(e) => e.stopPropagation()}>
          {msg}
        </span>
      )}
    </span>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-emerald-300">{value.toLocaleString()}</div>
      <div className="mt-1 text-[0.7rem] text-zinc-500">{hint}</div>
    </div>
  );
}
