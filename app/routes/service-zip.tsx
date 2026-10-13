// frontend/app/routes/service-zip.tsx   (REPLACES existing file)
// Partner ZIP Upload  ->  Tab 1: Upload (validate, preview, approve)  |  Tab 2: Manage (all services with custom UI)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import Layout from '../components/layout';
import { getSession, commitSession } from '../lib/session.server';
import { fullAuthGuard } from '~/util/authGuard';
import { SECURITY_HEADERS } from '~/lib/security-headers.server';

type Tab = 'upload' | 'manage';
type Status = 'draft' | 'uat' | 'live';

type ZipCheck = { ok: boolean; warn?: boolean; message: string };

type ServiceOption = { serviceId: string; serviceName: string; cpName: string };

type PreviewResult = {
  previewId: string;
  previewBaseUrl?: string;
  folder?: string;
  fileCount?: number;
  pages: string[];
};

type CustomService = {
  id?: string;
  cpId?: string;
  serviceId?: string;
  method: 'A' | 'B';
  status?: Status;
  cpName: string;
  serviceName: string;
  folder?: string;
  pages?: string[];
  updatedAt?: number | string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) return redirect('/login');

  const sessionCookie = await commitSession(session);
  return json(
    { userRole: session.get('role') || null, userEmail: session.get('email') || null },
    { headers: { ...SECURITY_HEADERS, 'Set-Cookie': sessionCookie } },
  );
}

class ApiError extends Error {
  errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.errors = errors;
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, init);
  const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
  if (!res.ok || !data.ok) throw new ApiError(data.error || `Request failed: ${res.status}`, data.errors);
  return data;
}

const keyOf = (s: CustomService) => (s.cpId || s.id || '') as string;
const fmtDate = (v?: number | string) => (v ? new Date(v).toLocaleString() : '—');

const btnPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost =
  'inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
const btnSmGhost =
  'inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
const btnSmDanger =
  'inline-flex items-center justify-center rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40';

export default function ServiceZip() {
  const { userRole, userEmail } = useLoaderData<typeof loader>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('upload');

  // ---- upload tab ----
  const [serviceId, setServiceId] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [checks, setChecks] = useState<ZipCheck[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedPage, setSelectedPage] = useState('index.html');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reuploadOf, setReuploadOf] = useState<CustomService | null>(null);

  // ---- service id dropdown (from DynamoDB glo-nigeria-dev-serviceId-details) ----
  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState('');

  // ---- manage tab ----
  const [items, setItems] = useState<CustomService[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CustomService | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000);
  }, []);

  /* ---------------- service ids from DynamoDB ---------------- */
  const loadOptions = useCallback(async (refresh = false) => {
    setOptionsLoading(true);
    setOptionsError('');
    try {
      const j = await api(`/cp-service-ids${refresh ? '?refresh=1' : ''}`);
      setOptions((j.items || []) as ServiceOption[]);
    } catch (e) {
      setOptionsError((e as Error).message);
      setOptions([]);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const selectedOption = useMemo(() => options.find((o) => o.serviceId === serviceId.trim()), [options, serviceId]);

  const filteredOptions = useMemo(() => {
    const q = comboQuery.trim().toLowerCase();
    return options.filter(
      (o) => !q || o.serviceId.toLowerCase().includes(q) || o.serviceName.toLowerCase().includes(q) || o.cpName.toLowerCase().includes(q),
    );
  }, [options, comboQuery]);

  /* ---------------- manage: load list ---------------- */
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const j = await api('/cps');
      // only services that have a custom ZIP UI (Option B)
      setItems(((j.items || []) as CustomService[]).filter((c) => c.method === 'B'));
    } catch (e) {
      setListError((e as Error).message);
      setItems([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'manage') void loadList();
  }, [tab, loadList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (s) => !q || s.serviceId?.toLowerCase().includes(q) || s.serviceName?.toLowerCase().includes(q) || s.cpName?.toLowerCase().includes(q) || s.folder?.toLowerCase().includes(q),
    );
  }, [items, search]);

  const updateStatus = async (s: CustomService, status: Status) => {
    try {
      const j = await api(`/cps/${encodeURIComponent(keyOf(s))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setItems((list) => list.map((x) => (keyOf(x) === keyOf(s) ? { ...x, ...(j.item || { status }) } : x)));
      toast(`Status updated to ${status}`);
    } catch (e) {
      toast(`Could not update status: ${(e as Error).message}`);
      void loadList();
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await api(`/cps/${encodeURIComponent(keyOf(target))}`, { method: 'DELETE' });
      setItems((list) => list.filter((x) => keyOf(x) !== keyOf(target)));
      toast('Service UI removed');
    } catch (e) {
      toast(`Could not remove: ${(e as Error).message}`);
    }
  };

  /* ---------------- upload helpers ---------------- */
  const discardServer = (id?: string) => {
    if (id) fetch(`/api/cps/preview/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  };

  const resetPreview = () => {
    discardServer(preview?.previewId);
    setPreview(null);
    setSelectedPage('index.html');
  };

  const resetUploadForm = () => {
    resetPreview();
    setServiceId('');
    setZipFile(null);
    setChecks([]);
    setReuploadOf(null);
  };

  const startReupload = (s: CustomService) => {
    resetUploadForm();
    setReuploadOf(s);
    setServiceId(s.serviceId || s.serviceName || '');
    setMessage('');
    setTab('upload');
  };

  const handleFile = (file?: File) => {
    resetPreview();
    setMessage('');
    setChecks([]);
    setZipFile(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) return setChecks([{ ok: false, message: 'Please select a ZIP file (.zip).' }]);
    if (file.size === 0) return setChecks([{ ok: false, message: 'The selected ZIP file is empty.' }]);
    setZipFile(file);
    setChecks([
      { ok: true, message: `Selected ${file.name} (${(file.size / 1024).toFixed(1)} KB).` },
      { ok: true, message: 'ZIP type and size checked. Package structure is checked on the server.' },
    ]);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const buildPreview = async () => {
    if (!serviceId.trim()) return setMessage('Service ID is required.');
    if (!reuploadOf && !selectedOption) return setMessage('Select a Service ID from the list.');
    if (!zipFile) return setMessage('Choose a ZIP package before building the preview.');

    setLoading(true);
    setMessage('');
    resetPreview();
    setChecks((c) => c.filter((x) => x.ok));
    try {
      const fd = new FormData();
      fd.append('serviceId', serviceId.trim());
      fd.append('package', zipFile);
      if (reuploadOf?.folder) fd.append('folder', reuploadOf.folder); // replace same package

      const j = await api('/cps/option-b/preview', { method: 'POST', body: fd });
      const pages: string[] = j.pages?.length ? j.pages : ['index.html'];
      setPreview({ previewId: j.previewId, previewBaseUrl: j.previewBaseUrl, folder: j.folder, fileCount: j.fileCount, pages });
      setSelectedPage(pages[0]);
      setChecks((c) => [
        ...c,
        { ok: true, message: `Server validation passed: ${j.fileCount ?? '—'} files checked.` },
        { ok: true, message: `Pages found: ${pages.join(', ')}` },
        ...((j.warnings || []) as string[]).map((w) => ({ ok: false, warn: true, message: `Warning: ${w}` })),
      ]);
      setMessage('Preview is ready. Review the page below before saving.');
    } catch (e) {
      const err = e as ApiError;
      if (err.errors?.length) setChecks((c) => [...c, ...err.errors.map((m) => ({ ok: false, message: m }))]);
      setMessage(err.message || 'Preview failed.');
    } finally {
      setLoading(false);
    }
  };

  const approveAndSave = async () => {
    if (!preview) return setMessage('Build a preview before saving.');
    setLoading(true);
    setMessage('');
    try {
      await api('/cps/option-b/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      setPreview(null); // consumed on server
      resetUploadForm();
      toast('ZIP package approved and saved');
      setTab('manage');
    } catch (e) {
      setMessage((e as Error).message || 'Saving failed.');
    } finally {
      setLoading(false);
    }
  };

  const discardPreview = () => {
    resetPreview();
    setMessage('Preview discarded. Nothing was saved.');
  };

  const previewUrl = preview
    ? `${preview.previewBaseUrl || `/api/cps/preview/${preview.previewId}/files/`}${encodeURIComponent(selectedPage)}?t=${preview.previewId}`
    : '';

  const isError = /failed|could not|required|select|empty|error|expired/i.test(message);

  /* ---------------- render ---------------- */
  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <main className="mx-auto max-w-7xl space-y-6 pb-8">
        {/* hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-800 via-teal-700 to-cyan-700 px-6 py-7 text-white shadow-lg sm:px-8">
          <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border-[36px] border-white/10" />
          <div className="pointer-events-none absolute -bottom-24 right-40 h-48 w-48 rounded-full bg-white/5" />
          <div className="relative max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Partner ZIP Upload</h1>
            <p className="mt-2 text-sm leading-6 text-teal-50 sm:text-base">
              Upload a custom landing-page ZIP for a service, preview it, and manage every service that uses a custom UI.
            </p>
          </div>
        </section>

        {/* tabs */}
        <nav className="flex gap-6 border-b border-gray-200 dark:border-gray-800" aria-label="Partner ZIP sections">
          {([
            { id: 'upload', label: reuploadOf ? 'Re-upload' : 'Upload' },
            { id: 'manage', label: `Manage${items.length ? ` (${items.length})` : ''}` },
          ] as { id: Tab; label: string }[]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition ${
                tab === t.id
                  ? 'border-teal-600 text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* ================= TAB 1: UPLOAD ================= */}
        {tab === 'upload' && (
          <>
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-5 dark:border-gray-800 sm:px-7">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Package details</h2>
              </div>

              <div className="space-y-7 p-5 sm:p-7">
                {reuploadOf && (
                  <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                    <span>Re-uploading "{reuploadOf.serviceName}" — the new ZIP replaces package folder {reuploadOf.folder}</span>
                    <button type="button" className={btnSmGhost} onClick={resetUploadForm}>Cancel</button>
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="serviceId" className="block text-sm font-semibold text-gray-800 dark:text-gray-200">
                      Service ID <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void loadOptions(true)}
                      disabled={optionsLoading}
                      className="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300"
                    >
                      {optionsLoading ? 'Loading…' : 'Reload list'}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="serviceId"
                      type="text"
                      role="combobox"
                      aria-expanded={comboOpen}
                      aria-controls="serviceIdList"
                      value={comboOpen ? comboQuery : serviceId}
                      disabled={!!reuploadOf}
                      onFocus={() => { setComboQuery(''); setComboOpen(true); }}
                      onBlur={() => setComboOpen(false)}
                      onChange={(e) => { setComboQuery(e.target.value); setComboOpen(true); }}
                      placeholder={optionsLoading ? 'Loading service IDs…' : 'Search and select a Service ID'}
                      autoComplete="off"
                      className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-gray-900"
                    />
                    {comboOpen && !reuploadOf && (
                      <ul
                        id="serviceIdList"
                        role="listbox"
                        className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                      >
                        {filteredOptions.slice(0, 100).map((o) => (
                          <li key={o.serviceId} role="option" aria-selected={o.serviceId === serviceId}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault(); // keep input focus so onBlur does not close before click
                                setServiceId(o.serviceId);
                                setComboOpen(false);
                              }}
                              className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-gray-800 ${
                                o.serviceId === serviceId ? 'bg-teal-50 dark:bg-gray-800' : ''
                              }`}
                            >
                              <span className="font-mono text-gray-900 dark:text-white">{o.serviceId}</span>
                              <span className="truncate text-xs text-gray-500">{[o.serviceName, o.cpName].filter(Boolean).join(' · ')}</span>
                            </button>
                          </li>
                        ))}
                        {!filteredOptions.length && (
                          <li className="px-4 py-3 text-sm text-gray-500">{optionsLoading ? 'Loading…' : 'No matching Service ID'}</li>
                        )}
                        {filteredOptions.length > 100 && (
                          <li className="px-4 py-2 text-xs text-gray-400">Showing first 100 — type to narrow down</li>
                        )}
                      </ul>
                    )}
                  </div>
                  {optionsError ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">Could not load Service IDs: {optionsError}</p>
                  ) : selectedOption ? (
                    <p className="mt-2 text-xs text-teal-700 dark:text-teal-300">
                      {[selectedOption.serviceName, selectedOption.cpName].filter(Boolean).join(' · ') || 'Service found'}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {options.length ? `${options.length} service IDs loaded. ` : ''}The package will be associated exclusively with this Service ID.
                    </p>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      Custom ZIP package <span className="text-rose-500">*</span>
                    </label>
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
                    onDrop={handleDrop}
                    className={`cursor-pointer rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-all sm:px-8 ${
                      dragging
                        ? 'border-teal-600 bg-teal-50 ring-4 ring-teal-600/10 dark:bg-teal-950/50'
                        : zipFile
                          ? 'border-teal-300 bg-teal-50/50 hover:border-teal-500 dark:border-teal-800 dark:bg-teal-950/20'
                          : 'border-gray-300 bg-gray-50/80 hover:border-teal-500 hover:bg-teal-50/50 dark:border-gray-700 dark:bg-gray-950/60'
                    }`}
                  >
                    <p className="break-all text-sm font-semibold text-gray-900 dark:text-white">{zipFile ? zipFile.name : 'Drop your ZIP file here'}</p>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {zipFile ? 'Your package is selected. Click to choose a different file.' : 'or click to browse files on your computer'}
                    </p>
                    {zipFile && (
                      <p className="mt-3 inline-flex rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">
                        {(zipFile.size / 1024).toFixed(1)} KB selected
                      </p>
                    )}
                    {!zipFile && <p className="mt-4 font-mono text-xs text-gray-400">index.html · styles/style.css · scripts/app.js · assets/</p>}
                  </div>
                  <input ref={fileInputRef} type="file" accept=".zip,application/zip" onChange={handleFileChange} className="hidden" />
                </div>

                {checks.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60">
                    <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">Package checks</h3>
                    <div className="space-y-2.5">
                      {checks.map((c, i) => (
                        <div key={`${i}-${c.message}`} className="flex items-start gap-2.5 text-sm">
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              c.ok
                                ? 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200'
                                : c.warn
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
                                  : 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200'
                            }`}
                          >
                            {c.ok ? '✓' : '!'}
                          </span>
                          <span className="break-words text-gray-600 dark:text-gray-300">{c.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {message && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`rounded-xl border px-4 py-3 text-sm ${
                      isError
                        ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
                        : 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200'
                    }`}
                  >
                    {message}
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-xl text-xs text-gray-500 dark:text-gray-400">Your ZIP will not be saved until you review the preview and approve it.</p>
                  <button type="button" onClick={buildPreview} disabled={loading || !zipFile} className={btnPrimary}>
                    {loading && !preview ? 'Processing...' : 'Validate & preview'}
                  </button>
                </div>
              </div>
            </section>

            {preview && (
              <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">Landing page preview</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review the rendered page before approving the package.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={discardPreview} disabled={loading} className={btnGhost}>Discard preview</button>
                    <button type="button" onClick={approveAndSave} disabled={loading} className={`${btnPrimary} !min-h-0 !px-4 !py-2.5`}>
                      {loading ? 'Saving...' : 'Approve & save'}
                    </button>
                  </div>
                </div>
                <div className="p-4 sm:p-7">
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
                    <span>{preview.pages.length} page(s) found</span>
                    {preview.folder && <span className="break-all">Package folder: {preview.folder}</span>}
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* ================= TAB 2: MANAGE ================= */}
        {tab === 'manage' && (
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Services with custom UI</h2>
              </div>
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search service / folder…"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white sm:w-60"
                />
                <button type="button" className={btnGhost} onClick={() => void loadList()} disabled={listLoading}>
                  {listLoading ? '…' : 'Refresh'}
                </button>
              </div>
            </div>

            {listError ? (
              <div className="px-5 py-10 text-center text-sm text-rose-700 dark:text-rose-300">Could not load services: {listError}</div>
            ) : !items.length ? (
              <div className="px-5 py-12 text-center text-gray-500">
                <p className="mb-1 text-base font-semibold text-gray-900 dark:text-white">{listLoading ? 'Loading…' : 'No custom UI services yet'}</p>
                {!listLoading && (
                  <p className="text-sm">
                    Upload a ZIP in the{' '}
                    <button type="button" className="font-semibold text-teal-700 underline dark:text-teal-300" onClick={() => setTab('upload')}>Upload</button>{' '}
                    tab.
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800">
                      <th className="px-5 py-3 font-semibold">Service ID</th>
                      <th className="px-5 py-3 font-semibold">Package folder</th>
                      <th className="px-5 py-3 font-semibold">Pages</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Last updated</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={keyOf(s)} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-gray-900 dark:text-white">{s.serviceId || s.serviceName}</div>
                          {(s.serviceName && s.serviceName !== (s.serviceId || s.serviceName)) || s.cpName ? (
                            <div className="text-xs text-gray-500">{[s.serviceName !== s.serviceId ? s.serviceName : '', s.cpName].filter(Boolean).join(' · ')}</div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{s.folder || '—'}</td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{s.pages?.length ? s.pages.join(', ') : '—'}</td>
                        <td className="px-5 py-3">
                          <select
                            value={s.status || 'draft'}
                            onChange={(e) => updateStatus(s, e.target.value as Status)}
                            aria-label={`Status for ${s.serviceName}`}
                            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-teal-600 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          >
                            <option value="draft">Draft</option>
                            <option value="uat">UAT</option>
                            <option value="live">Live</option>
                          </select>
                        </td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(s.updatedAt)}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <button type="button" className={btnSmGhost} onClick={() => startReupload(s)}>Re-upload</button>
                            <button type="button" className={btnSmDanger} onClick={() => setPendingDelete(s)}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* delete modal */}
      {pendingDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Remove this custom UI?</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              "{pendingDelete.serviceName}" and its uploaded package ({pendingDelete.folder}) will be deleted from S3 and the database. This can't be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={btnSmGhost} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button type="button" className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700" onClick={confirmDelete}>Remove</button>
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