import { ActionFunctionArgs, json, LoaderFunctionArgs, redirect } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useEffect, useState } from 'react';
import Layout from '../components/layout';
import { Button } from '../components/ui/button';
import { getTransactionByMfId, updateTransaction } from '../lib/dynamodb-transactions';
import mysqlService from '../lib/mysql.server';
import { getSession } from '~/lib/session.server';
import * as XLSX from 'xlsx';
import {
  updateManualCallback,
  getMfIdBySequenceNo,
  getFullTransactionByMfId,
  getFullTransactionBySequenceNo,
} from '~/lib/mysql-queries';
import { Spinner } from '../components/ui/Spinner';
import safeNumberOrString from '~/util/safeNumberOrString';
import { getClientIP, logDashboardActivity } from '~/lib/dynamodb-log';
import { DYNAMODB_TABLES } from '~/lib/config';
import { fullAuthGuard } from '~/util/authGuard';

// -----------------------
// Modal Component
// -----------------------
function CallbackModal({
  isOpen,
  onClose,
  callbackData,
  sequenceNo,
  type,
}: {
  isOpen: boolean;
  onClose: () => void;
  callbackData: any;
  sequenceNo: string;
  type: 'existing' | 'new';
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">
            {type === 'existing' ? 'Existing' : 'New'} Callback Data for Sequence: {sequenceNo}
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </Button>
        </div>
        <div className="bg-gray-100 p-4 rounded border">
          <pre className="text-sm font-mono whitespace-pre-wrap break-all">
            {typeof callbackData === 'object'
              ? JSON.stringify(callbackData, null, 2)
              : callbackData}
          </pre>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// -----------------------
// Server-side: Loader
// -----------------------
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect('/login?message=login%20required');
  }
  const userRole = session.get('role');
  if (userRole !== 'admin') {
    return redirect('/service-ids?message=access%20denied');
  }
  return json({ userRole, userEmail: session.get('email') || null });
}

// -----------------------
// Helper: Make sure response JSON is always explicit
// -----------------------
const jsonResponse = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// -----------------------
// Server-side: Action
// -----------------------
export async function action({ request }: ActionFunctionArgs) {
  // Auth guard — reject unauthenticated requests
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }
  try {
    const session = await getSession(request);
    const userEmail = session.get('email');
    const user_ip = getClientIP(request);

    if (!session.has('email')) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }
    const userRole = session.get('role');
    if (userRole !== 'admin') {
      return jsonResponse({ error: 'Access denied. Admin role required.' }, 403);
    }

    const formData = await request.formData();
    const intent = formData.get('intent');

    const updateWithTimeout = async (promise: Promise<any>, ms = 10000) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Update timed out')), ms)),
      ]);

    if (intent === 'update-single') {
      const mfId = formData.get('sequenceNo') as string;
      const callbackDataRaw = formData.get('callbackData') as string;

      if (!mfId || !callbackDataRaw) {
        return jsonResponse({ error: 'Missing MFID or callbackData.' }, 400);
      }
      try {
        let callbackData = JSON.parse(callbackDataRaw);
        callbackData = safeNumberOrString(callbackData);
        let transaction = null;
        try {
          transaction = await getFullTransactionByMfId(mysqlService, `${mfId}`);
        } catch (err) {
          return jsonResponse({ error: `Transaction lookup failed for MFID: ${mfId}` }, 500);
        }
        if (!transaction) {
          return jsonResponse({ error: `Transaction not found for MFID: ${mfId}` }, 404);
        }

        const fullData = transaction.fullRecord;
        fullData.callbackData = callbackData;

        if (!mysqlService) {
          return jsonResponse({ error: 'MySQL service not available' }, 500);
        }

        let mysqlResult;
        try {
          mysqlResult = await updateWithTimeout(
            updateManualCallback(mysqlService, mfId, fullData),
            10000,
          );
        } catch (err: any) {
          return jsonResponse({ error: `MySQL update failed: ${err.message}` }, 500);
        }
        if (!mysqlResult) {
          return jsonResponse({ error: 'Failed to update MySQL record.' }, 500);
        }

        await logDashboardActivity(
          DYNAMODB_TABLES.TRANSACTIONS,
          'UPDATE_CALLBACK',
          { mfId, callbackData },
          user_ip,
          userEmail,
        );
        return jsonResponse(
          { success: `Successfully updated callback for MFID: ${mfId}`, mfId, status: 'updated' },
          200,
        );
      } catch (error: any) {
        return jsonResponse({ error: `Failed to update callback: ${error.message}` }, 500);
      }
    }

    if (intent === 'update-all') {
      const recordsRaw = formData.get('records') as string;

      if (!recordsRaw) {
        return jsonResponse({ error: 'Missing records data.' }, 400);
      }
      try {
        const records = JSON.parse(recordsRaw) as {
          sequenceNo: string;
          callbackData: any;
          sqlMfId: string;
          originalSequenceNo: string;
        }[];
        let updatedCount = 0;
        let errorCount = 0;
        const errors: string[] = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          const batchPromises = batch.map(async (record) => {
            const { sequenceNo, callbackData, sqlMfId, originalSequenceNo } = record;
            const fixedCallbackData = safeNumberOrString(callbackData);

            if (!sequenceNo) {
              return { success: false, error: `Missing sequenceNo in record` };
            }
            try {
              let transaction = null;
              try {
                transaction = await getFullTransactionByMfId(mysqlService, `${sqlMfId}`);
              } catch (error) {
                console.log(error);
                return {
                  success: false,
                  error: `Transaction lookup failed for sequence: ${sequenceNo}`,
                };
              }
              if (!transaction) {
                return {
                  success: false,
                  error: `Transaction not found for sequence: ${sequenceNo}`,
                };
              }

              const fullData = transaction.fullRecord;
              fullData.callbackData = fixedCallbackData;

              let mysqlUpdated;
              try {
                mysqlUpdated = await updateWithTimeout(
                  updateManualCallback(mysqlService, sqlMfId, fullData),
                  10000,
                );
              } catch (err: any) {
                return {
                  success: false,
                  error: `Failed to update MySQL record for sequence: ${sequenceNo}: ${err.message || err
                    }`,
                };
              }
              if (!mysqlUpdated)
                return {
                  success: false,
                  error: `Failed to update MySQL record for sequence: ${sequenceNo}`,
                };

              return { success: true };
            } catch (err: any) {
              return {
                success: false,
                error: `Failed to update sequence ${sequenceNo}: ${err.message || err}`,
              };
            }
          });
          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach((result) => {
            if (result.success) updatedCount++;
            else {
              errorCount++;
              if (result.error) errors.push(result.error);
            }
          });
        }

        await logDashboardActivity(
          DYNAMODB_TABLES.TRANSACTIONS,
          'UPDATE_CALLBACK_BULK',
          { updatedCount, errorCount, errors },
          user_ip,
          userEmail,
        );
        return jsonResponse(
          { message: `Bulk update completed.`, updatedCount, errorCount, errors },
          200,
        );
      } catch (err: any) {
        return jsonResponse({ error: `Failed to process bulk update: ${err.message || err}` }, 500);
      }
    }

    if (intent === 'upload-excel') {
      const file = formData.get('excelFile');

      if (!(file instanceof File)) {
        return jsonResponse(
          { error: 'Invalid file upload.' },
          400,
        );
      }



      const allowedMimeTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ];

      if (!allowedMimeTypes.includes(file.type)) {
        return jsonResponse(
          { error: 'Only Excel files are allowed.' },
          400,
        );
      }
      const fileName = file.name.toLowerCase();

      if (
        !fileName.endsWith('.xlsx') &&
        !fileName.endsWith('.xls')
      ) {
        return jsonResponse(
          { error: 'Invalid file extension.' },
          400,
        );
      }

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const headers = data[0] as string[];

        if (!headers || headers.length < 1) {
          return jsonResponse({ error: 'Invalid Excel/CSV format. Missing headers.' }, 400);
        }

        // ✅ Detect format
        const isOldFormat = headers.includes('BODY');
        const isNewFormat = headers.includes('SEQUENCE_NO');

        if (!isOldFormat && !isNewFormat) {
          return jsonResponse(
            { error: "Invalid Excel format. Missing 'BODY' or 'SEQUENCE_NO' column." },
            400,
          );
        }

        const results: any[] = [];
        let successCount = 0;
        let errorCount = 0;
        const rowsToProcess: Array<{ index: number; sequenceNo: string; callbackData: any }> = [];

        // ✅ Parse rows based on detected format
        for (let i = 1; i < data.length; i++) {
          const row = data[i] as any[];
          if (!row || row.length === 0) continue;

          try {
            let callbackData: any = {};
            let sequenceNo: string | undefined;

            if (isOldFormat) {
              // 🟡 Old format - BODY column
              const bodyIndex = headers.indexOf('BODY');
              const bodyRaw = row?.[bodyIndex];
              if (!bodyRaw) continue;

              try {
                callbackData = typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : bodyRaw;
              } catch {
                // URL-encoded BODY
                const params = new URLSearchParams(bodyRaw);
                const jsonObj: Record<string, string> = {};
                for (const [k, v] of params.entries()) jsonObj[k] = v;
                callbackData = jsonObj;
              }

              sequenceNo = callbackData?.sequenceNo;
            } else if (isNewFormat) {
              // 🟢 New format - structured columns
              const field = (name: string) => row[headers.indexOf(name)] ?? null;
              sequenceNo = field('SEQUENCE_NO');

              callbackData = {
                appliedPlan: field('APPLIED_PLAN'),
                bearerId: field('BEARER_ID'),
                callingParty: field('CALLING_PARTY'),
                category: field('CATEGORY'),
                chargeAmount: field('CHARGE_AMOUNT'),
                operationId: field('OPERATION_ID'),
                renFlag: field('REN_FLAG'),
                requestedPlan: field('REQUESTED_PLAN'),
                resultCode: field('RESULT_CODE'),
                sequenceNo,
                serviceId: field('SERVICE_ID'),
                serviceNode: field('SERVICE_NODE'),
                serviceType: field('SERVICE_TYPE'),
                transactionId: field('TRANSACTION_ID'),
                validityDays: field('VALIDITY_DAYS'),
                validityType: field('VALIDITY_TYPE'),
                processingTime: field('PROCESSING_TIME'),
              };
            }

            if (!sequenceNo || sequenceNo === 'NA') continue;

            rowsToProcess.push({ index: i, sequenceNo, callbackData });
          } catch (err: any) {
            errorCount++;
            results.push({ status: 'error', message: `Row ${i}: ${err.message}` });
          }
        }

        // 🔁 Batch processing (same as before)
        const BATCH_SIZE = 10;
        for (let i = 0; i < rowsToProcess.length; i += BATCH_SIZE) {
          const batch = rowsToProcess.slice(i, i + BATCH_SIZE);

          const batchPromises = batch.map(async ({ sequenceNo, callbackData }) => {
            const actualMfId = sequenceNo;
            let mfidFromSql: string | null = null;
            let transaction = null;

            try {
              // 1️⃣ Try fetching from DynamoDB
              // Calculate yesterday's date as a string in format 'YYYY-MM-DD'
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const dbDateStr = yesterday.toISOString().split('T')[0];
              console.log(typeof sequenceNo);
              transaction = await getFullTransactionBySequenceNo(
                mysqlService,
                `${sequenceNo}`,
                // `dbDate = '${dbDateStr}'`,
              );

              if (!transaction) {
                console.warn('⚠️ No transaction found in DynamoDB for:', actualMfId);
                return {
                  sequenceNo: actualMfId,
                  originalSequenceNo: sequenceNo,
                  sqlMfId: 'NA',
                  status: 'error',
                  message: `Not found in DynamoDB for MFID: ${actualMfId}`,
                };
              }

              mfidFromSql = transaction.mfId;

              const existingCallbackData = transaction.callbackData;
              if (existingCallbackData) {
                return {
                  sequenceNo: actualMfId,
                  originalSequenceNo: sequenceNo,
                  sqlMfId: mfidFromSql,
                  status: 'exists',
                  message: `Callback already exists for MFID: ${actualMfId}`,
                  callbackData: existingCallbackData,
                };
              } else {
                return {
                  sequenceNo: actualMfId,
                  originalSequenceNo: sequenceNo,
                  sqlMfId: mfidFromSql,
                  status: 'ready',
                  message: `Ready to update new callback for MFID: ${actualMfId}`,
                  callbackData,
                };
              }
            } catch (err: any) {
              console.error('❌ Processing failed for', sequenceNo, err);
              return {
                sequenceNo: actualMfId,
                originalSequenceNo: sequenceNo,
                sqlMfId: 'N/A',
                status: 'error',
                message: err.message || 'Failed to process record',
              };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);

          batchResults.forEach((r) => {
            if (r.status === 'exists' || r.status === 'ready') successCount++;
            else errorCount++;
          });
        }

        console.log(
          '📦 Final results:',
          results.map((r) => ({
            sequenceNo: r.sequenceNo,
            originalSequenceNo: r.originalSequenceNo,
            sqlMfId: r.sqlMfId,
          })),
        );

        return jsonResponse({
          success: `Processed ${rowsToProcess.length} rows. ${successCount} success, ${errorCount} failed.`,
          results,
          summary: {
            total: rowsToProcess.length,
            success: successCount,
            error: errorCount,
          },
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || 'Failed to process Excel' }, 500);
      }
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (error: any) {
    return jsonResponse({ error: `Server error: ${error.message}` }, 500);
  }
}

// -----------------------
// Client-side: Component
// -----------------------
export default function callbackUpdate() {
  const { userRole, userEmail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [modalData, setModalData] = useState<{
    isOpen: boolean;
    callbackData: any;
    sequenceNo: string;
    type: 'existing' | 'new';
  } | null>(null);
  const [updatingSequenceNo, setUpdatingSequenceNo] = useState<string | null>(null);
  const [selectedForUpdate, setSelectedForUpdate] = useState<Set<string>>(new Set());
  const [localResults, setLocalResults] = useState<any[]>([]);
  const [lastUploadTime, setLastUploadTime] = useState<number>(0);

  // Extract action data
  const error = (actionData as any)?.error;
  const success = (actionData as any)?.success;
  const results = (actionData as any)?.results || [];
  const summary = (actionData as any)?.summary;

  // Clear stale state when a new Excel upload starts submitting
  useEffect(() => {
    if (navigation.state === 'submitting') {
      setLocalResults([]);
      setSelectedForUpdate(new Set());
      setModalData(null);
      setLastUploadTime(Date.now());
    }
  }, [navigation.state]);

  // When fresh results arrive from a new upload, clear local state and use fresh results
  useEffect(() => {
    if (Array.isArray(results) && results.length > 0) {
      setLocalResults([]);
      setSelectedForUpdate(new Set());
    }
  }, [results]);

  // Use fresh results from server if available, otherwise use local results
  // Only use fresh results if they came after the last upload (to avoid stale data)
  const hasFreshResults = Array.isArray(results) && results.length > 0 && lastUploadTime > 0;
  // If we have local results (from individual updates), use them; otherwise use fresh results
  const displayResults = localResults.length > 0 ? localResults : hasFreshResults ? results : [];

  // Debug: Log when we're using fresh vs local results
  console.log('State debug:', {
    hasFreshResults,
    resultsLength: Array.isArray(results) ? results.length : 0,
    localResultsLength: localResults.length,
    lastUploadTime,
    usingLocalResults: localResults.length > 0,
    usingFreshResults: localResults.length === 0 && hasFreshResults,
  });

  // For selection
  const readyRecordsForSelection = displayResults.filter((r: any) => r.status === 'ready');
  const allReadySelected =
    readyRecordsForSelection.length > 0 &&
    readyRecordsForSelection.every((r) => selectedForUpdate.has(r.sequenceNo));

  const handleSelectRow = (sequenceNo: string) => {
    setSelectedForUpdate((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sequenceNo)) newSet.delete(sequenceNo);
      else newSet.add(sequenceNo);
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (allReadySelected) setSelectedForUpdate(new Set());
    else setSelectedForUpdate(new Set(readyRecordsForSelection.map((r) => r.sequenceNo)));
  };

  // -----------------------
  // Client helper: robust body parser
  // -----------------------
  const safeParseBody = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    if (isJson) {
      try {
        const jsonBody = await response.clone().json();
        return { type: 'json', body: jsonBody } as const;
      } catch (_) { }
    }
    // If it's not JSON (likely HTML document after a redirect), avoid dumping it to users
    try {
      const textBody = await response.clone().text();
      return { type: 'text', body: textBody } as const;
    } catch (_) {
      return { type: 'empty', body: null } as const;
    }
  };

  // -----------------------
  // Client: Update single callback (robust)
  // -----------------------
  const handleUpdateCallback = async (mfId: string, callbackData: any) => {
    setUpdatingSequenceNo(mfId);
    try {
      const formData = new FormData();
      formData.append('intent', 'update-single');
      formData.append('sequenceNo', mfId);
      formData.append('callbackData', JSON.stringify(callbackData));

      const response = await fetch('/callbackUpdate', {
        method: 'POST',
        body: formData,
      });
      const parsed = await safeParseBody(response);

      if (response.ok) {
        let successMessage = `Successfully updated callback for MFID: ${mfId}`;
        if (parsed.type === 'json' && parsed.body) {
          successMessage = parsed.body.success || parsed.body.message || successMessage;
        } else if (parsed.type === 'text') {
          const text = (parsed.body || '').toString().trim();
          // Avoid showing full HTML document in alerts
          if (text && !text.startsWith('<!DOCTYPE') && !text.startsWith('<html')) {
            successMessage = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
          }
        }

        alert(successMessage);
        const currentResults =
          localResults.length > 0 ? localResults : hasFreshResults ? results : [];
        const updatedResults = currentResults.map((r: any) =>
          r.sqlMfId === mfId ? { ...r, status: 'updated', message: successMessage } : r,
        );
        setLocalResults(updatedResults);
      } else {
        let errorMessage = `HTTP ${response.status}`;
        if (parsed.type === 'json' && parsed.body && parsed.body.error) {
          errorMessage = parsed.body.error;
        } else if (parsed.type === 'text' && parsed.body) {
          const text = parsed.body.toString().trim();
          if (text && !text.startsWith('<!DOCTYPE') && !text.startsWith('<html')) {
            errorMessage = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
          }
        }
        alert(`Update failed: ${errorMessage}`);

        const currentResults =
          localResults.length > 0 ? localResults : hasFreshResults ? results : [];
        const updatedResults = currentResults.map((r: any) =>
          r.sequenceNo === mfId || r.originalSequenceNo === mfId
            ? { ...r, status: 'error', message: errorMessage }
            : r,
        );
        setLocalResults(updatedResults);
      }
    } catch (err: any) {
      const msg = err?.message || 'Network error occurred';
      alert(`Update failed: ${msg}`);
      const currentResults = Array.isArray(results) && results.length > 0 ? results : localResults;
      const updatedResults = currentResults.map((r: any) =>
        r.sequenceNo === mfId || r.originalSequenceNo === mfId
          ? { ...r, status: 'error', message: msg }
          : r,
      );
      setLocalResults(updatedResults);
    } finally {
      setUpdatingSequenceNo(null);
    }
  };

  // -----------------------
  // Client: Update selected (bulk)
  // -----------------------
  const handleUpdateAll = async () => {
    setUpdatingSequenceNo('all');
    const recordsToUpdate = displayResults.filter((r: any) => selectedForUpdate.has(r.sequenceNo));
    if (recordsToUpdate.length === 0) {
      alert('No records selected for update.');
      setUpdatingSequenceNo(null);
      return;
    }
    const formData = new FormData();
    formData.append('intent', 'update-all');
    formData.append('records', JSON.stringify(recordsToUpdate));
    try {
      const response = await fetch('/callbackUpdate', { method: 'POST', body: formData });
      const parsed = await safeParseBody(response);
      if (response.ok) {
        const successMessage =
          (parsed.type === 'json' && parsed.body && (parsed.body.message || parsed.body.success)) ||
          `Successfully updated selected records`;
        alert(successMessage);
        const updatedResults = displayResults.map((res: any) =>
          selectedForUpdate.has(res.sequenceNo)
            ? {
              ...res,
              status: 'updated',
              message: `Successfully updated for MFID: ${res.sequenceNo}`,
            }
            : res,
        );
        setLocalResults(updatedResults);
        setSelectedForUpdate(new Set());
      } else {
        let errorMessage = `HTTP ${response.status}`;
        if (parsed.type === 'json' && parsed.body && parsed.body.error)
          errorMessage = parsed.body.error;
        else if (parsed.type === 'text' && parsed.body && parsed.body.trim().length > 0)
          errorMessage = parsed.body;
        alert(`Update failed update ALL: ${errorMessage}`);
      }
    } catch (err: any) {
      alert(
        `Update failed on Update ALL: ${err?.message || err?.toString() || 'Network error occurred'
        }`,
      );
    } finally {
      setUpdatingSequenceNo(null);
    }
  };

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Bulk Update Callbacks via Excel</h1>
        <div className="p-4 border rounded-lg bg-gray-50">
          {navigation.state === 'submitting' && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center text-blue-700">
                <Spinner size="small" className="mr-2" />
                <span className="text-sm font-medium">
                  Processing Excel file... Please wait while we analyze and validate your data.
                </span>
              </div>
            </div>
          )}
          <Form method="post" encType="multipart/form-data" className="space-y-4">
            <input type="hidden" name="intent" value="upload-excel" />
            <div>
              <label htmlFor="excelFile" className="block text-sm font-medium mb-2">
                Upload Excel File
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Please upload an Excel file. Must have a column named <strong>BODY</strong>.
              </p>
              <input
                type="file"
                id="excelFile"
                name="excelFile"
                accept=".xlsx,.xls"
                disabled={navigation.state === 'submitting'}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={navigation.state === 'submitting'}
              className={
                navigation.state === 'submitting'
                  ? 'bg-blue-600 hover:bg-blue-700 cursor-not-allowed'
                  : ''
              }
            >
              {navigation.state === 'submitting' ? (
                <>
                  <Spinner size="small" className="mr-2" />
                  Processing Excel File...
                </>
              ) : (
                'Upload and Process'
              )}
            </Button>
          </Form>
        </div>

        {error && (
          <div className="p-4 border border-red-200 rounded-lg bg-red-50">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
              </div>
            </div>
          </div>
        )}

        {summary && (
          <div className="p-4 border rounded-lg bg-blue-50">
            <h2 className="text-lg font-semibold mb-4 text-blue-800">Processing Summary</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{summary.total}</div>
                <div className="text-gray-600">Total Rows</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{summary.success}</div>
                <div className="text-gray-600">Successful</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{summary.error}</div>
                <div className="text-gray-600">Failed</div>
              </div>
            </div>
            {displayResults && displayResults.length > 0 && (
              <div className="mt-4 pt-4 border-t border-blue-200">
                <div className="flex justify-between items-center">
                  <div className="text-sm text-blue-700">
                    <div>
                      {displayResults.filter((r: any) => r.status === 'ready').length} records ready
                      for update
                    </div>
                    {displayResults.filter((r: any) => r.sqlMfId).length > 0 && (
                      <div className="text-xs text-green-600 mt-1">
                        ✓ {displayResults.filter((r: any) => r.sqlMfId).length} records found MFID
                        from SQL
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={handleUpdateAll}
                    disabled={updatingSequenceNo === 'all' || selectedForUpdate.size === 0}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {updatingSequenceNo === 'all'
                      ? 'Updating All...'
                      : `Update Selected (${selectedForUpdate.size})`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {displayResults && displayResults.length > 0 && (
          <div className="p-4 border rounded-lg bg-gray-50">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">Detailed Results</h2>
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        onChange={handleSelectAll}
                        checked={allReadySelected}
                        disabled={readyRecordsForSelection.length === 0}
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      MFID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Original Seq No
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Callback
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayResults.map((result: any, index: number) => (
                    <tr
                      key={index}
                      className={
                        result.status === 'exists'
                          ? 'bg-yellow-50'
                          : result.status === 'ready'
                            ? 'bg-blue-50'
                            : result.status === 'updated'
                              ? 'bg-green-50'
                              : result.status === 'success'
                                ? 'bg-green-50'
                                : 'bg-red-50'
                      }
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        {result.status === 'ready' && (
                          <input
                            type="checkbox"
                            checked={selectedForUpdate.has(result.sequenceNo)}
                            onChange={() => handleSelectRow(result.sequenceNo)}
                          />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {result.sqlMfId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {result.originalSequenceNo || result.sequenceNo}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${result.status === 'exists'
                            ? 'bg-yellow-100 text-yellow-800'
                            : result.status === 'ready'
                              ? 'bg-blue-100 text-blue-800'
                              : result.status === 'updated'
                                ? 'bg-green-100 text-green-800'
                                : result.status === 'success'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                            }`}
                        >
                          {result.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {result.status === 'exists' && result.callbackData ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setModalData({
                                isOpen: true,
                                callbackData: result.callbackData,
                                sequenceNo: result.sequenceNo,
                                type: 'existing',
                              })
                            }
                          >
                            View Existing Callback
                          </Button>
                        ) : result.status === 'ready' && result.callbackData ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setModalData({
                                isOpen: true,
                                callbackData: result.callbackData,
                                sequenceNo: result.sequenceNo,
                                type: 'new',
                              })
                            }
                          >
                            View New Callback
                          </Button>
                        ) : (
                          <span className="text-gray-400">No callback</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {result.status === 'ready' ? (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() =>
                              handleUpdateCallback(result.sqlMfId, result.callbackData)
                            }
                            disabled={updatingSequenceNo === result.sequenceNo}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            {updatingSequenceNo === result.sequenceNo ? 'Updating...' : 'Update'}
                          </Button>
                        ) : result.status === 'updated' ? (
                          <span className="text-green-600 font-medium">✓ Updated</span>
                        ) : result.status === 'exists' ? (
                          <span className="text-gray-400">Already exists</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {modalData && (
          <CallbackModal
            isOpen={modalData.isOpen}
            onClose={() => setModalData(null)}
            callbackData={modalData.callbackData}
            sequenceNo={modalData.sequenceNo}
            type={modalData.type}
          />
        )}
      </div>
    </Layout>
  );
}
