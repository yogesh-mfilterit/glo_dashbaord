import { json, LoaderFunctionArgs, redirect, ActionFunctionArgs } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/layout';
import { Button } from '../components/ui/button';
import { docClient } from '../lib/dynamodb-transactions';
import { getSession } from '~/lib/session.server';
import * as XLSX from 'xlsx';
import { Spinner } from '../components/ui/Spinner';
import { getClientIP, logDashboardActivity } from '~/lib/dynamodb-log';
import { DYNAMODB_TABLES } from '~/lib/config';
import { authGuard, fullAuthGuard } from '~/util/authGuard';
import { BatchGetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';


interface CsvFields {
  customerMsisdn: string | null;
  serviceId: string | null;
  nodeId: string | null;
  description: string | null;
}

interface MatchResult extends CsvFields {
  mfId: string;
  status: 'matched' | 'not_found';
  alreadyUnsubscribed?: boolean;
}

// ─── Activity log entry (client-side) ───────────────────────────────────────
interface ActivityEntry {
  mfId: string;
  customerMsisdn: string | null;
  serviceId: string | null;
  description: string | null;
  nodeId: string | null;
  action: 'Unsubscribed' | 'Failed' | 'Not Found';
  actionTimestamp: string; // ISO 8601
  response?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  // const isAuthenticated = await authGuard(request);
  // if (!isAuthenticated) return redirect('/login?message=login%20required');
    
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect('/login');
  }

 
  
  const userRole = session.get('role');
  if (userRole !== 'admin') return redirect('/service-ids?message=access%20denied');

  return json({ userRole, userEmail: session.get('email') || null });
}
const jsonResponse = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
export async function action({ request }: ActionFunctionArgs) {

    const isAuthenticated = await fullAuthGuard(request);
    if (!isAuthenticated) {
      return json({ error: 'Authentication required' }, { status: 401 });
    }
  try {
    const session = await getSession(request);
    const userEmail = session.get('email');
    const user_ip = getClientIP(request);

    if (!session.has('email')) return jsonResponse({ error: 'Authentication required' }, 401);

    const userRole = session.get('role');
    if (userRole !== 'admin') return jsonResponse({ error: 'Access denied. Admin role required.' }, 403);

    const formData = await request.formData();
    const intent = formData.get('intent');
    if (intent === 'upload-excel') {
      const file = formData.get('excelFile') as File;
      if (!file) return jsonResponse({ error: 'Please select an Excel file.' }, 400);

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][];
        const headers = (data[0] as string[]).map(h => h?.toString().trim().toUpperCase());

        if (!headers || headers.length < 1) {
          return jsonResponse({ error: 'Invalid Excel/CSV format. Missing headers.' }, 400);
        }

        const mfIdColumn = headers.includes('MFID') ? 'MFID' : null;
        if (!mfIdColumn) {
          return jsonResponse({ error: 'Could not find MFID column.' }, 400);
        }

        const mfIdsToProcess: Array<{ mf: string; csvFields: CsvFields }> = [];

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row || row.length === 0) continue;

          try {
            const field = (name: string) => {
              const idx = headers.indexOf(name);
              return idx !== -1 && row[idx] != null ? String(row[idx]).trim() : null;
            };

            const mf = field(mfIdColumn) ?? undefined;
            if (!mf || mf === 'NA') continue;

            const customerMsisdn = field('CUSTOMER_MSISDN') ?? field('CALLING_PARTY') ?? field('MSISDN');
            const serviceId = field('SERVICE_ID');
            const nodeId = field('NODE_ID') ?? field('SERVICE_NODE');
            const description = field('PRODUCT_ID');
            mfIdsToProcess.push({ mf, csvFields: { customerMsisdn, serviceId, nodeId, description } });
          } catch { /* skip bad rows */ }
        }

        if (mfIdsToProcess.length === 0) {
          return jsonResponse({ error: 'No valid MFIDs found in the uploaded file.' }, 400);
        }

        const CHUNK_SIZE = 100;
        const allFoundIds = new Set<string>();
        const alreadyUnsubscribed = new Set<string>();

        for (let i = 0; i < mfIdsToProcess.length; i += CHUNK_SIZE) {
          const chunk = mfIdsToProcess.slice(i, i + CHUNK_SIZE);
          const keys = chunk.map(({ mf }) => ({ mfId: mf }));
          const batchResult = await docClient.send(new BatchGetCommand({
            RequestItems: { [DYNAMODB_TABLES.TRANSACTIONS]: { Keys: keys } },
          }));
          batchResult.Responses?.[DYNAMODB_TABLES.TRANSACTIONS]?.forEach((item: Record<string, unknown>) => {
            allFoundIds.add(item.mfId as string);
            if (item.unsubscribed === true) alreadyUnsubscribed.add(item.mfId as string);
          });
        }

        let matchedCount = 0;
        let notFoundCount = 0;
        const results: MatchResult[] = mfIdsToProcess.map(({ mf, csvFields }) => {
          if (alreadyUnsubscribed.has(mf)) {
            return { mfId: mf, status: 'matched', alreadyUnsubscribed: true, ...csvFields };
          }
          if (allFoundIds.has(mf)) {
            matchedCount++;
            return { mfId: mf, status: 'matched', ...csvFields };
          } else {
            notFoundCount++;
            return { mfId: mf, status: 'not_found', ...csvFields };
          }
        });

        return jsonResponse({
          results,
          summary: { total: mfIdsToProcess.length, matched: matchedCount, notFound: notFoundCount },
        });
      } catch (err: unknown) {
        return jsonResponse({ error: (err as Error).message || 'Failed to process file' }, 500);
      }
    }

    // ── SINGLE UNSUBSCRIBE ────────────────────────────────────────────────────
    if (intent === 'unsubscribe') {
      const mfId = formData.get('mfId') as string;
      const msisdn = formData.get('customerMsisdn') as string;
      const nodeId = formData.get('nodeId') as string;
      const description = formData.get('description') as string;
      const serviceId = formData.get('serviceId') as string;

      if (!mfId || !msisdn) {
        return jsonResponse({ error: 'Missing required fields' }, 400);
      }
      const actionTimestamp = new Date().toISOString();

      try {
        const url = `https://prod5-nigeria.api.mtn.com/v2/customers/${msisdn}/subscriptions/${serviceId}?subscriptionProviderId=MSAP&nodeId=${nodeId}&description=${description}&registrationChannel=botDetect`;
        console.log(`URL: ${url}`);

        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'iJxLW4GZT9klQxRExxmRwKpbfieFn1A2',
            'transactionId': mfId,
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          return jsonResponse({ error: 'Unsubscribe failed' }, 500);
        }

        const responseBody = await response.json().catch(() => ({}));
        console.log('MTN API response: success');

        await logDashboardActivity(
          DYNAMODB_TABLES.TRANSACTIONS,
          'UNSUBSCRIBE_SINGLE',
          { mfId, msisdn, serviceId, nodeId, description, actionTimestamp },
          user_ip,
          userEmail,
        );

        await docClient.send(new UpdateCommand({
          TableName: DYNAMODB_TABLES.TRANSACTIONS,
          Key: { mfId },
          UpdateExpression: 'SET unsubscribed = :val, unsubscribedAt = :ts',
          ExpressionAttributeValues: { ':val': true, ':ts': actionTimestamp },
        }));

        return jsonResponse({
          unsubscribed: [mfId],
          actionTimestamps: { [mfId]: actionTimestamp },
          apiResponses: { [mfId]: JSON.stringify(responseBody) },
          unsubscribeSuccess: `Unsubscribed ${mfId} successfully.`,
        });
      } catch (error) {
        return jsonResponse({ error: `API call failed: ${(error as Error).message}` }, 500);
      }
    }

    // ── BULK UNSUBSCRIBE ──────────────────────────────────────────────────────
    if (intent === 'bulk-unsubscribe') {
      const raw = formData.get('selectedRecords') as string;
      if (!raw) return jsonResponse({ error: 'No records provided for bulk unsubscribe.' }, 400);

      let records: MatchResult[] = [];
      try {
        records = JSON.parse(raw);
      } catch {
        return jsonResponse({ error: 'Invalid records format.' }, 400);
      }

      if (!Array.isArray(records) || records.length === 0) {
        return jsonResponse({ error: 'No records selected for bulk unsubscribe.' }, 400);
      }

      const unsubscribed: string[] = [];
      const failed: { mfId: string; reason: string }[] = [];
      const actionTimestamps: Record<string, string> = {};
      const apiResponses: Record<string, string> = {};

      for (const record of records) {
        const { mfId, customerMsisdn, nodeId, description, serviceId } = record;

        if (!customerMsisdn || !serviceId) {
          failed.push({ mfId: mfId ?? 'unknown', reason: 'Missing required fields' });
          continue;
        }

        try {
          const url = `https://prod5-nigeria.api.mtn.com/v2/customers/${customerMsisdn}/subscriptions/${serviceId}?subscriptionProviderId=MSAP&nodeId=${nodeId}&description=${description}&registrationChannel=botDetect`;
          console.log(`URL: ${url}`);

          const response = await fetch(url, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': 'iJxLW4GZT9klQxRExxmRwKpbfieFn1A2',
              'transactionId': mfId,
              'Accept': 'application/json',
            },
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            failed.push({ mfId, reason: data?.error_description || data?.message || `HTTP ${response.status}` });
            continue;
          }

          const responseBody = await response.json().catch(() => ({}));
          const ts = new Date().toISOString();
          apiResponses[mfId] = JSON.stringify(responseBody);
          actionTimestamps[mfId] = ts;
          unsubscribed.push(mfId);

          await docClient.send(new UpdateCommand({
            TableName: DYNAMODB_TABLES.TRANSACTIONS,
            Key: { mfId },
            UpdateExpression: 'SET unsubscribed = :val, unsubscribedAt = :ts',
            ExpressionAttributeValues: { ':val': true, ':ts': ts },
          }));
        } catch (err) {
          failed.push({ mfId, reason: (err as Error).message || 'API call failed' });
        }
      }

      if (unsubscribed.length > 0) {
        // ✅ Log bulk unsubscribe activity
        await logDashboardActivity(
          DYNAMODB_TABLES.TRANSACTIONS,
          'UNSUBSCRIBE_BULK',
          {
            total: records.length,
            unsubscribed: unsubscribed.length,
            failed: failed.length,
            unsubscribedMfIds: unsubscribed,
            actionTimestamps,
          },
          user_ip,
          userEmail,
        );
      }

      return jsonResponse({
        unsubscribed,
        failed,
        actionTimestamps,
        apiResponses,
        unsubscribeSuccess: `Unsubscribed ${unsubscribed.length} MFID(s).${failed.length > 0 ? ` ${failed.length} failed.` : ''}`,
      });
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (error: unknown) {
    return jsonResponse({ error: `Server error: ${(error as Error).message}` }, 500);
  }
}

// ─── CSV Download helper ─────────────────────────────────────────────────────
function downloadActivityCSV(log: ActivityEntry[]) {
  const headers = ['MFID', 'Customer MSISDN', 'Service ID', 'Description (Product ID)', 'Node ID', 'Action', 'UTC Timestamp', 'Nigeria Timestamp', 'Response',];
  const rows = log.map(e => [
    e.mfId,
    e.customerMsisdn ?? '',
    e.serviceId ?? '',
    e.description ?? '',
    e.nodeId ?? '',
    e.action,
    new Date(e.actionTimestamp).toLocaleString('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    new Date(e.actionTimestamp).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    e.response ?? '',
  ]);

  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unsubscribe-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Page component ──────────────────────────────────────────────────────────
export default function UnsubscribedPage() {
  const { userRole, userEmail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [existResults, setExistResults] = useState<MatchResult[]>([]);
  const [existSummary, setExistSummary] = useState<any>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const results = existResults;
  const summary = existSummary;
  const matchedResults = results.filter(r => r.status === 'matched' && !r.alreadyUnsubscribed);
  const isSubmitting = navigation.state === 'submitting';

  // ── Merge new action data into state ──────────────────────────────────────
  useEffect(() => {
    if (actionData?.results) {
      setExistResults(actionData.results);
      setExistSummary(actionData.summary);
    }

    if (actionData?.unsubscribed?.length > 0) {
      const timestamps: Record<string, string> = actionData.actionTimestamps ?? {};

      // Update results table – mark rows as already-unsubscribed
      setExistResults(prev =>
        prev.map(r =>
          actionData.unsubscribed.includes(r.mfId) ? { ...r, alreadyUnsubscribed: true } : r,
        ),
      );

      // Deselect unsubscribed rows
      setSelectedIds(prev => {
        const next = new Set(prev);
        actionData.unsubscribed.forEach((id: string) => next.delete(id));
        return next;
      });

      // Append to activity log
      setActivityLog(prev => {
        const newEntries: ActivityEntry[] = actionData.unsubscribed.map((mfId: string) => {
          const record = existResults.find(r => r.mfId === mfId);
          return {
            mfId,
            customerMsisdn: record?.customerMsisdn ?? null,
            serviceId: record?.serviceId ?? null,
            description: record?.description ?? null,
            nodeId: record?.nodeId ?? null,
            action: 'Unsubscribed',
            actionTimestamp: timestamps[mfId] ?? new Date().toISOString(),
            response: actionData.apiResponses?.[mfId] ?? '',
          };
        });

        // Failed entries
        const failedEntries: ActivityEntry[] = (actionData.failed ?? []).map((f: { mfId: string }) => {
          const record = existResults.find(r => r.mfId === f.mfId);
          return {
            mfId: f.mfId,
            customerMsisdn: record?.customerMsisdn ?? null,
            serviceId: record?.serviceId ?? null,
            description: record?.description ?? null,
            nodeId: record?.nodeId ?? null,
            action: 'Failed',
            actionTimestamp: new Date().toISOString(),
          };
        });

        return [...newEntries, ...failedEntries, ...prev];
      });
    }

    if (actionData?.error) {
      setToast({ message: actionData.error, type: 'error' });
      setTimeout(() => setToast(null), 4000);
    }

    if (actionData?.unsubscribeSuccess) {
      const failedNote = actionData.failed?.length > 0
        ? ` (${actionData.failed.length} failed: ${actionData.failed.map((f: any) => f.mfId).join(', ')})`
        : '';
      setToast({
        message: actionData.unsubscribeSuccess + failedNote,
        type: actionData.unsubscribed?.length > 0 ? 'success' : 'error',
      });
      setTimeout(() => setToast(null), 6000);
    }
  }, [actionData]);

  const toggleSelect = (mfId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(mfId) ? next.delete(mfId) : next.add(mfId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === matchedResults.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(matchedResults.map(r => r.mfId)));
    }
  };

  const allMatchedSelected = matchedResults.length > 0 && selectedIds.size === matchedResults.length;

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Un-Subscribed</h1>

        {/* ── File upload ──────────────────────────────────────────────────── */}
        <div className="p-4 border rounded-lg bg-gray-50">
          {isSubmitting && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center text-blue-700">
                <Spinner size="small" className="mr-2" />
                <span className="text-sm font-medium">
                  {navigation.formData?.get('intent') === 'upload-excel'
                    ? 'Processing file… Matching MFIDs against DynamoDB.'
                    : navigation.formData?.get('intent') === 'bulk-unsubscribe'
                      ? 'Running bulk unsubscribe…'
                      : 'Processing…'}
                </span>
              </div>
            </div>
          )}

          <Form method="post" encType="multipart/form-data" className="space-y-4">
            <input type="hidden" name="intent" value="upload-excel" />
            <div>
              <label htmlFor="excelFile" className="block text-sm font-medium mb-2">
                Upload Excel / CSV File
              </label>
              <input
                type="file"
                id="excelFile"
                name="excelFile"
                accept=".xlsx,.xls,.csv"
                disabled={isSubmitting}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className={isSubmitting ? 'bg-blue-600 hover:bg-blue-700 cursor-not-allowed' : ''}
            >
              {isSubmitting && navigation.formData?.get('intent') === 'upload-excel' ? (
                <><Spinner size="small" className="mr-2" />Processing File…</>
              ) : (
                'Upload and Process'
              )}
            </Button>
          </Form>
        </div>

        {/* ── Toast ────────────────────────────────────────────────────────── */}
        {toast && (
          <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl border text-sm font-medium transition-all
            ${toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-green-50 border-green-200 text-green-800'}`}>
            {toast.type === 'error' ? (
              <svg className="h-5 w-5 text-red-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 text-gray-400 hover:text-gray-600">✕</button>
          </div>
        )}

        {/* ── Summary ──────────────────────────────────────────────────────── */}
        {summary && (
          <div className="p-4 border rounded-lg bg-blue-50">
            <h2 className="text-lg font-semibold mb-4 text-blue-800">Processing Summary</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{summary.total}</div>
                <div className="text-gray-600">Total MFIDs</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{summary.matched}</div>
                <div className="text-gray-600">Matched</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{summary.notFound}</div>
                <div className="text-gray-600">Not Found</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Results table ────────────────────────────────────────────────── */}
        {results.length > 0 && (
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Results
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({matchedResults.length} matched · {results.length - matchedResults.length} not found)
                </span>
              </h2>

              {matchedResults.length > 0 && (
                <Form method="post">
                  <input type="hidden" name="intent" value="bulk-unsubscribe" />
                  <input
                    type="hidden"
                    name="selectedRecords"
                    value={JSON.stringify(
                      selectedIds.size > 0
                        ? matchedResults.filter(r => selectedIds.has(r.mfId))
                        : matchedResults,
                    )}
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSubmitting && navigation.formData?.get('intent') === 'bulk-unsubscribe' ? (
                      <><Spinner size="small" className="mr-1" />Processing…</>
                    ) : (
                      <>
                        Bulk Unsubscribe
                        {selectedIds.size > 0 ? ` (${selectedIds.size} selected)` : ''}
                      </>
                    )}
                  </button>
                </Form>
              )}
            </div>

            <div className="max-h-[500px] overflow-y-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allMatchedSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        title="Select all matched"
                      />
                    </th>
                    {['MFID', 'Customer MSISDN', 'Service ID', 'Description (Product ID)', 'Node ID', 'Action'].map(col => (
                      <th
                        key={col}
                        className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((result, index) => {
                    const isMatched = result.status === 'matched';
                    const isUnsubscribed = result.alreadyUnsubscribed === true;
                    return (
                      <tr
                        key={index}
                        className={
                          isUnsubscribed
                            ? 'bg-green-50 hover:bg-green-100'
                            : isMatched
                              ? 'bg-green-50 hover:bg-green-100'
                              : 'bg-yellow-50 hover:bg-yellow-100'
                        }
                      >
                        <td className="px-4 py-4">
                          {isMatched && !isUnsubscribed ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(result.mfId)}
                              onChange={() => toggleSelect(result.mfId)}
                              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                            />
                          ) : (
                            <span />
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                          {result.mfId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {result.customerMsisdn ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {result.serviceId ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {result.description ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {result.nodeId ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {isUnsubscribed ? (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-200 text-gray-600">
                              Success
                            </span>
                          ) : isMatched ? (
                            <Form method="post">
                              <input type="hidden" name="intent" value="unsubscribe" />
                              <input type="hidden" name="mfId" value={result.mfId} />
                              <input type="hidden" name="customerMsisdn" value={result.customerMsisdn ?? ''} />
                              <input type="hidden" name="serviceId" value={result.serviceId ?? ''} />
                              <input type="hidden" name="nodeId" value={result.nodeId ?? ''} />
                              <input type="hidden" name="description" value={result.description ?? ''} />
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                Unsubscribe
                              </button>
                            </Form>
                          ) : (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                              Not Found
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Activity Log Table ───────────────────────────────────────────── */}
        {activityLog.length > 0 && (
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Activity Log</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {activityLog.length} action{activityLog.length !== 1 ? 's' : ''} recorded this session
                </p>
              </div>

              {/* ── Download CSV button ── */}
              <button
                onClick={() => downloadActivityCSV(activityLog)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors shadow-sm"
              >
                {/* download icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
                Download File
              </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    {['MFID', 'Customer MSISDN', 'Service ID', 'Description (Product ID)', 'Node ID', 'Action'].map(col => (     //  , 'Action Timestamp'
                      <th
                        key={col}
                        className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {activityLog.map((entry, idx) => (
                    <tr
                      key={idx}
                      className={
                        entry.action === 'Unsubscribed'
                          ? 'bg-green-50 hover:bg-green-100'
                          : 'bg-red-50 hover:bg-red-100'
                      }
                    >
                      <td className="px-5 py-3 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                        {entry.mfId}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-600">
                        {entry.customerMsisdn ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-600">
                        {entry.serviceId ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-600">
                        {entry.description ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-600">
                        {entry.nodeId ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${entry.action === 'Unsubscribed'
                            ? 'bg-green-200 text-green-800'
                            : 'bg-red-100 text-red-800'
                            }`}
                        >
                          {entry.action}
                        </span>
                      </td>
                      {/* <td className="px-5 py-3 whitespace-nowrap text-xs text-gray-500 font-mono">
                        {new Date(entry.actionTimestamp).toLocaleString('en-GB', {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                          hour12: false,
                        })}
                        <span className="block text-gray-400 text-[10px]">
                          {entry.actionTimestamp}
                        </span>
                      </td> */}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}