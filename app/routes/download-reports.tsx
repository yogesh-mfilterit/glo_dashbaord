import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { Form, useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { getSession } from "../lib/session.server";
import Layout from "../components/layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Download, FileText, Calendar, Search } from "lucide-react";
import { AWS_REGION } from "../lib/config";
import { fullAuthGuard } from "~/util/authGuard";

// Server-side loader function
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }
  const userRole = session.get("role") || null;
  const userEmail = session.get("email") || null;
  
  // Only allow admin and operations users to access this page
  if (userRole !== "admin" && userRole !== "operations") {
    return redirect("/cp-download-reports?message=access%20denied");
  }
  
  return json({ userRole, userEmail });
}

// Server-side action function for checking S3 file
export async function action({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  if (!session.has("email")) {
    return redirect("/login?message=login%20required");
  }

  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "checkFile") {
    const selectedDate = formData.get("selectedDate") as string;
    
    if (!selectedDate) {
      return json({ error: "Please select a date" }, { status: 400 });
    }

    try {
      // Transform date from YYYY-MM-DD to YYYYMMDD format
      const dbDate = selectedDate.replace(/-/g, '');
      const filename = `data_dump_${dbDate}.csv`;
      const s3Path = `mtn-nigeria-prod-data-bucket/data_dump/${filename}`;

      // Check if file exists in S3 using AWS SDK
      const { S3Client, HeadObjectCommand } = await import('@aws-sdk/client-s3');
      
      const s3Client = new S3Client({ region: AWS_REGION });

      try {
        await s3Client.send(new HeadObjectCommand({
          Bucket: 'mtn-nigeria-prod-data-bucket',
          Key: `data_dump/${filename}`
        }));

        return json({ 
          success: true, 
          filename, 
          dbDate, 
          s3Path
        });
      } catch (error: any) {
        if (error.name === 'NotFound') {
          return json({ 
            success: false, 
            error: `File not found: ${filename}` 
          });
        }
        throw error;
      }
    } catch (error) {
      console.error('Error checking S3 file:', error);
      return json({ 
        success: false, 
        error: 'Failed to check file availability' 
      }, { status: 500 });
    }
  }



  return json({ error: "Invalid action" }, { status: 400 });
}

export default function DownloadReports() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selectedDate, setSelectedDate] = useState('');
  const { userRole, userEmail } = loaderData;

  const isChecking = navigation.state === "submitting" && 
    navigation.formData?.get("action") === "checkFile";

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Download Reports</h1>
        
        <Tabs defaultValue="cdrs" className="w-full">
          <TabsList className="grid w-full grid-cols-1">
            <TabsTrigger value="cdrs">CDRs</TabsTrigger>
          </TabsList>
          
          <TabsContent value="cdrs" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Call Detail Records (CDRs)
                </CardTitle>
                <CardDescription>
                  Download CDR file by selecting a date, CDR file will contain all records for that date
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Date Selection Form */}
                  <Form method="post" className="flex gap-4 items-end">
                    <input type="hidden" name="action" value="checkFile" />
                    <div className="flex-1">
                      <label htmlFor="selectedDate" className="block text-sm font-medium mb-2">
                        Select Date
                      </label>
                      <Input
                        id="selectedDate"
                        name="selectedDate"
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        required
                        className="w-full"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      disabled={isChecking || !selectedDate}
                      className="flex items-center gap-2"
                    >
                      <Search className="h-4 w-4" />
                      {isChecking ? "Checking..." : "View"}
                    </Button>
                  </Form>

                  {/* Error Display */}
                  {actionData?.error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-red-700">{actionData.error}</p>
                    </div>
                  )}

                  {/* File Found Display */}
                  {actionData?.success && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-green-800">File Found!</h3>
                          <p className="text-sm text-green-600 mt-1">
                            Filename: {actionData.filename}
                          </p>
                        </div>
                        <Button 
                          asChild
                          className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
                        >
                          <a 
                            href={`/download-reports/download?filename=${encodeURIComponent(actionData.filename)}&dbDate=${encodeURIComponent(actionData.dbDate)}`}
                            download
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </a>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
} 