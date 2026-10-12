// frontend/app/routes/cp-console.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import Layout from '../components/layout';
import { getSession, commitSession } from '../lib/session.server';
import { fullAuthGuard } from '~/util/authGuard';
import { SECURITY_HEADERS } from '~/lib/security-headers.server';

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */
type Method = 'A' | 'B';
type Status = 'draft' | 'uat' | 'live';
type View = 'overview' | 'onboard' | 'manage';

type Cp = {
  id?: string;
  cpId?: string;
  method: Method;
  status?: Status;
  cpName: string;
  serviceName: string;
  serviceText?: string;
  price?: string;
  period?: string;
  trial?: number;
  banner?: string;
  support?: string;
  shortcode?: string;
  consent?: string;
  folder?: string;
  pages?: string[];
  updatedAt?: number | string;
};

type ZipCheck = { ok: boolean; warn?: boolean; message: ReactNode };

type PreviewResult = {
  previewId: string;
  previewBaseUrl?: string;
  folder?: string;
  fileCount?: number;
  pages: string[];
};

type OptionAForm = {
  cpName: string;
  serviceName: string;
  serviceText: string;
  price: string;
  period: string;
  trial: string;
  banner: string;
  support: string;
  shortcode: string;
  consent: string;
  folder: string;
};

const EMPTY_A: OptionAForm = {
  cpName: '',
  serviceName: '',
  serviceText: '',
  price: '',
  period: 'Day',
  trial: '0',
  banner: '',
  support: '',
  shortcode: '',
  consent: '',
  folder: 'demo-cp',
};

const DESIGN_STYLES = [
  { value: 'demo-cp', label: 'Casino / lotto — forest green & gold' },
  { value: 'demo-cp2', label: 'Music streaming — purple & pink' },
  { value: 'demo-cp3', label: 'Sports betting — navy & orange' },
  { value: 'demo-cp4', label: 'Movies / entertainment — black & red' },
  { value: 'demo-cp5', label: 'Wallet / fintech — teal & white' },
];

const VIEW_META: Record<View, { title: string; sub: string }> = {
  overview: { title: 'Overview', sub: 'All content providers and their onboarding status' },
  onboard: { title: 'Onboard a CP', sub: 'Choose Option A or Option B to bring a new provider online' },
  manage: { title: 'Manage CPs', sub: 'Update, promote, or remove content providers' },
};

/* ------------------------------------------------------------------ */
/* loader (same guard as service-zip)                                  */
/* ------------------------------------------------------------------ */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) return redirect('/login');

  const sessionCookie = await commitSession(session);
  return json(
    {
      userRole: session.get('role') || null,
      userEmail: session.get('email') || null,
    },
    { headers: { ...SECURITY_HEADERS, 'Set-Cookie': sessionCookie } },
  );
}

/* ------------------------------------------------------------------ */
/* api helpers                                                         */
/* ------------------------------------------------------------------ */
class ApiError extends Error {
  errors: string[];
  warnings: string[];
  constructor(message: string, errors: string[] = [], warnings: string[] = []) {
    super(message);
    this.errors = errors;
    this.warnings = warnings;
  }
}

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, init);
  const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
  if (!res.ok || !data.ok) {
    throw new ApiError(data.error || `Request failed: ${res.status}`, data.errors, data.warnings);
  }
  return data;
}

const apiGet = (path: string) => request(path);
const apiJson = (path: string, method: string, body: unknown) =>
  request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
const apiUpload = (path: string, form: FormData) => request(path, { method: 'POST', body: form });

const cpKey = (cp: Cp) => (cp.cpId || cp.id || '') as string;

/* ------------------------------------------------------------------ */
/* shared ui bits                                                      */
/* ------------------------------------------------------------------ */
const inputCls =
  'w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-800';
const btnDangerGhost =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-900 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-950/40';
const btnSm = '!px-3 !py-1.5 !text-xs !rounded-lg';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</label>
      {children}
      {hint && <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

function Card({ title, subtitle, right, children, flush }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className={flush ? '' : 'p-5 sm:p-7'}>{children}</div>
    </section>
  );
}

function MethodTag({ method }: { method: Method }) {
  const cls = method === 'A' ? 'bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>Option {method}</span>;
}

function StatusTag({ status }: { status?: Status }) {
  const map: Record<Status, string> = {
    live: 'bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
    uat: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  };
  const s = status || 'draft';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${map[s]}`}>{s}</span>;
}

function CheckRow({ check }: { check: ZipCheck }) {
  const cls = check.ok
    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200'
    : check.warn
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200';
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cls}`}>{check.ok ? '✓' : '!'}</span>
      <span className="break-words text-gray-600 dark:text-gray-300">{check.message}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */
export default function CpConsole() {
  const { userRole, userEmail } = useLoaderData<typeof loader>();

  const [view, setView] = useState<View>('overview');
  const [option, setOption] = useState<Method>('A');
  const [cps, setCps] = useState<Cp[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [updatingCp, setUpdatingCp] = useState<Cp | null>(null);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Cp | null>(null);

  // toast
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000);
  }, []);

  // option A
  const [formA, setFormA] = useState<OptionAForm>(EMPTY_A);
  const [savingA, setSavingA] = useState(false);

  // option B
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cpNameB, setCpNameB] = useState('');
  const [serviceNameB, setServiceNameB] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [checks, setChecks] = useState<ZipCheck[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedPage, setSelectedPage] = useState('index.html');
  const [busyB, setBusyB] = useState(false);
  const [dragging, setDragging] = useState(false);

  /* ---------- data ---------- */
  const refreshCps = useCallback(async () => {
    setListLoading(true);
    try {
      const j = await apiGet('/cps');
      setCps(j.items || []);
    } catch (e) {
      toast(`Could not load content providers: ${(e as Error).message}`);
      setCps([]);
    } finally {
      setListLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (view === 'overview' || view === 'manage') void refreshCps();
  }, [view, refreshCps]);

  const stats = useMemo(
    () => ({
      total: cps.length,
      live: cps.filter((c) => c.status === 'live').length,
      a: cps.filter((c) => c.method === 'A').length,
      b: cps.filter((c) => c.method === 'B').length,
    }),
    [cps],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cps.filter((c) => !q || (c.serviceName || '').toLowerCase().includes(q) || (c.cpName || '').toLowerCase().includes(q));
  }, [cps, search]);

  /* ---------- reset / update mode ---------- */
  const discardServerPreview = (id?: string) => {
    if (id) fetch(`/api/cps/preview/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  };

  const resetPreview = useCallback(() => {
    setPreview((p) => {
      discardServerPreview(p?.previewId);
      return null;
    });
    setSelectedPage('index.html');
  }, []);

  const resetForms = useCallback(() => {
    setFormA(EMPTY_A);
    setCpNameB('');
    setServiceNameB('');
    setZipFile(null);
    setChecks([]);
    resetPreview();
  }, [resetPreview]);

  const clearUpdate = () => setUpdatingCp(null);

  const goView = (v: View) => {
    if (updatingCp) {
      clearUpdate();
      resetForms();
    }
    setView(v);
  };

  const startUpdate = (cp: Cp) => {
    resetForms();
    setUpdatingCp(cp);
    setFormA({
      cpName: cp.cpName || '',
      serviceName: cp.serviceName || '',
      serviceText: cp.serviceText || '',
      price: cp.price || '',
      period: cp.period || 'Day',
      trial: String(cp.trial ?? 0),
      banner: cp.banner || '',
      support: cp.support || '',
      shortcode: cp.shortcode || '',
      consent: cp.consent || '',
      folder: cp.method === 'A' && cp.folder ? cp.folder : 'demo-cp',
    });
    setCpNameB(cp.cpName || '');
    setServiceNameB(cp.serviceName || '');
    setOption(cp.method === 'B' ? 'B' : 'A');
    setView('onboard');
    toast(`Updating ${cp.serviceName}: choose Option A or B`);
  };

  const cancelUpdate = () => {
    clearUpdate();
    resetForms();
    setView('manage');
    toast('Update cancelled');
  };

  /* ---------- option A ---------- */
  const setA = (k: keyof OptionAForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFormA((f) => ({ ...f, [k]: e.target.value }));

  const submitA = async () => {
    const cpName = formA.cpName.trim();
    const serviceName = formA.serviceName.trim();
    if (!cpName || !serviceName) return toast('CP name and service name are required');

    setSavingA(true);
    try {
      const payload = {
        cpName,
        serviceName,
        serviceText: formA.serviceText.trim(),
        price: formA.price.trim(),
        period: formA.period,
        trial: Number(formA.trial || 0),
        banner: formA.banner.trim(),
        support: formA.support.trim(),
        shortcode: formA.shortcode.trim(),
        consent: formA.consent.trim(),
        folder: formA.folder,
      };
      if (updatingCp) {
        // NOTE: backend PATCH allow-list must include "method" and "folder"
        await apiJson(`/cps/${encodeURIComponent(cpKey(updatingCp))}`, 'PATCH', { ...payload, method: 'A' });
        toast(updatingCp.method === 'B' ? 'Content provider switched to Option A' : 'Content provider updated');
      } else {
        await apiJson('/cps/option-a', 'POST', payload);
        toast('Content provider added');
      }
      clearUpdate();
      resetForms();
      setView('manage');
    } catch (e) {
      toast(`Could not save CP: ${(e as Error).message}`);
    } finally {
      setSavingA(false);
    }
  };

  /* ---------- option B ---------- */
  const handleFile = (file?: File) => {
    resetPreview();
    setChecks([]);
    setZipFile(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setChecks([{ ok: false, message: 'Please select a ZIP file (.zip).' }]);
      return;
    }
    if (file.size === 0) {
      setChecks([{ ok: false, message: 'The selected ZIP file is empty.' }]);
      return;
    }
    setZipFile(file);
    setChecks([
      { ok: true, message: `Selected ${file.name} (${(file.size / 1024).toFixed(1)} KB).` },
      { ok: true, message: 'Package structure and placeholders are checked on the server.' },
    ]);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const buildPreview = async () => {
    const cpName = cpNameB.trim();
    const serviceName = serviceNameB.trim();
    if (!cpName || !serviceName) return toast('CP name and service name are required');
    if (!zipFile) return toast('Choose a ZIP package first');

    setBusyB(true);
    resetPreview();
    setChecks((c) => c.filter((x) => x.ok));
    try {
      const fd = new FormData();
      fd.append('cpName', cpName);
      fd.append('serviceName', serviceName);
      fd.append('package', zipFile);
      if (updatingCp?.method === 'B' && updatingCp.folder) fd.append('folder', updatingCp.folder);

      const j = await apiUpload('/cps/option-b/preview', fd);
      const pages: string[] = j.pages?.length ? j.pages : ['index.html'];
      setPreview({
        previewId: j.previewId,
        previewBaseUrl: j.previewBaseUrl,
        folder: j.folder,
        fileCount: j.fileCount,
        pages,
      });
      setSelectedPage(pages[0]);
      setChecks((c) => [
        ...c,
        { ok: true, message: `Server validation passed · ${j.fileCount ?? '—'} files · folder ${j.folder}` },
        { ok: true, message: `Pages: ${pages.join(', ')}` },
        ...((j.warnings || []) as string[]).map((w) => ({ ok: false, warn: true, message: w })),
      ]);
      toast('Preview ready. Review before saving.');
    } catch (e) {
      const err = e as ApiError;
      if (err.errors?.length) {
        setChecks((c) => [
          ...c,
          { ok: false, message: <strong>Upload blocked — fix these in your ZIP and upload again:</strong> },
          ...err.errors.map((m) => ({ ok: false, message: m })),
          ...(err.warnings || []).map((m) => ({ ok: false, warn: true, message: m })),
        ]);
        toast(`Upload blocked: ${err.errors.length} problem(s) found`);
      } else {
        toast(`Preview failed: ${err.message}`);
      }
    } finally {
      setBusyB(false);
    }
  };

  const approveB = async () => {
    if (!preview) return toast('Build a preview first');
    setBusyB(true);
    try {
      const j = await apiJson('/cps/option-b/approve', 'POST', { previewId: preview.previewId });
      setPreview(null); // consumed on server
      const newId = j.item?.cpId || j.item?.id;
      if (updatingCp && newId && cpKey(updatingCp) !== newId) {
        // switched A -> B: drop old Option A row
        await fetch(`/api/cps/${encodeURIComponent(cpKey(updatingCp))}`, { method: 'DELETE' }).catch(() => {});
      }
      toast(updatingCp ? 'Update approved · saved' : 'Approved · saved');
      clearUpdate();
      resetForms();
      setView('manage');
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    } finally {
      setBusyB(false);
    }
  };

  const discardB = () => {
    resetPreview();
    toast('Preview discarded — nothing saved');
  };

  const previewUrl = preview ? `${preview.previewBaseUrl || `/api/cps/preview/${preview.previewId}/files/`}${encodeURIComponent(selectedPage)}` : '';

  /* ---------- manage actions ---------- */
  const updateStatus = async (cp: Cp, status: Status) => {
    try {
      const j = await apiJson(`/cps/${encodeURIComponent(cpKey(cp))}`, 'PATCH', { status });
      setCps((list) => list.map((c) => (cpKey(c) === cpKey(cp) ? { ...c, ...(j.item || { status }) } : c)));
      toast(`Status updated to ${status}`);
    } catch (e) {
      toast(`Could not update status: ${(e as Error).message}`);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await request(`/cps/${encodeURIComponent(cpKey(target))}`, { method: 'DELETE' });
      setCps((list) => list.filter((c) => cpKey(c) !== cpKey(target)));
      toast('Content provider removed');
    } catch (e) {
      toast(`Could not remove: ${(e as Error).message}`);
    }
  };

  const fmtDate = (v?: number | string) => (v ? new Date(v).toLocaleString() : '—');

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */
  const meta = view === 'onboard' && updatingCp
    ? { title: 'Update CP', sub: 'Choose Option A or Option B to update this provider' }
    : VIEW_META[view];

  const tabs: { id: View; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'onboard', label: 'Onboard a CP' },
    { id: 'manage', label: 'Manage CPs' },
  ];

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <main className="mx-auto max-w-7xl space-y-6 pb-8">
        {/* hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-800 via-teal-700 to-cyan-700 px-6 py-7 text-white shadow-lg sm:px-8">
          <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border-[36px] border-white/10" />
          <div className="pointer-events-none absolute -bottom-24 right-40 h-48 w-48 rounded-full bg-white/5" />
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-teal-50">
              CP ONBOARDING &amp; DEPLOYMENT
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{meta.title}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-teal-50 sm:text-base">{meta.sub}</p>
          </div>
        </section>

        {/* tabs */}
        <nav className="flex gap-6 border-b border-gray-200 dark:border-gray-800" aria-label="CP console sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => goView(t.id)}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition ${
                view === t.id
                  ? 'border-teal-600 text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* ================= OVERVIEW ================= */}
        {view === 'overview' && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { n: stats.total, l: 'Total CPs' },
                { n: stats.live, l: 'Live' },
                { n: stats.a, l: 'Option A (hosted)' },
                { n: stats.b, l: 'Option B (ZIP)' },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <div className="font-mono text-2xl font-bold text-gray-900 dark:text-white">{s.n}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{s.l}</div>
                </div>
              ))}
            </div>

            <Card
              flush
              title="Recently onboarded"
              subtitle="Newest content providers first"
              right={<button type="button" className={`${btnPrimary} ${btnSm}`} onClick={() => goView('onboard')}>Onboard a CP</button>}
            >
              {listLoading && !cps.length ? (
                <p className="p-8 text-center text-sm text-gray-500">Loading…</p>
              ) : !cps.length ? (
                <div className="px-5 py-12 text-center text-gray-500">
                  <p className="mb-1 text-base font-semibold text-gray-900 dark:text-white">No content providers yet</p>
                  <p className="text-sm">Onboard your first CP with Option A or Option B.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800">
                        <th className="px-5 py-3 font-semibold">CP</th>
                        <th className="px-5 py-3 font-semibold">Method</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 font-semibold">Folder / Pages</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {cps.slice(0, 6).map((cp) => (
                        <tr key={cpKey(cp)} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-gray-900 dark:text-white">{cp.serviceName}</div>
                            <div className="text-xs text-gray-500">{cp.cpName}</div>
                          </td>
                          <td className="px-5 py-3"><MethodTag method={cp.method} /></td>
                          <td className="px-5 py-3"><StatusTag status={cp.status} /></td>
                          <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                            {(cp.folder || '—') + (cp.pages?.length ? ` · ${cp.pages.join(', ')}` : '')}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button type="button" className={`${btnGhost} ${btnSm}`} onClick={() => startUpdate(cp)}>Update</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        {/* ================= ONBOARD / UPDATE ================= */}
        {view === 'onboard' && (
          <>
            {updatingCp && (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Updating "{updatingCp.serviceName}" (currently Option {updatingCp.method}
                  {updatingCp.folder ? ` · ${updatingCp.folder}` : ''}) — choose Option A or Option B below
                </span>
                <button type="button" className={`${btnGhost} ${btnSm}`} onClick={cancelUpdate}>Cancel update</button>
              </div>
            )}

            <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">
              {(['A', 'B'] as Method[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setOption(m)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    option === m ? 'bg-teal-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {m === 'A' ? 'A · mFilterIt-hosted page' : 'B · Partner ZIP upload'}
                </button>
              ))}
            </div>

            {/* ---- Option A ---- */}
            {option === 'A' && (
              <Card
                title="Service & branding details"
                subtitle="mFilterIt designs and hosts this landing page from the details below"
                right={<MethodTag method="A" />}
              >
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="CP name">
                      <input className={inputCls} value={formA.cpName} onChange={setA('cpName')} placeholder="e.g. PLAY2WIN Casino" />
                    </Field>
                    <Field label="Service name">
                      <input className={inputCls} value={formA.serviceName} onChange={setA('serviceName')} placeholder="Shown as the page title" />
                    </Field>
                  </div>
                  <Field label="Service description">
                    <textarea className={`${inputCls} min-h-[80px]`} value={formA.serviceText} onChange={setA('serviceText')} placeholder="One or two sentences describing the service" />
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Field label="Subscription price">
                      <input className={inputCls} value={formA.price} onChange={setA('price')} placeholder="e.g. 100" />
                    </Field>
                    <Field label="Billing period">
                      <select className={inputCls} value={formA.period} onChange={setA('period')}>
                        <option>Day</option>
                        <option>Week</option>
                        <option>Month</option>
                      </select>
                    </Field>
                    <Field label="Free trial (days)">
                      <input type="number" min={0} className={inputCls} value={formA.trial} onChange={setA('trial')} />
                    </Field>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Banner image URL">
                      <input type="url" className={inputCls} value={formA.banner} onChange={setA('banner')} placeholder="https://.../banner.jpg" />
                    </Field>
                    <Field label="Support email">
                      <input type="email" className={inputCls} value={formA.support} onChange={setA('support')} placeholder="support@cp.com" />
                    </Field>
                  </div>
                  <Field label="Short code">
                    <input className={inputCls} value={formA.shortcode} onChange={setA('shortcode')} placeholder="e.g. 20077" />
                  </Field>
                  <Field label="Consent text">
                    <textarea className={`${inputCls} min-h-[80px]`} value={formA.consent} onChange={setA('consent')} placeholder="Text shown near the subscribe button" />
                  </Field>
                  <Field label="Design style" hint="Maps to the compliance-approved template family this CP will render with">
                    <select className={inputCls} value={formA.folder} onChange={setA('folder')}>
                      {DESIGN_STYLES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="flex justify-end border-t border-gray-100 pt-5 dark:border-gray-800">
                    <button type="button" className={btnPrimary} disabled={savingA} onClick={submitA}>
                      {savingA ? 'Saving…' : updatingCp ? 'Save changes' : 'Add content provider'}
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {/* ---- Option B ---- */}
            {option === 'B' && (
              <>
                <Card
                  title="Partner design package"
                  subtitle="Upload a ZIP, preview the final page, then approve to save it"
                  right={<MethodTag method="B" />}
                >
                  <div className="space-y-6">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="CP name">
                        <input className={inputCls} value={cpNameB} onChange={(e) => setCpNameB(e.target.value)} placeholder="e.g. Streamly Media" />
                      </Field>
                      <Field label="Service name">
                        <input className={inputCls} value={serviceNameB} onChange={(e) => setServiceNameB(e.target.value)} placeholder="Shown in placeholder substitution" />
                      </Field>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Landing page ZIP</span>
                        <span className="text-xs text-gray-500">ZIP format only</span>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="Choose or drop a ZIP package"
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                        onDrop={onDrop}
                        className={`cursor-pointer rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-all ${
                          dragging
                            ? 'border-teal-600 bg-teal-50 ring-4 ring-teal-600/10 dark:bg-teal-950/50'
                            : zipFile
                              ? 'border-teal-300 bg-teal-50/50 hover:border-teal-500 dark:border-teal-800 dark:bg-teal-950/20'
                              : 'border-gray-300 bg-gray-50/80 hover:border-teal-500 hover:bg-teal-50/50 dark:border-gray-700 dark:bg-gray-950/60'
                        }`}
                      >
                        <p className="break-all text-sm font-semibold text-gray-900 dark:text-white">
                          {zipFile ? zipFile.name : 'Drop your ZIP file here'}
                        </p>
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                          {zipFile ? 'Package selected. Click to choose a different file.' : 'or click to browse files on your computer'}
                        </p>
                        <p className="mt-3 font-mono text-xs text-gray-400">index.html · styles/style.css · scripts/app.js · assets/</p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        className="hidden"
                        onChange={(e) => {
                          handleFile(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </div>

                    {checks.length > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60">
                        <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">Package checks</h3>
                        <div className="space-y-2.5">
                          {checks.map((c, i) => <CheckRow key={i} check={c} />)}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Nothing is saved until you approve the preview.</p>
                      <button type="button" className={btnPrimary} disabled={busyB || !zipFile} onClick={buildPreview}>
                        {busyB && !preview ? 'Building preview…' : updatingCp ? 'Build update preview' : 'Build preview'}
                      </button>
                    </div>
                  </div>
                </Card>

                {preview && (
                  <Card
                    title="Final page preview"
                    subtitle="What users will see (sample price/product values)."
                    right={
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btnGhost} onClick={discardB} disabled={busyB}>Discard</button>
                        <button type="button" className={btnPrimary} onClick={approveB} disabled={busyB}>
                          {busyB ? 'Saving…' : 'Approve & save'}
                        </button>
                      </div>
                    }
                  >
                    <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-gray-200 shadow-sm dark:border-gray-700">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Previewing</p>
                          <p className="mt-0.5 break-all text-sm font-medium text-gray-800 dark:text-gray-100">{selectedPage}</p>
                        </div>
                        <select
                          value={selectedPage}
                          onChange={(e) => setSelectedPage(e.target.value)}
                          aria-label="Select preview page"
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-teal-600 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                          {preview.pages.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <iframe
                        key={`${preview.previewId}-${selectedPage}`}
                        title="Landing page preview"
                        src={previewUrl}
                        sandbox="allow-scripts"
                        className="h-[720px] w-full border-0 bg-white"
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>{preview.fileCount ?? '—'} files validated</span>
                      <span>{preview.pages.length} page(s)</span>
                      {preview.folder && <span className="break-all">Folder: cp-packages/{preview.folder}/Standard/</span>}
                      <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-700 hover:underline dark:text-teal-300">
                        Open in new tab
                      </a>
                    </div>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* ================= MANAGE ================= */}
        {view === 'manage' && (
          <Card
            flush
            title="All content providers"
            subtitle="Update, promote, or remove content providers"
            right={
              <input
                className={`${inputCls} sm:!w-60`}
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            }
          >
            {!cps.length ? (
              <div className="px-5 py-12 text-center text-gray-500">
                <p className="mb-1 text-base font-semibold text-gray-900 dark:text-white">
                  {listLoading ? 'Loading…' : 'Nothing to manage yet'}
                </p>
                {!listLoading && <p className="text-sm">Onboarded content providers will appear here.</p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800">
                      <th className="px-5 py-3 font-semibold">CP</th>
                      <th className="px-5 py-3 font-semibold">Method</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Last updated</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((cp) => (
                      <tr key={cpKey(cp)} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-gray-900 dark:text-white">{cp.serviceName}</div>
                          <div className="text-xs text-gray-500">
                            {cp.cpName}
                            {cp.folder && <span className="ml-1 font-mono">· {cp.folder}</span>}
                          </div>
                        </td>
                        <td className="px-5 py-3"><MethodTag method={cp.method} /></td>
                        <td className="px-5 py-3">
                          <select
                            value={cp.status || 'draft'}
                            onChange={(e) => updateStatus(cp, e.target.value as Status)}
                            aria-label={`Status for ${cp.serviceName}`}
                            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-teal-600 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          >
                            <option value="draft">Draft</option>
                            <option value="uat">UAT</option>
                            <option value="live">Live</option>
                          </select>
                        </td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(cp.updatedAt)}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <button type="button" className={`${btnGhost} ${btnSm}`} onClick={() => startUpdate(cp)}>Update</button>
                            <button type="button" className={btnDangerGhost} onClick={() => setPendingDelete(cp)}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </main>

      {/* delete modal */}
      {pendingDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Remove this CP?</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              "{pendingDelete.serviceName}" will be deleted from the server. This can't be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={`${btnGhost} ${btnSm}`} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button type="button" className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700" onClick={confirmDelete}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl transition ${
          toastMsg ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        {toastMsg}
      </div>
    </Layout>
  );
}
