import { ActionFunctionArgs, json, LoaderFunctionArgs, redirect } from '@remix-run/node';
import { Form, useActionData, useNavigation, useLoaderData } from '@remix-run/react';
import { useState } from 'react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import {
  getTransactionByMfId,
  getTransactionsByMsisdnAndDateRangeWithCpidFilter,
} from '../lib/dynamodb-transactions';
import { getSession } from '../lib/session.server';
import Layout from '../components/layout';
import { fullAuthGuard } from '~/util/authGuard';

function formatDate(epoch: number) {
  const timestamp = epoch > 1000000000000 ? epoch : epoch * 1000;
  const d = new Date(timestamp);

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();

  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
}


// Helper function to convert date to YYYYMMDD format
function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Helper function to get min and max dates for the date picker
function getDateConstraints() {
  const today = new Date();
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(today.getMonth() - 1);

  return {
    min: formatDateToYYYYMMDD(oneMonthAgo),
    max: formatDateToYYYYMMDD(today),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }
  const userCpid = session.get('cpid');
  const userRole = session.get('role');

  return json({ userCpid, userRole, userEmail: session.get('email') || null });
}

export async function action({ request }: ActionFunctionArgs) {
    // Auth guard — reject unauthenticated requests
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }
  const session = await getSession(request);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const userRole = session.get('role');
  const userCpid = session.get('cpid');
  let transactionCpId = '';
  if (intent === 'check-mfid') {
    const mfId = formData.get('mfid') as string;
    if (!mfId) return json({ mfidError: 'Please enter an mfid' }, { status: 400 });
    const transaction = await getTransactionByMfId(mfId);
    if (!transaction)
      return json({ mfidError: 'No transaction found for this mfid' }, { status: 404 });
    // Security check: Ensure CP users can only see their own transactions
    transactionCpId = transaction.cpId || '';
    if (userRole === 'cp' && transaction.cpId !== userCpid) {
      return json({ mfidError: 'No transaction found for this mfid' }, { status: 404 });
    }

    return json({ transaction });
  } else if (intent === 'check-msisdn') {
    const msisdn = formData.get('msisdn') as string;
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;



    if (!msisdn) return json({ msisdnError: 'Please enter an MSISDN' }, { status: 400 });
    if (!startDate) return json({ msisdnError: 'Please select a start date' }, { status: 400 });
    if (!endDate) return json({ msisdnError: 'Please select an end date' }, { status: 400 });

    // Convert YYYY-MM-DD to YYYYMMDD format
    const formattedStartDate = startDate.replace(/-/g, '');
    const formattedEndDate = endDate.replace(/-/g, '');

    // Prefix 234 to the MSISDN
    const fullMsisdn = `234${msisdn}`;

    ;
    ;
    ;
    ;

    // Security check: Ensure CP users can only see their own transactions
    let cpidToFilter: string | null = null;
    if (userRole === 'cp') {
      cpidToFilter = userCpid;
    }

    const transactions = await getTransactionsByMsisdnAndDateRangeWithCpidFilter(
      fullMsisdn,
      formattedStartDate,
      formattedEndDate,
      cpidToFilter,
    );
    return json({ transactions });
  }

  return json({ mfidError: 'Invalid intent' }, { status: 400 });
}

export default function CheckMFID() {
  const actionData = useActionData<typeof action>();
  const { userCpid, userRole, userEmail } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [mfid, setMfid] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [tab, setTab] = useState('check-mfid');

  let transaction: any = null;
  let transactions: any[] = [];
  let mfidError: string | null = null;
  let msisdnError: string | null = null;
  if (actionData) {
    if ('transaction' in actionData) transaction = actionData.transaction;
    if ('transactions' in actionData) transactions = actionData.transactions;
    if ('mfidError' in actionData) mfidError = actionData.mfidError;
    if ('msisdnError' in actionData) msisdnError = actionData.msisdnError;
  }

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <h1 className="text-2xl font-bold mb-6">Check Transaction</h1>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="check-mfid">Check MFID</TabsTrigger>
          <TabsTrigger value="check-msisdn">Check MSISDN</TabsTrigger>
        </TabsList>

        <TabsContent value="check-mfid" className="mt-6">
          <Form method="post" className="flex gap-4 mb-8 items-end">
            <input type="hidden" name="intent" value="check-mfid" />
            <div className="flex flex-col">
              <label htmlFor="mfid" className="text-sm font-medium mb-1">
                mfId
              </label>
              <Input
                id="mfid"
                name="mfid"
                placeholder="Enter MFID"
                value={mfid}
                onChange={(e) => setMfid(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={navigation.state === 'submitting'}>
              {navigation.state === 'submitting' ? 'Searching...' : 'Search'}
            </Button>
          </Form>
          {mfidError && <div className="text-red-600 mb-4">{mfidError}</div>}
          {transaction && (
            <div className="space-y-8">
              {/* 1. Request Data */}
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                  1. Request Data
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Card */}
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <h4 className="font-semibold text-gray-700">Basic Information</h4>
                    </div>
                    <table className="w-full">
                      <tbody>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50 w-1/2">
                            MFID
                          </td>
                          <td className="px-4 py-3 text-gray-900">{transaction.mfId}</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Timestamp
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {formatDate(transaction.tstamp)}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">MSISDN</td>
                          <td className="px-4 py-3 text-gray-900">{transaction.msisdn}</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Verified Through
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.verifiedThrough || 'N/A'}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            DB Date
                          </td>
                          <td className="px-4 py-3 text-gray-900">{transaction.dbDate || 'N/A'}</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            IP Address
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.ipAddress || 'N/A'}
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Traffic Source
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.trafficSource || 'N/A'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Right Card */}
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <h4 className="font-semibold text-gray-700">Service & Status</h4>
                    </div>
                    <table className="w-full">
                      <tbody>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50 w-1/2">
                            Service ID
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.serviceId || 'N/A'}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Service ID Name
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.serviceIdName || 'N/A'}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Subscription Description
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.subscriptionDescription || 'N/A'}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Bot Status
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.botStatus || 'N/A'}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            Bot Reason
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.botReason || 'N/A'}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            CG1 Clicked
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.cg1Clicked || 'N/A'}
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                            CG2 Clicked
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {transaction.cg2Clicked || 'N/A'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 2. SDP Response */}
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                  2. SDP Response
                </h3>
                {transaction.sdpResponse ? (
                  <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                    <pre className="text-green-400 text-sm whitespace-pre-wrap">
                      {JSON.stringify(transaction.sdpResponse, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-yellow-800 font-medium">NO SDP Response received</p>
                  </div>
                )}
              </div>

              {/* 3. Callback Data */}
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                  3. Callback Data
                </h3>
                {transaction.callbackData ? (
                  <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                    <pre className="text-blue-400 text-sm whitespace-pre-wrap">
                      {JSON.stringify(transaction.callbackData, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-800 font-medium">No callback received</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="check-msisdn" className="mt-6">
          <Form method="post" className="flex gap-4 mb-8 items-end">
            <input type="hidden" name="intent" value="check-msisdn" />
            <input type="hidden" name="cpid" value={userCpid || ''} />
            <div className="flex flex-col">
              <label htmlFor="msisdn" className="text-sm font-medium mb-1">
                MSISDN
              </label>
              <div className="flex items-center">
                <span className="text-gray-500 mr-2">+234</span>
                <Input
                  id="msisdn"
                  name="msisdn"
                  placeholder="Enter 10 or more digits"
                  value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)}
                  minLength={10}
                  maxLength={15}
                  pattern="[0-9]{10,15}"
                  required
                  className="flex-1"
                />
              </div>
            </div>
            <div className="flex flex-col">
              <label htmlFor="startDate" className="text-sm font-medium mb-1">
                Start Date
              </label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={getDateConstraints().min}
                max={getDateConstraints().max}
                required
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="endDate" className="text-sm font-medium mb-1">
                End Date
              </label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || getDateConstraints().min}
                max={getDateConstraints().max}
                required
              />
            </div>
            <Button type="submit" disabled={navigation.state === 'submitting'}>
              {navigation.state === 'submitting' ? 'Searching...' : 'Search'}
            </Button>
          </Form>

          {msisdnError && <div className="text-red-600 mb-4">{msisdnError}</div>}

          {transactions.length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800">
                Found {transactions.length} transaction(s)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full border text-sm">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-700">
                      <th className="px-2 py-1 border text-xs">MFID</th>
                      <th className="px-2 py-1 border text-xs">Timestamp</th>
                      <th className="px-2 py-1 border text-xs">Date</th>
                      <th className="px-2 py-1 border text-xs">Service ID</th>
                      <th className="px-2 py-1 border text-xs">Service Name</th>
                      <th className="px-2 py-1 border text-xs">Bot Status</th>
                      <th className="px-2 py-1 border text-xs">CG1</th>
                      <th className="px-2 py-1 border text-xs">CG2</th>
                      <th className="px-2 py-1 border text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx: any) => (
                      <tr key={tx.mfId} className="hover:bg-gray-50">
                        <td className="px-2 py-1 border text-xs">{tx.mfId}</td>
                        <td className="px-2 py-1 border text-xs">{formatDate(tx.tstamp)}</td>
                        <td className="px-2 py-1 border text-xs">{tx.dbDate || 'N/A'}</td>
                        <td className="px-2 py-1 border text-xs">{tx.serviceId || 'N/A'}</td>
                        <td className="px-2 py-1 border text-xs">{tx.serviceIdName || 'N/A'}</td>
                        <td className="px-2 py-1 border text-xs">{tx.botStatus || 'N/A'}</td>
                        <td className="px-2 py-1 border text-xs">{tx.cg1Clicked || 'N/A'}</td>
                        <td className="px-2 py-1 border text-xs">{tx.cg2Clicked || 'N/A'}</td>
                        <td className="px-2 py-1 border text-xs">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedTransaction(tx)}
                                className="text-xs px-2 py-1 h-6"
                              >
                                View
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Transaction Details - {tx.mfId}</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-8">
                                {/* 1. Request Data */}
                                <div>
                                  <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                                    1. Request Data
                                  </h3>
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Left Card */}
                                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                        <h4 className="font-semibold text-gray-700">
                                          Basic Information
                                        </h4>
                                      </div>
                                      <table className="w-full">
                                        <tbody>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50 w-1/2">
                                              MFID
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">{tx.mfId}</td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Timestamp
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {formatDate(tx.tstamp)}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              MSISDN
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">{tx.msisdn}</td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Verified Through
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.verifiedThrough || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              DB Date
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.dbDate || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              IP Address
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.ipAddress || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr>
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Traffic Source
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.trafficSource || 'N/A'}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>

                                    {/* Right Card */}
                                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                        <h4 className="font-semibold text-gray-700">
                                          Service & Status
                                        </h4>
                                      </div>
                                      <table className="w-full">
                                        <tbody>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50 w-1/2">
                                              Service ID
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.serviceId || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Service ID Name
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.serviceIdName || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Subscription Description
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.subscriptionDescription || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Bot Status
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.botStatus || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              Bot Reason
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.botReason || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              CG1 Clicked
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.cg1Clicked || 'N/A'}
                                            </td>
                                          </tr>
                                          <tr>
                                            <td className="px-4 py-3 font-medium text-gray-700 bg-gray-50">
                                              CG2 Clicked
                                            </td>
                                            <td className="px-4 py-3 text-gray-900">
                                              {tx.cg2Clicked || 'N/A'}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>

                                {/* 2. SDP Response */}
                                <div>
                                  <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                                    2. SDP Response
                                  </h3>
                                  {tx.sdpResponse ? (
                                    <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                                      <pre className="text-green-400 text-sm whitespace-pre-wrap">
                                        {JSON.stringify(tx.sdpResponse, null, 2)}
                                      </pre>
                                    </div>
                                  ) : (
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                      <p className="text-yellow-800 font-medium">
                                        NO SDP Response received
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* 3. Callback Data */}
                                <div>
                                  <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                                    3. Callback Data
                                  </h3>
                                  {tx.callbackData ? (
                                    <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                                      <pre className="text-blue-400 text-sm whitespace-pre-wrap">
                                        {JSON.stringify(tx.callbackData, null, 2)}
                                      </pre>
                                    </div>
                                  ) : (
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                      <p className="text-red-800 font-medium">
                                        No callback received
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            actionData &&
            'transactions' in actionData && (
              <div className="text-center py-8 text-gray-500">
                <p>No Data Found</p>
              </div>
            )
          )}
        </TabsContent>
      </Tabs>
    </Layout>
  );
}