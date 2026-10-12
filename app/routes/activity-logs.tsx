import { DYNAMODB_TABLES } from '~/lib/config';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import Layout from '../components/layout';
import { getSession } from '../lib/session.server';
import { authGuard } from '~/util/authGuard';
import {getDashboardLogs } from '../lib/dynamodb-log';
import { useState, useEffect, useMemo } from 'react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

type LogEntry = {
  dbDate: string;
  tstamp: number;
  action: string;
  ipAddress: string;
  payload: Record<string, any>;
  tablename: string;
  email: string;
};


export async function loader({ request }: LoaderFunctionArgs) {
  const isAuthenticated = await authGuard(request);
  if (!isAuthenticated) return redirect('/login?message=login%20required');

  const session = await getSession(request);
  const userRole = session.get('role') || null;
  const userEmail = session.get('email') || null;

  if (userRole !== 'admin') return redirect('/?message=access%20denied');


  const logs = await getDashboardLogs();
  const sorted = [...logs].sort((a, b) => b.tstamp - a.tstamp);

  return json({ logs: sorted, userRole, userEmail });
}

function formatDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDbDate(raw: string) {
  if (!raw || raw.length !== 8) return raw ?? '—';
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

const ACTION_COLORS: Record<string, string> = {
  LOGIN:                        'bg-purple-100 text-purple-800 border-purple-200',
  LOGOUT:                       'bg-gray-100   text-gray-700   border-gray-200',
  CREATE_CP:                    'bg-emerald-100 text-emerald-800 border-emerald-200',
  UPDATE_CP:                    'bg-blue-100   text-blue-800   border-blue-200',
  CREATE_SERVICE_ID:            'bg-emerald-100 text-emerald-800 border-emerald-200',
  UPDATE_SERVICE_ID:            'bg-blue-100   text-blue-800   border-blue-200',
  CREATE_SERVICE_PRODUCT:       'bg-emerald-100 text-emerald-800 border-emerald-200',
  UPDATE_SERVICE_PRODUCT:       'bg-blue-100   text-blue-800   border-blue-200',
  APPROVE_SERVICE_PRODUCT:      'bg-green-100  text-green-800  border-green-200',
  REJECT_SERVICE_PRODUCT:       'bg-red-100    text-red-800    border-red-200',
  APPROVE_BULK_SERVICE_PRODUCT: 'bg-green-100  text-green-800  border-green-200',
  REJECT_BULK_SERVICE_PRODUCT:  'bg-red-100    text-red-800    border-red-200',
  SUSPEND_SERVICE_PRODUCT:      'bg-orange-100 text-orange-800 border-orange-200',
  RESUME_SERVICE_PRODUCT:       'bg-teal-100   text-teal-800   border-teal-200',
};

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap ${cls}`}>
      {action.replace(/_/g, ' ')}
    </span>
  );
}

const TABLE_LABELS: Record<string, string> = {
  'mtn-nigeria-prod-cp-details':       'CP Details',
  'mtn-nigeria-prod-cp-products':      'Service Descriptions',
  'mtn-nigeria-prod-serviceId-details':      'Service IDs',
'mtn-nigeria-prod-dashboard-logins': 'Dashboard Logins',
//   'mtn-nigeria-prod-dashboard-logs':   'Dashboard Logs',
};

function uniqueValues(logs: LogEntry[], key: keyof LogEntry): string[] {
  return Array.from(new Set(logs.map((l) => String(l[key] ?? '')))).filter(Boolean).sort();
}

function PayloadDialog({ payload, action }: { payload: Record<string, any>; action: string }) {
  const [open, setOpen] = useState(false);
  //const [s3Data, setS3Data] = useState(null);
  type S3VersionData = {
  previousVersion: string;
  latestVersion: string;
  previousData: Record<string, any>;
  latestData: Record<string, any>;
};

const [s3Data, setS3Data] = useState<S3VersionData | null>(null);
const [loading, setLoading] = useState(false);
function getDiff(prev: any, curr: any) {
  if (!prev || !curr) return [];

  const keys = new Set([
    ...Object.keys(prev),
    ...Object.keys(curr),
  ]);

  const changes: any[] = [];

  keys.forEach((key) => {
    const oldVal = prev[key];
    const newVal = curr[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ key, oldVal, newVal });
    }
  });

  return changes;
}
  const entries = Object.entries(payload ?? {});
const hiddenFields = ['password', 'isLive'];
const handleOpen = async () => {
  setOpen(true);
  const UPDATE_ACTIONS = ['UPDATE_CP', 'UPDATE_SERVICE_ID', 'UPDATE_SERVICE_PRODUCT'];
if (!UPDATE_ACTIONS.includes(action)) {
  setLoading(false);
  return;
}
  setLoading(true);

  try {
    const res = await fetch("/api/s3-version", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload }),
    });

    const data = await res.json();
    setS3Data(data);
  } catch (err) {
    console.error("S3 fetch error:", err);
  } finally {
    setLoading(false);
  }
};

const filteredEntries = Object.entries(payload ?? {})
  .filter(([key]) => !hiddenFields.includes(key))
  .sort(([a], [b]) => {
    if (a === 'version') return -1; // version comes first
    if (b === 'version') return 1;
    return 0;
  });
  return (
    <>
      <button
        type="button"
       onClick={handleOpen}
        title="View payload"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-bold transition-colors select-none"
      >
        i
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto p-0">
        
        {/* ── Header ── */}
        <div className="flex items-center justify-between pt-8 px-5 py-4 border-b border-gray-100">
          <div>
            <DialogTitle className="text-[15px] font-medium text-gray-900 m-0">
              Change details
            </DialogTitle>
            {/* <p className="text-xs text-gray-500 mt-0.5">Version history comparison</p> */}
          </div>

          {/* Version badges — only when s3Data available */}
          <br />
          {s3Data && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                {s3Data.previousVersion ?? '—'}
              </span>
              <span className="text-xs text-gray-400">→</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-green-50 text-green-600 border border-green-200">
                {s3Data.latestVersion ?? '—'}
              </span>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-4">

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading version history...
            </div>
          )}
          {!loading && !s3Data && (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 overflow-hidden">
              {Object.entries(payload ?? {})
                .filter(([key]) => !['password', 'isLive'].includes(key))
                .map(([key, val]) => (
                  <div key={key} className="flex items-start gap-3 px-3 py-2.5 bg-white hover:bg-gray-50 min-w-0">
                    <span className="font-mono text-[11px] text-gray-500 w-50 shrink-0 pt-0.5 ">{key}</span>
<span className="text-[11px] text-gray-400 shrink-0">:</span>
<span className="text-xs text-gray-800 break-all flex-1">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* Diff table */}
          {!loading && s3Data && (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_16px_1fr] bg-gray-50 px-3 py-2 border-b border-gray-100">
                <span className="text-[11px] font-medium text-gray-500">Field</span>
                <span className="text-[11px] font-medium text-gray-500">Old value</span>
                <span />
                <span className="text-[11px] font-medium text-gray-500">New value</span>
              </div>

              {getDiff(s3Data.previousData, s3Data.latestData).length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No changes found between versions.</p>
              ) : (
                getDiff(s3Data.previousData, s3Data.latestData).map(({ key, oldVal, newVal }) => (
                  <div
                    key={key}
                    className="grid grid-cols-[1fr_1fr_16px_1fr] px-3 py-2.5 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50"
                  >
                    <span className="font-mono text-[11px] text-gray-700">{key}</span>
                    <span className="text-[11px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded w-fit max-w-full ">
                      {typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal ?? '—')}
                    </span>
                    <span className="text-xs text-gray-400 text-center">→</span>
                    <span className="text-[11px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded w-fit max-w-full ">
                      {typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal ?? '—')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end px-5 py-3 border-t border-gray-100">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>

      </DialogContent>
    </Dialog>
    </>
  );
}

const ITEMS_PER_PAGE = 50;

export default function ActivityLogs() {
  const { logs, userRole, userEmail } = useLoaderData<typeof loader>();

  // ── All state declared at the top of the component, never inside callbacks ──
  const [searchAction, setSearchAction] = useState('ALL');
  const [searchTable,  setSearchTable]  = useState('ALL');
  const [searchIp,     setSearchIp]     = useState('');
  const [searchEmail,  setSearchEmail]  = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [hasScrolled,  setHasScrolled]  = useState(false);

 

  const filtered = useMemo(() => {
    return (logs as LogEntry[]).filter((log) => {
      if (log.action === 'DELETE_DRAFT_PRODUCT') return false;
      if (searchAction !== 'ALL' && log.action    !== searchAction) return false;
      if (searchTable  !== 'ALL' && log.tablename !== searchTable)  return false;
      if (searchIp && !log.ipAddress?.includes(searchIp))           return false;
      if (searchEmail && !log.email?.toLowerCase().includes(searchEmail.toLowerCase())) return false;
      if (dateFrom) {
        const from = new Date(dateFrom).getTime() / 1000;
        if (log.tstamp < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo).getTime() / 1000 + 86400;
        if (log.tstamp > to) return false;
      }
      return true;
    });
  }, [logs, searchAction, searchTable, searchIp,searchEmail, dateFrom, dateTo]);
   //const actions = useMemo(() => uniqueValues(filtered, 'action'), [filtered]);
   const actions = useMemo(
  () => uniqueValues((logs as LogEntry[]).filter(l => l.action !== 'DELETE_DRAFT_PRODUCT'), 'action'),
  [logs]
);
  const tables  = useMemo(() => uniqueValues(logs as LogEntry[], 'tablename'), [logs]);


  // Reset pagination whenever filters change
  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
    setHasScrolled(false);
  }, [searchAction, searchTable, searchIp, dateFrom, dateTo]);

  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 100) setHasScrolled(true);
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300;
      if (nearBottom) {
        setVisibleCount((prev) =>
          prev < filtered.length ? Math.min(prev + ITEMS_PER_PAGE, filtered.length) : prev
        );
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [filtered.length]);

  const clearFilters = () => {
    setSearchAction('ALL');
    setSearchTable('ALL');
    setSearchIp('');
    setDateFrom('');
    setDateTo('');  
  };

  const hasActiveFilters =
    searchAction !== 'ALL' || searchTable !== 'ALL' || !!searchIp || !!dateFrom || !!dateTo;

  return (
    <Layout userRole={userRole} userEmail={userEmail}>

      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Activity Logs</h1>
          <p className="text-sm text-gray-500 mt-1">Audit trail for all dashboard actions</p>
        </div>
        {/* <div className="flex gap-2 text-sm">
          <span className="px-3 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            Total <b>{logs.length}</b>
          </span>
          <span className="px-3 py-1 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Filtered <b>{filtered.length}</b>
          </span>
        </div> */}
      </div>

      {/* ── Filters ── */}
      <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Action</label>
          <select
            value={searchAction}
            onChange={(e) => setSearchAction(e.target.value)}
            className="border rounded px-2 py-1 text-sm h-8 bg-white dark:bg-gray-900"
          >
            <option value="ALL">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Table</label>
          <select
            value={searchTable}
            onChange={(e) => setSearchTable(e.target.value)}
            className="border rounded px-2 py-1 text-sm h-8 bg-white dark:bg-gray-900"
          >
            <option value="ALL">All Tables</option>
            {tables.map((t) => (
              <option key={t} value={t}>{TABLE_LABELS[t] ?? t}</option>
            ))}
          </select>
        </div> */}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">IP Address</label>
          <Input
            placeholder="Filter by IP..."
            value={searchIp}
            onChange={(e) => setSearchIp(e.target.value)}
            className="text-sm h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Email</label>
          <Input
            placeholder="Filter by Email..."
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            className="text-sm h-8"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">From Date</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm h-8 bg-white dark:bg-gray-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">To Date</label>
          <div className="flex gap-1">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm h-8 bg-white dark:bg-gray-900 flex-1"
            />
            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="h-8 px-2 text-xs text-red-600 border-red-300 hover:bg-red-50"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-700 text-left">
              <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300">#</th>
      <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Email</th>
              {/* <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">DB Date</th> */}
              <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300">Action</th>
              {/* <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300">Table</th> */}
              <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">IP Address</th>
              
              <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Timestamp</th>
              <th className="px-3 py-2 border-b font-semibold text-gray-700 dark:text-gray-300 text-center">View Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.slice(0, visibleCount).map((log: LogEntry, idx: number) => (
                <tr
                  key={`${log.dbDate}-${log.tstamp}-${idx}`}
                  className="hover:bg-yellow-50 dark:hover:bg-gray-800 transition-colors duration-150 border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                   <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {log.email ?? '—'}
                  </td>
                  {/* <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
                    {formatDbDate(log.dbDate)}
                  </td> */}
                  <td className="px-3 py-2">
                    <ActionBadge action={log.action} />
                  </td>
                  {/* <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {TABLE_LABELS[log.tablename] ?? log.tablename}
                  </td> */}
                  <td className="px-3 py-2 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {log.ipAddress ?? '—'}
                  </td>
                 
                   <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                    {formatDate(log.tstamp)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PayloadDialog payload={log.payload ?? {}} action={log.action} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-10 text-gray-400">
                  No activity logs match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Infinite scroll status ── */}
      {filtered.length > 0 && hasScrolled && (
        <div className="mt-3 flex flex-col items-center gap-1">
          <p className="text-sm text-gray-500">
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} logs
          </p>
          {visibleCount < filtered.length && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Scroll down to load more...
            </div>
          )}
          {visibleCount >= filtered.length && filtered.length > ITEMS_PER_PAGE && (
            <p className="text-sm text-gray-400">All records loaded</p>
          )}
        </div>
      )}

    </Layout>
  );
}