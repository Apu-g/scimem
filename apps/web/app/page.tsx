'use client';

import { useEffect, useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';

type User = { id: string; email?: string | undefined };
type SourceRow = { ref: string; id: string; similarity: number | null; snippet: string };

interface CaptureRes {
  ok: boolean;
  duplicate?: boolean;
  event_id?: string;
  chunks?: number;
  dim?: number;
  model?: string;
  latency_ms?: number;
  error?: string;
}

interface AskRes {
  ok: boolean;
  answer: string | null;
  note?: string;
  sources: SourceRow[];
  model?: string;
  reranked?: boolean;
  latency_ms?: number;
  error?: string;
}

export default function Home() {
  const [session, setSession] = useState<'loading' | 'anon' | 'user'>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  const [captureText, setCaptureText] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerNote, setAnswerNote] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [askMeta, setAskMeta] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    browserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!alive) return;
        if (data.session?.user) {
          setUser({ id: data.session.user.id, email: data.session.user.email });
          setSession('user');
        } else setSession('anon');
      })
      .catch(() => setSession('anon'));
    return () => {
      alive = false;
    };
  }, []);

  const refreshSession = async () => {
    const { data } = await browserSupabase().auth.getSession();
    return data.session;
  };

  const doAuth = async (mode: 'signin' | 'signup') => {
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      const supabase = browserSupabase();
      const res =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (res.error) {
        setAuthMsg(`Error: ${res.error.message}`);
        return;
      }
      const session = await refreshSession();
      if (session) {
        setUser({ id: session.user.id, email: session.user.email });
        setSession('user');
      } else {
        setAuthMsg(
          mode === 'signup'
            ? 'Account created — check your inbox to confirm the email, then sign in. (Prototype tip: in Supabase Dashboard → Auth → Providers → Email, turn OFF "Confirm email" for instant sign-ups.)'
            : 'Sign-in sent — check your inbox.',
        );
      }
    } catch (e) {
      setAuthMsg(`Unexpected error: ${(e as Error).message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    await browserSupabase().auth.signOut();
    setSession('anon');
    setUser(null);
    setAnswer(null);
    setSources([]);
  };

  const capture = async () => {
    const text = captureText.trim();
    if (!text) return;
    setCaptureBusy(true);
    setCaptureMsg(null);
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = (await res.json()) as CaptureRes;
      if (!res.ok || !data.ok) {
        setCaptureMsg(`Capture failed: ${data.error ?? res.status}`);
        return;
      }
      setCaptureMsg(
        data.duplicate
          ? `Duplicate — already captured (${(data.latency_ms ?? 0).toFixed(0)} ms)`
          : `Captured ✓ ${data.chunks ?? 1} chunk(s) · dim ${data.dim ?? '?'} · ${((data.latency_ms ?? 0) / 1000).toFixed(1)}s · ${data.model ?? ''}`,
      );
    } catch (e) {
      setCaptureMsg(`Network error: ${(e as Error).message}`);
    } finally {
      setCaptureBusy(false);
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setAskBusy(true);
    setAnswerNote(null);
    setSources([]);
    setAskMeta(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as AskRes;
      if (!res.ok || !data.ok) {
        setAnswerNote(`Ask failed: ${data.error ?? res.status}`);
        return;
      }
      setAnswer(data.answer);
      setAnswerNote(data.note ?? null);
      setSources(data.sources ?? []);
      setAskMeta(
        `${(data.latency_ms ?? 0) / 1000}s · ${data.model ?? ''}${data.reranked ? ' · reranked ✓' : ' · vector order'}`,
      );
    } catch (e) {
      setAnswerNote(`Network error: ${(e as Error).message}`);
    } finally {
      setAskBusy(false);
    }
  };

  const renderAnswer = (text: string | null) => {
    if (!text) return null;
    // inlines [n] refs into styled chips
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) =>
      /^\[\d+\]$/.test(part) ? (
        <span key={i} data-ref={part}>
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SCIMEM <span className="text-emerald-400">prototype</span>
          </h1>
          <p className="text-sm text-zinc-400">capture → embed → retrieve → cited answer</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          {session === 'user' && <span className="truncate">{user?.email}</span>}
          {session === 'user' && (
            <button onClick={signOut} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800">
              sign out
            </button>
          )}
        </div>
      </header>

      {session === 'loading' && <p className="text-zinc-500">Loading…</p>}

      {session === 'anon' && (
        <section className="mx-auto mt-16 max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-1 font-semibold">Sign in to the playground</h2>
          <p className="mb-4 text-xs text-zinc-400">
            Password auth via Supabase. New account? Use <code>sign up</code>.
          </p>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void doAuth('signin');
            }}
          >
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <input
              type="password"
              required
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            {authMsg && <p className="text-xs text-amber-400">{authMsg}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={authBusy}
                className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {authBusy ? '…' : 'Sign in'}
              </button>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void doAuth('signup')}
                className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
              >
                Sign up
              </button>
            </div>
          </form>
        </section>
      )}

      {session === 'user' && (
        <div className="flex flex-col gap-8">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-1 font-semibold">1 · Capture a memory</h2>
            <p className="mb-3 text-xs text-zinc-400">
              Paste a paragraph from a chat, doc, or web page. It gets chunked, embedded (2048-dim), and stored under your
              project — deduped by content hash.
            </p>
            <textarea
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              rows={5}
              placeholder="e.g. Decision: the SCIMEM embed model is nvidia/nemotron-3-embed-1b with dimension 2048, and it requires an input_type of query vs passage…"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={capture}
                disabled={captureBusy || !captureText.trim()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {captureBusy ? 'Embedding…' : 'Capture'}
              </button>
              {captureMsg && <span className="text-xs text-zinc-400">{captureMsg}</span>}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-1 font-semibold">2 · Ask with citations</h2>
            <p className="mb-3 text-xs text-zinc-400">
              Your question is embedded, matched against your chunks (pgvector), optionally reranked, then answered with
              inline [n] citations pointing at the evidence.
            </p>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void ask()}
                placeholder="What embedding dimension and input types does SCIMEM use?"
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <button
                onClick={ask}
                disabled={askBusy || !question.trim()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {askBusy ? 'Retrieving…' : 'Ask'}
              </button>
            </div>
            {askMeta && <p className="mt-3 text-xs text-zinc-500">{askMeta}</p>}
            {answerNote && <p className="mt-3 text-xs text-amber-400">{answerNote}</p>}
            {answer && (
              <div className="answer mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {renderAnswer(answer)}
              </div>
            )}
            {sources.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-zinc-400">
                  {sources.length} source chunk(s) used
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {sources.map((s) => (
                    <li key={s.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5 text-xs">
                      <div className="mb-1 flex justify-between text-zinc-500">
                        <span>
                          {s.ref} {s.id.slice(0, 8)}…
                        </span>
                        <span>sim {s.similarity?.toFixed(3) ?? '—'}</span>
                      </div>
                      <p className="text-zinc-300">{s.snippet}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>
      )}

      <footer className="mt-16 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        embed nvidia/nemotron-3-embed-1b · 2048d · groq openai/gpt-oss-20b · openrouter anthropic/claude-sonnet-5 · pgvector hnsw
        (halfvec) + RLS isolation verified
      </footer>
    </main>
  );
}