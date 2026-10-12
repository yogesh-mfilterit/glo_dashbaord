import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData, Form, useActionData, useNavigation } from '@remix-run/react';
import Layout from '../components/layout';
import { getAllServiceIds, createServiceId, updateServiceId } from '../lib/dynamodb-serviceid';
import { getAllCPs } from '../lib/dynamodb-cp';
import { useState, useEffect } from 'react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { toast } from 'sonner';
import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  unstable_parseMultipartFormData,
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  type UploadHandler,
} from '@remix-run/node';
import type { UploadHandlerPart } from '@remix-run/node';
import { S3_BUCKET_NAME } from '../lib/config';
import { getSession, commitSession } from '../lib/session.server';
import { logDashboardActivity, getClientIP } from '../lib/dynamodb-log';
import { getUserByEmail, updateUser } from '~/lib/dynamodb-users';
import { DYNAMODB_TABLES } from '~/lib/config';
import { fullAuthGuard } from '~/util/authGuard';
import { generateCsrfToken, validateCsrfToken, validateCsrfFromForm } from '~/lib/csrf.server';
import { createBannerUploadHandler } from '~/lib/upload-validator.server';
import { SECURITY_HEADERS } from '~/lib/security-headers.server';
import { checkQuota, incrementQuota } from '~/lib/quota-limiter.server';
import { saveVersionToS3 } from '../lib/s3-version';
import { S3_VERSION_BUCKET_NAME } from '../lib/config';
import { getNextVersion } from '~/lib/version';
import DOMPurify from 'isomorphic-dompurify';
import { validateNoHtml, validateNumberOnly } from '~/util/validations';

// Script tag validation utility
interface ScriptValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

const ALLOWED_GOOGLE_DOMAINS = [
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
  'googleadservices.com',
];

const ALLOWED_FACEBOOK_DOMAINS = ['facebook.com', 'fbcdn.net', 'facebook.net', 'fb.com'];

const ALLOWED_GOOGLE_PATTERNS = [
  'gtag',
  'ga',
  'google_tag_manager',
  'dataLayer',
  'gtm',
  'google-analytics',
  'googletagmanager',
  'googleadservices',
  'doubleclick',
];

const ALLOWED_FACEBOOK_PATTERNS = ['fbq', '_fbp', '_fbc', 'FB', 'fbAsyncInit', 'facebook', 'fbcdn'];

function validateScriptTags(scriptTags: string): ScriptValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!scriptTags.trim()) {
    return { isValid: true, errors: [], warnings: [] };
  }

  // Parse script tags using regex - only look for proper <script></script> tags
  const scriptTagRegex = /<script[^>]*>(.*?)<\/script>/gis;
  const matches = scriptTags.match(scriptTagRegex);

  if (!matches) {
    errors.push(
      'Invalid script tag format. Script tags must be properly formatted with <script> and </script> tags.',
    );
    return { isValid: false, errors, warnings };
  }

  matches.forEach((match, index) => {
    // Extract script content
    const scriptContent = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');

    // Check if this is an external script (has src attribute)
    const srcMatch = match.match(/src=["']([^"']+)["']/i);

    if (srcMatch) {
      // Validate external script URLs
      const url = srcMatch[1];
      const domain = extractDomain(url);

      if (!isAllowedDomain(domain)) {
        errors.push(
          `Script tag ${index + 1
          }: External script from "${domain}" is not allowed. Only Google and Facebook domains are permitted.`,
        );
      }
    } else {
      // Validate inline script content
      if (!isAllowedInlineScript(scriptContent)) {
        errors.push(
          `Script tag ${index + 1
          }: Inline script content is not allowed. Only Google Analytics, Google Tag Manager, and Facebook Pixel scripts are permitted.`,
        );
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('//') ? `https:${url}` : url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function isAllowedDomain(domain: string): boolean {
  const normalizedDomain = domain.toLowerCase();

  // Check Google domains
  for (const googleDomain of ALLOWED_GOOGLE_DOMAINS) {
    if (normalizedDomain === googleDomain || normalizedDomain.endsWith(`.${googleDomain}`)) {
      return true;
    }
  }

  // Check Facebook domains
  for (const facebookDomain of ALLOWED_FACEBOOK_DOMAINS) {
    if (normalizedDomain === facebookDomain || normalizedDomain.endsWith(`.${facebookDomain}`)) {
      return true;
    }
  }

  return false;
}

function isAllowedInlineScript(content: string): boolean {
  const normalizedContent = content.toLowerCase();

  // Check for Google patterns
  for (const pattern of ALLOWED_GOOGLE_PATTERNS) {
    if (normalizedContent.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check for Facebook patterns
  for (const pattern of ALLOWED_FACEBOOK_PATTERNS) {
    if (normalizedContent.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}
function sanitizePlainText(value: string): string {
  return DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
}
function sanitizeScriptTags(raw: string): string {
  if (!raw.trim()) return '';
  const scriptTagRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  return raw.replace(scriptTagRegex, (_, attrs, body) => {
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
    const hasAsync = /\basync\b/i.test(attrs);
    const hasDefer = /\bdefer\b/i.test(attrs);

    let safeAttrs = '';
    if (srcMatch) safeAttrs += ` src="${srcMatch[1]}"`;
    if (hasAsync) safeAttrs += ' async';
    if (hasDefer) safeAttrs += ' defer';
    if (typeMatch) safeAttrs += ` type="${typeMatch[1]}"`;

    return `<script${safeAttrs}>${body}</script>`;
  });
}
function formatDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleString();
}

function truncateText(text: string, maxLength: number = 15): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

const s3 = new S3Client({ region: 'ap-south-1' });
const BUCKET_NAME = S3_BUCKET_NAME;

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const userRole = session.get('role') || null;
  const userCpid = session.get('cpid');
  const userCpName = session.get('cpName');
  const viewFilters = session.get('viewFilters');

  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect('/login');
  }

  const csrfToken = generateCsrfToken(session);
  const sessionCookie = await commitSession(session);

  const [allServiceIds, cps] = await Promise.all([getAllServiceIds(), getAllCPs()]);
  const securityHeaders = { ...SECURITY_HEADERS, 'Set-Cookie': sessionCookie };

  // If user is CP role, validate they have proper CP configuration
  if (userRole === 'cp') {
    if (!userCpid) {
      return json(
        { serviceIds: [], cps: [], userRole, userCpid: null, userCpName: null, viewFilters: null, csrfToken, error: 'CP configuration not found' },
        { headers: securityHeaders }
      );
    }

    let serviceIds = allServiceIds;
    if (viewFilters && Array.isArray(viewFilters) && viewFilters.length > 0) {
      serviceIds = allServiceIds.filter((sid: any) => viewFilters.includes(sid.serviceId));
    } else {
      serviceIds = allServiceIds.filter((sid: any) => sid.cpId === userCpid);
    }

    return json(
      { serviceIds, cps, userRole, userCpid, userCpName, viewFilters, csrfToken, userEmail: session.get('email') || null },
      { headers: securityHeaders }
    );
  }

  return json(
    { serviceIds: allServiceIds, cps, userRole, userCpid, userCpName: null, viewFilters: null, csrfToken, userEmail: session.get('email') || null },
    { headers: securityHeaders }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  // Auth guard — reject unauthenticated requests
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  // Check user session and role
  const session = await getSession(request);
  const userRole = session.get('role');
  const userCpid = session.get('cpid');
  const viewFilters = session.get('viewFilters');
  const userEmail = session.get('email');
  const user_ip = getClientIP(request);

  // Validate Origin/Referer to block cross-site requests
  const originValid = await validateCsrfToken(request, session);
  if (!originValid) {
    return json({ error: 'Invalid request origin' }, { status: 403 });
  }

  // Operations role is view-only — block all mutations
  if (userRole === 'operations') {
    return json({ error: 'Operations role does not have permission to create or update' }, { status: 403 });
  }

  if (request.method.toLowerCase() === 'post') {
    const uploadHandler = unstable_composeUploadHandlers(
      createBannerUploadHandler(s3, BUCKET_NAME, 'service-banners'),
      unstable_createMemoryUploadHandler(),
    );

    let formData: FormData;
    try {
      formData = await unstable_parseMultipartFormData(request, uploadHandler);
    } catch (err: any) {
      return json({ error: err?.message || 'Invalid file upload' }, { status: 400 });
    }

    // Validate CSRF token from form
    if (!validateCsrfFromForm(formData, session)) {
      return json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    const intent = formData.get('intent');
    const serviceId = (formData.get('serviceId') as string).trim();
    const cpId = formData.get('cpId') as string;

    // ── FIX: sanitize plain-text fields to strip any injected HTML ────────
    const serviceIdName = sanitizePlainText(formData.get('serviceIdName') as string);
    const serviceIdText = sanitizePlainText(formData.get('serviceIdText') as string);
    const serviceIdError = validateNumberOnly(serviceId);
    const serviceIdNameError = validateNoHtml(serviceIdName);
    const serviceIdTextError = validateNoHtml(serviceIdText);

    if (serviceIdError || serviceIdNameError || serviceIdTextError) {
      return json(
        {
          error:
            serviceIdError ||
            serviceIdNameError ||
            serviceIdTextError,
        },
        { status: 400 }
      );
    }

    const rawScriptTags = (formData.get('scriptTags') as string) ?? '';
    const rawBodyScriptTags = (formData.get('bodyScriptTags') as string) ?? '';
    if (rawScriptTags.trim()) {
      const validation = validateScriptTags(rawScriptTags);
      if (!validation.isValid) {
        return json(
          { error: `Invalid script tags: ${validation.errors.join(' | ')}` },
          { status: 400 },
        );
      }
    }

    if (rawBodyScriptTags.trim()) {
      const validation = validateScriptTags(rawBodyScriptTags);
      if (!validation.isValid) {
        return json(
          { error: `Invalid body script tags: ${validation.errors.join(' | ')}` },
          { status: 400 },
        );
      }
    }
    const scriptTags = sanitizeScriptTags(rawScriptTags);
    const bodyScriptTags = sanitizeScriptTags(rawBodyScriptTags);

    const bannerData = formData.get('banner');
    const bannerUrl = bannerData instanceof File ? null : (bannerData as string | null);

    console.log(
      '[ACTION-STEP] serviceId:',
      serviceId,
      'cpId:',
      cpId,
      'serviceIdName:',
      serviceIdName,
      'serviceIdText:',
      serviceIdText,
      'scriptTags:',
      scriptTags,
      'bodyScriptTags:',
      bodyScriptTags,
    );


    // For CP users, ensure they have proper CP configuration
    if (userRole === 'cp') {
      if (!userCpid) {
        return json(
          { error: 'CP configuration not found. Please contact administrator.' },
          { status: 403 },
        );
      }

      // For updates, ensure CP can only update their own service IDs
      if (intent === 'update') {
        const allServiceIds = await getAllServiceIds();
        const cpServiceIds = allServiceIds
          .filter((sid: any) => sid.cpId === userCpid)
          .map((sid: any) => sid.serviceId);

        if (!cpServiceIds.includes(serviceId)) {
          return json(
            { error: 'You can only update service IDs that belong to your CP.' },
            { status: 500 },
          );
        }
      }

      // For creates, ensure CP can only create service IDs for their own CPID
      if (intent === 'create' && cpId !== userCpid) {
        return json({ error: 'You can only create service IDs for your own CP.' }, { status: 500 });
      }
    }

    let finalBannerUrl = bannerUrl;
    if (typeof bannerUrl === 'string' && bannerUrl && serviceId) {
      // Extract the original filename from the S3 URL
      const urlParts = bannerUrl.split('/');
      const originalFilename = urlParts[urlParts.length - 1];
      const ext = originalFilename.split('.').pop();
      //const newKey = `service-banners/${serviceId}.${ext}`;
      const originalServiceIdData = formData.get('originalServiceId') as string;
      const originalServiceId = originalServiceIdData ? JSON.parse(originalServiceIdData) : null;
      const currentVersion = getNextVersion(originalServiceId?.version || 'v_0.00');
      const newKey = `service-banners/${serviceId}/${currentVersion}.${ext}`;
      const R2_ACCOUNT_ID = "139087e10f57fa8607819419a2a2309e";
      const R2_ACCESS_KEY_ID = "a787b7861a15facfe4b37d1341a93991";
      const R2_SECRET_ACCESS_KEY = "e9807b67669da368431db05e2fb0d41b3cb6f3ecd188f58a4f3588581be7febf";
      const R2_BUCKET_NAME = "static-content";

      const r2 = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
      });

      try {
        // Copy the object to the new key
        await s3.send(
          new CopyObjectCommand({
            Bucket: BUCKET_NAME,
            CopySource: `${BUCKET_NAME}/service-banners/${originalFilename}`,
            Key: newKey,
          }),
        );

        const object = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET_NAME, Key: newKey }),
        );
        console.log("S3 Object ContentType:464", newKey);
        console.log("S3 Object ContentType:", newKey);
        const bytes = await object.Body?.transformToByteArray();

        const r2Key = `service-banners/${serviceId}.${ext}`;
        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key,
            Body: Buffer.from(bytes!),
            ContentType: object.ContentType,
          }),
        );
        // Delete the original upload
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `service-banners/${originalFilename}`,
          }),
        );
        finalBannerUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${newKey}`;

      } catch (err) {
        console.error('[ACTION-STEP] Error copying or deleting S3 object:', err);
      }
    }
    if (intent === 'create') {
      const quota = await checkQuota(userEmail, 'create_service_id');
      if (!quota.allowed) return json({ error: quota.message }, { status: 429 });
      try {

        const serviceIdData = finalBannerUrl
          ? {
            serviceId,
            cpId,
            serviceIdName,
            serviceIdText,
            scriptTags,
            bodyScriptTags,
            bannerUrl: finalBannerUrl,
          }
          : { serviceId, cpId, serviceIdName, serviceIdText, scriptTags, bodyScriptTags };
        const newServiceId = await createServiceId(serviceIdData);
        incrementQuota(userEmail, 'create_service_id');

        await saveVersionToS3(S3_VERSION_BUCKET_NAME, 'service-ids', serviceId, newServiceId);
        // Log the create activity
        await logDashboardActivity(
          DYNAMODB_TABLES.SERVICE_ID_DETAILS,
          'CREATE_SERVICE_ID',
          //serviceIdData,
          newServiceId,
          user_ip,
          userEmail,
        );

        if (userRole === 'cp') {
          let updatedServiceIds = null;
          try {
            let manageServiceIds = await getUserByEmail(userEmail);

            if (manageServiceIds) {
              if (!Array.isArray(manageServiceIds.serviceIds)) {
                manageServiceIds.serviceIds = [];
              }
              if (!manageServiceIds.serviceIds.includes(serviceId)) {
                manageServiceIds.serviceIds.push(serviceId);
                // Update the user's serviceIds in the database
                await updateUser(userEmail, { serviceIds: manageServiceIds.serviceIds });
                console.log(
                  '[ACTION-STEP] Updated user serviceIds for CP:',
                  userEmail,
                  'New serviceId:',
                  serviceId,
                );

                updatedServiceIds = manageServiceIds.serviceIds;
              } else {

                updatedServiceIds = manageServiceIds.serviceIds;
              }
            } else {
              console.error('[ACTION-STEP] User not found:', userEmail);
            }
          } catch (error) {
            console.error('[ACTION-STEP] Error updating user serviceIds:', error);
            // Don't throw here as the main serviceId creation should still succeed
          }

          // Update session viewFilters outside try-catch to ensure it always happens
          if (updatedServiceIds) {
            session.set('viewFilters', updatedServiceIds);

          }
        }

        // Debug session before commit
        console.log('[ACTION-STEP] Session before commit:', {
          viewFilters: session.get('viewFilters'),
          userRole: session.get('role'),
          userEmail: session.get('email'),
        });

        const sessionCookie = await commitSession(session);


        // Redirect to refresh the page and load updated session data
        return redirect('/service-ids?message=Service%20ID%20created%20successfully', {
          headers: {
            'Set-Cookie': sessionCookie,
          },
        });
      } catch (err) {
        console.error('[ACTION-STEP] Error in create intent:', err);
        return json(
          { error: 'Failed to upload banner or save Service ID.', details: String(err) },
          { status: 500 },
        );
      }
    } else if (intent === 'update') {
      const updateQuota = await checkQuota(userEmail, 'update');
      if (!updateQuota.allowed) return json({ error: updateQuota.message }, { status: 429 });
      try {
        const originalServiceIdData = formData.get('originalServiceId') as string;
        const originalServiceId = originalServiceIdData ? JSON.parse(originalServiceIdData) : null;

        // Compare current values with original values to determine which fields have changed
        const updatePayload: any = {};

        // Check each field and only include it if it has changed
        if (cpId !== originalServiceId?.cpId) {
          updatePayload.cpId = cpId;
        }
        if (serviceIdName !== originalServiceId?.serviceIdName) {
          updatePayload.serviceIdName = serviceIdName;
        }
        if (serviceIdText !== originalServiceId?.serviceIdText) {
          updatePayload.serviceIdText = serviceIdText;
        }
        if (scriptTags !== originalServiceId?.scriptTags) {
          updatePayload.scriptTags = scriptTags;
        }
        if (bodyScriptTags !== originalServiceId?.bodyScriptTags) {
          updatePayload.bodyScriptTags = bodyScriptTags;
        }

        // Only include bannerUrl if a new banner is provided
        console.log(
          '[ACTION-STEP] Banner check - bannerUrl:',
          bannerUrl,
          'finalBannerUrl:',
          finalBannerUrl,
        );
        if (bannerUrl && finalBannerUrl) {
          updatePayload.bannerUrl = finalBannerUrl;
        }

        // Only proceed with update if there are fields to update
        if (Object.keys(updatePayload).length > 0) {

          const updatedServiceId = await updateServiceId(serviceId, updatePayload);
          incrementQuota(userEmail, 'update');
          console.log(
            '[ACTION-STEP] ServiceId updated in DynamoDB with fields:',
            Object.keys(updatePayload),
          );
          if (updatedServiceId) {
            await saveVersionToS3(S3_VERSION_BUCKET_NAME, 'service-ids', serviceId, updatedServiceId);
            updatePayload.version = updatedServiceId.version;
          }




          // Log the update activity
          await logDashboardActivity(
            DYNAMODB_TABLES.SERVICE_ID_DETAILS,
            'UPDATE_SERVICE_ID',
            { serviceId, ...updatePayload },
            user_ip,
            userEmail,
          );
        } else {

        }
        return json({ success: 'updated' });
      } catch (err) {
        console.error('[ACTION-STEP] Error in update intent:', err);
        return json(
          { error: 'Failed to update Service ID.', details: String(err) },
          { status: 500 },
        );
      }
    }
    return null;
  }
  return null;
}

export default function ServiceIds() {
  const { serviceIds, cps, userRole, userCpid, userCpName, viewFilters, userEmail, csrfToken, error } =
    useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [editServiceId, setEditServiceId] = useState<any | null>(null);
  const [originalServiceId, setOriginalServiceId] = useState<any | null>(null);
  const [form, setForm] = useState({
    serviceId: '',
    cpId: '',
    serviceIdName: '',
    serviceIdText: '',
    scriptTags: '',
    bodyScriptTags: '',
  });
  const [errors, setErrors] = useState({
    serviceId: '',
    serviceIdName: '',
    serviceIdText: '',
  });
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [cpNameFilter, setCpNameFilter] = useState('');
  const [serviceIdFilter, setServiceIdFilter] = useState('');
  const [selectedBanner, setSelectedBanner] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewServiceId, setViewServiceId] = useState<any | null>(null);
  const [scriptValidation, setScriptValidation] = useState<ScriptValidationResult>({
    isValid: true,
    errors: [],
    warnings: [],
  });
  const [bodyScriptValidation, setBodyScriptValidation] = useState<ScriptValidationResult>({
    isValid: true,
    errors: [],
    warnings: [],
  });
  const ITEMS_PER_PAGE = 20;
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Scroll to top on page load / refresh
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Determine if user has view-only access
  // const isViewOnly = userRole === "operations" || (userRole === "cp" && viewFilters && Array.isArray(viewFilters) && viewFilters.length > 0);
  const isViewOnly = userRole === 'operations';
  // Filter service IDs based on CP name filter
  const filteredServiceIds = serviceIds.filter((sid: any) => {
    //if (!cpNameFilter) return true;
    const cp = cps.find((cp: any) => cp.cpid === sid.cpId);
    const serviceIdMatch = !serviceIdFilter ||
      sid.serviceId?.toLowerCase().includes(serviceIdFilter.toLowerCase()) ||
      sid.serviceIdName?.toLowerCase().includes(serviceIdFilter.toLowerCase());
    if (!cp) return false;
    return cp.cpName.toLowerCase().includes(cpNameFilter.toLowerCase()) && serviceIdMatch;
  });

  // Reset visible count and scroll flag when filter changes
  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
    setHasScrolled(false);
  }, [cpNameFilter, serviceIdFilter]);

  // Infinite scroll: listen to window scroll and load more rows near bottom
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 100) setHasScrolled(true);
      const scrolledToBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300;
      if (scrolledToBottom) {
        setVisibleCount((prev) => {
          if (prev < filteredServiceIds.length) {
            return Math.min(prev + ITEMS_PER_PAGE, filteredServiceIds.length);
          }
          return prev;
        });
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [filteredServiceIds.length]);

  useEffect(() => {
    if (navigation.state === 'idle' && actionData) {
      if ('success' in actionData && actionData.success === 'created') {
        toast('ServiceId created successfully!', { className: 'bg-green-500 text-white' });
        setForm({
          serviceId: '',
          cpId: '',
          serviceIdName: '',
          serviceIdText: '',
          scriptTags: '',
          bodyScriptTags: '',
        });
        setBannerFile(null);
        setScriptValidation({ isValid: true, errors: [], warnings: [] });
        setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
      } else if ('success' in actionData && actionData.success === 'updated') {
        toast('ServiceId updated successfully!', { className: 'bg-green-500 text-white' });
        setEditServiceId(null);
        setOriginalServiceId(null);
        setEditModalOpen(false);
        setForm({
          serviceId: '',
          cpId: '',
          serviceIdName: '',
          serviceIdText: '',
          scriptTags: '',
          bodyScriptTags: '',
        });
        setBannerFile(null);
        setScriptValidation({ isValid: true, errors: [], warnings: [] });
      } else if ('error' in actionData) {
        toast(actionData.error, { className: 'bg-red-500 text-white' });
      }
    }
  }, [actionData, navigation.state]);

  const handleEdit = (sid: any) => {
    setEditServiceId(sid);
    setOriginalServiceId(sid);
    const scriptTags = sid.scriptTags || '';
    const bodyScriptTags = sid.bodyScriptTags || '';
    setForm({
      serviceId: sid.serviceId,
      cpId: sid.cpId,
      serviceIdName: sid.serviceIdName,
      serviceIdText: sid.serviceIdText || '',
      scriptTags,
      bodyScriptTags,
    });

    // Validate existing script tags
    if (scriptTags.trim()) {
      setScriptValidation(validateScriptTags(scriptTags));
    } else {
      setScriptValidation({ isValid: true, errors: [], warnings: [] });
    }

    // Validate existing body script tags
    if (bodyScriptTags.trim()) {
      setBodyScriptValidation(validateScriptTags(bodyScriptTags));
    } else {
      setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
    }

    setEditModalOpen(true);
  };

  const handleView = (sid: any) => {
    setEditServiceId(sid);
    setOriginalServiceId(sid);
    const scriptTags = sid.scriptTags || '';
    const bodyScriptTags = sid.bodyScriptTags || '';
    setForm({
      serviceId: sid.serviceId,
      cpId: sid.cpId,
      serviceIdName: sid.serviceIdName,
      serviceIdText: sid.serviceIdText || '',
      scriptTags,
      bodyScriptTags,
    });

    // Validate existing script tags
    if (scriptTags.trim()) {
      setScriptValidation(validateScriptTags(scriptTags));
    } else {
      setScriptValidation({ isValid: true, errors: [], warnings: [] });
    }

    // Validate existing body script tags
    if (bodyScriptTags.trim()) {
      setBodyScriptValidation(validateScriptTags(bodyScriptTags));
    } else {
      setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
    }

    // Scroll to top of the page when view form opens
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleViewModal = (sid: any) => {
    setViewServiceId(sid);
  };

  const handleCancel = () => {
    setEditServiceId(null);
    setOriginalServiceId(null);
    setEditModalOpen(false);
    setForm({
      serviceId: '',
      cpId: '',
      serviceIdName: '',
      serviceIdText: '',
      scriptTags: '',
      bodyScriptTags: '',
    });
    setBannerFile(null);
    setScriptValidation({ isValid: true, errors: [], warnings: [] });
    setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast('File size exceeds 5 MB limit', { className: 'bg-red-500 text-white' });
        e.target.value = '';
        setBannerFile(null);
        return;
      }
      setBannerFile(file);
    } else {
      setBannerFile(null);
    }
  };
  const handleChange = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));

    let error = '';

    if (field === 'serviceId') {
      error = validateNumberOnly(value);
    }

    if (field === 'serviceIdName') {
      error = validateNoHtml(value);
    }

    if (field === 'serviceIdText') {
      error = validateNoHtml(value);
    }

    setErrors((prev) => ({
      ...prev,
      [field]: error,
    }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!bannerFile && !editServiceId) {
      e.preventDefault();
      toast('Please select a banner image', { className: 'bg-red-500 text-white' });
      return;
    }
    if (bannerFile && bannerFile.size > 5 * 1024 * 1024) {
      e.preventDefault();
      toast('File size exceeds 5 MB limit', { className: 'bg-red-500 text-white' });
      return;
    }

    // Validate script tags before submission
    if (form.scriptTags.trim()) {
      const validation = validateScriptTags(form.scriptTags);
      if (!validation.isValid) {
        e.preventDefault();
        toast('Script tags validation failed. Please check the errors below.', {
          className: 'bg-red-500 text-white',
        });
        return;
      }
    }

    // Validate body script tags before submission
    if (form.bodyScriptTags.trim()) {
      const validation = validateScriptTags(form.bodyScriptTags);
      if (!validation.isValid) {
        e.preventDefault();
        toast('Body script tags validation failed. Please check the errors below.', {
          className: 'bg-red-500 text-white',
        });
        return;
      }
    }

    // Trim the serviceId field before submission
    const trimmedServiceId = form.serviceId.trim();
    if (trimmedServiceId !== form.serviceId) {
      setForm((f) => ({ ...f, serviceId: trimmedServiceId }));
    }
  };

  const handleShowForm = () => setShowForm(true);
  const handleHideForm = () => {
    setShowForm(false);
    setForm({
      serviceId: '',
      cpId: '',
      serviceIdName: '',
      serviceIdText: '',
      scriptTags: '',
      bodyScriptTags: '',
    });
    setBannerFile(null);
    setScriptValidation({ isValid: true, errors: [], warnings: [] });
    setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
  };

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <strong>Error:</strong> {error}. Please contact your administrator.
        </div>
      )}
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-4">
        {userRole === 'cp' ? 'My Service IDs' : 'Service IDs'}
        {!isViewOnly && (userRole === 'admin' || userRole === 'cp') && (
          <Button
            type="button"
            size="icon"
            onClick={handleShowForm}
            className="rounded-full p-0 w-8 h-8 flex items-center justify-center"
          >
            <span className="text-2xl leading-none">+</span>
          </Button>
        )}
      </h1>
      {showForm && (
        <div className="mb-8">
          {userRole === 'operations' ? (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex flex-col">
                  <label htmlFor="serviceId" className="text-sm font-medium mb-1">
                    Service ID
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.serviceId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label htmlFor="cpId" className="text-sm font-medium mb-1">
                    Content Partner (CP)
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {(() => {
                      const cp = cps.find((cp: any) => cp.cpid === form.cpId);
                      return cp ? `${cp.cpName} (${form.cpId})` : form.cpId;
                    })()}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label htmlFor="serviceIdName" className="text-sm font-medium mb-1">
                    ServiceId Name
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.serviceIdName}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label htmlFor="serviceIdText" className="text-sm font-medium mb-1">
                    ServiceId Text
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 min-h-[60px] whitespace-pre-wrap">
                    {truncateText(form.serviceIdText || '-')}
                  </div>
                </div>
              </div>
              <div className="flex flex-col">
                <label htmlFor="scriptTags" className="text-sm font-medium mb-1">
                  Script Tags
                </label>
                <pre className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 min-h-[60px] whitespace-pre-wrap text-sm font-mono overflow-auto">
                  {truncateText(form.scriptTags || '-')}
                </pre>
              </div>
              <div className="flex flex-col">
                <label htmlFor="bodyScriptTags" className="text-sm font-medium mb-1">
                  Body Script Tags
                </label>
                <pre className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 min-h-[60px] whitespace-pre-wrap text-sm font-mono overflow-auto">
                  {truncateText(form.bodyScriptTags || '-')}
                </pre>
              </div>
              <div className="flex flex-col">
                <label htmlFor="banner" className="text-sm font-medium mb-1">
                  Banner Image
                </label>
                {editServiceId?.bannerUrl ? (
                  <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                    <img
                      src={editServiceId.bannerUrl}
                      alt="Banner"
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  </div>
                ) : (
                  <div className="w-80 h-40 border rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 flex items-center justify-center">
                    No Image
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <Form
              method="post"
              className="space-y-4"
              encType="multipart/form-data"
              onSubmit={handleSubmit}
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <div className="flex gap-4">
                <div className="flex flex-col flex-2">
                  <div className="flex items-center gap-1 mb-1">
                    <label htmlFor="serviceId" className="text-sm font-medium">
                      Service ID
                    </label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-gray-400 hover:text-gray-600 text-sm"
                          >
                            ?
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Enter subscriptionId exactly as configured in MTN SDP</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="serviceId"
                    name="serviceId"
                    placeholder="Service ID"
                    value={form.serviceId}
                    onChange={(e) => handleChange('serviceId', e.target.value)}
                    required
                    disabled={!!editServiceId}
                    className="w-full"
                  />
                  {errors.serviceId && (
                    <p className="text-red-500 text-sm">{errors.serviceId}</p>
                  )}
                </div>
                <div className="flex flex-col">
                  <label htmlFor="cpId" className="text-sm font-medium mb-1">
                    Content Partner (CP)
                  </label>
                  {userRole === 'cp' ? (
                    <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      {userCpName} ({userCpid})
                      <input type="hidden" name="cpId" value={userCpid} />
                    </div>
                  ) : (
                    <select
                      id="cpId"
                      name="cpId"
                      value={form.cpId}
                      onChange={(e) => setForm((f) => ({ ...f, cpId: e.target.value }))}
                      required
                      className="border rounded px-2 py-1"
                    >
                      <option value="">Select CP</option>
                      {cps.map((cp: any) => (
                        <option key={cp.cpid} value={cp.cpid}>
                          {cp.cpName} ({cp.cpid})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 mb-1">
                    <label htmlFor="serviceIdName" className="text-sm font-medium">
                      ServiceId Name
                    </label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-gray-400 hover:text-gray-600 text-sm"
                          >
                            ?
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>This will be used as the title in landing page</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="serviceIdName"
                    name="serviceIdName"
                    placeholder="ServiceId Name"
                    value={form.serviceIdName}
                    onChange={(e) => handleChange('serviceIdName', e.target.value)}
                    required
                  />
                  {errors.serviceIdName && (
                    <p className="text-red-500 text-sm">{errors.serviceIdName}</p>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 mb-1">
                    <label htmlFor="serviceIdText" className="text-sm font-medium">
                      ServiceId Text
                    </label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-gray-400 hover:text-gray-600 text-sm"
                          >
                            ?
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>This will be used as the content of the landing page</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Textarea
                    id="serviceIdText"
                    name="serviceIdText"
                    placeholder="ServiceId Text"
                    value={form.serviceIdText}
                    onChange={(e) => handleChange('serviceIdText', e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                  {errors.serviceIdText && (
                    <p className="text-red-500 text-sm">{errors.serviceIdText}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1 mb-1">
                  <label htmlFor="scriptTags" className="text-sm font-medium">
                    Script Tags (Optional)
                    {form.scriptTags && (
                      <span
                        className={`ml-2 text-xs ${scriptValidation.isValid ? 'text-green-600' : 'text-red-600'
                          }`}
                      >
                        {scriptValidation.isValid ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-gray-400 hover:text-gray-600 text-sm">
                          ?
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Google or Facebook pixels which are meant to be entered in &lt;head&gt;
                          section of page
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Textarea
                  id="scriptTags"
                  name="scriptTags"
                  placeholder="Enter script tags (e.g., Google Analytics, Facebook Pixel)"
                  value={form.scriptTags}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setForm((f) => ({ ...f, scriptTags: newValue }));
                    if (newValue.trim()) {
                      setScriptValidation(validateScriptTags(newValue));
                    } else {
                      setScriptValidation({ isValid: true, errors: [], warnings: [] });
                    }
                  }}
                  rows={4}
                  className={`resize-none ${form.scriptTags && !scriptValidation.isValid
                    ? 'border-red-500 focus:border-red-500'
                    : form.scriptTags && scriptValidation.isValid
                      ? 'border-green-500 focus:border-green-500'
                      : ''
                    }`}
                />
                <div className="text-xs text-gray-500 mt-1">
                  <p className="mb-1">Allowed script types:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      <strong>External scripts:</strong> Only from Google and Facebook domains (must
                      include src attribute)
                    </li>
                    <li>
                      <strong>Inline scripts:</strong> Only Google Analytics, Google Tag Manager,
                      and Facebook Pixel code
                    </li>
                  </ul>
                  <p className="mt-2">
                    Example: &lt;script async
                    src="https://www.googletagmanager.com/gtag/js?id=TAG_ID"&gt;&lt;/script&gt;
                  </p>
                </div>
                {scriptValidation.errors.length > 0 && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                    <p className="font-medium text-red-800 mb-1">Validation Errors:</p>
                    <ul className="list-disc list-inside space-y-1 text-red-700">
                      {scriptValidation.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {scriptValidation.warnings.length > 0 && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                    <p className="font-medium text-yellow-800 mb-1">Warnings:</p>
                    <ul className="list-disc list-inside space-y-1 text-yellow-700">
                      {scriptValidation.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1 mb-1">
                  <label htmlFor="bodyScriptTags" className="text-sm font-medium">
                    Body Script Tags (Optional)
                    {form.bodyScriptTags && (
                      <span
                        className={`ml-2 text-xs ${bodyScriptValidation.isValid ? 'text-green-600' : 'text-red-600'
                          }`}
                      >
                        {bodyScriptValidation.isValid ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-gray-400 hover:text-gray-600 text-sm">
                          ?
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Google or Facebook pixels which are meant to be entered in &lt;body&gt;
                          section of landing page
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Textarea
                  id="bodyScriptTags"
                  name="bodyScriptTags"
                  placeholder="Enter body script tags (e.g., Google Analytics, Facebook Pixel)"
                  value={form.bodyScriptTags}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setForm((f) => ({ ...f, bodyScriptTags: newValue }));
                    if (newValue.trim()) {
                      setBodyScriptValidation(validateScriptTags(newValue));
                    } else {
                      setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
                    }
                  }}
                  rows={4}
                  className={`resize-none ${form.bodyScriptTags && !bodyScriptValidation.isValid
                    ? 'border-red-500 focus:border-red-500'
                    : form.bodyScriptTags && bodyScriptValidation.isValid
                      ? 'border-green-500 focus:border-green-500'
                      : ''
                    }`}
                />
                <div className="text-xs text-gray-500 mt-1">
                  <p className="mb-1">Allowed script types:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      <strong>External scripts:</strong> Only from Google and Facebook domains (must
                      include src attribute)
                    </li>
                    <li>
                      <strong>Inline scripts:</strong> Only Google Analytics, Google Tag Manager,
                      and Facebook Pixel code
                    </li>
                  </ul>
                  <p className="mt-2">
                    Example: &lt;script async
                    src="https://www.googletagmanager.com/gtag/js?id=TAG_ID"&gt;&lt;/script&gt;
                  </p>
                </div>
                {bodyScriptValidation.errors.length > 0 && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                    <p className="font-medium text-red-800 mb-1">Validation Errors:</p>
                    <ul className="list-disc list-inside space-y-1 text-red-700">
                      {bodyScriptValidation.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {bodyScriptValidation.warnings.length > 0 && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                    <p className="font-medium text-yellow-800 mb-1">Warnings:</p>
                    <ul className="list-disc list-inside space-y-1 text-yellow-700">
                      {bodyScriptValidation.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1 mb-1">
                  <label htmlFor="banner" className="text-sm font-medium">
                    Banner Image {!editServiceId && <span className="text-red-500">*</span>}
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-gray-400 hover:text-gray-600 text-sm">
                          ?
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>The banner image shown on landing page</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <input
                  id="banner"
                  name="banner"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleFileChange}
                  className="border rounded px-2 py-1"
                  required={!editServiceId}
                />
                {bannerFile && (
                  <p className="text-sm text-gray-600 mt-1">
                    Selected: {bannerFile.name} ({Math.round(bannerFile.size / 1024)} KB)
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">The image should be of 320x 160 px</p>
              </div>
              {editServiceId && (
                <input type="hidden" name="serviceId" value={editServiceId.serviceId} />
              )}
              {originalServiceId && (
                <input
                  type="hidden"
                  name="originalServiceId"
                  value={JSON.stringify(originalServiceId)}
                />
              )}
              <div className="flex gap-2">
                <Button type="submit" name="intent" disabled={!!errors.serviceId || !!errors.serviceIdName || !!errors.serviceIdText} value={editServiceId ? 'update' : 'create'}>
                  {navigation.state === 'submitting'
                    ? editServiceId
                      ? 'Updating...'
                      : 'Creating...'
                    : editServiceId
                      ? 'Update ServiceId'
                      : 'Create ServiceId'}
                </Button>
                {(editServiceId || showForm) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={editServiceId ? handleCancel : handleHideForm}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </Form>
          )}
        </div>
      )}
      <div>
        {/* <h2 className="text-xl font-semibold mb-2">
          {userRole === "cp" ? "My Service IDs" : "All Service IDs"}
        </h2> */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center gap-3">
          <h2 className="text-xl font-semibold">
            {userRole === 'cp' ? 'My Service IDs' : 'All Service IDs'}
          </h2>

          <div className="flex gap-2 text-sm font-normal">
            <span className="px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              Service IDs:
              <b> {new Set(serviceIds.map((sid: any) => sid.serviceId)).size}</b>
            </span>

            <span className="px-2 py-1 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              Aggregators
              <b> {new Set(serviceIds.map((sid: any) => sid.cpId)).size}</b>
            </span>
          </div>
        </div>

        {/* CP Name Filter - Only show for non-CP users */}
        {userRole !== 'cp' && (
          <div className="mb-4 flex flex-row gap-5">
            <div className="mb-4">
              <label htmlFor="cpNameFilter" className="block text-sm font-medium text-gray-700 mb-2">
                Filter by CP Name
              </label>
              <Input
                id="cpNameFilter"
                type="text"
                placeholder="Enter CP name to filter..."
                value={cpNameFilter}
                onChange={(e) => setCpNameFilter(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div>
              <label htmlFor="serviceIdFilter" className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Service ID or Service ID Name
              </label>
              <Input
                id="serviceIdFilter"
                type="text"
                placeholder="Enter Service ID or name to filter..."
                value={serviceIdFilter}
                onChange={(e) => setServiceIdFilter(e.target.value)}
                className="max-w-md"
              />
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="px-2 py-1 border">Service ID</th>
                <th className="px-2 py-1 border whitespace-nowrap">Aggregators (Node IDs)</th>
                <th className="px-2 py-1 border">ServiceId Name</th>
                <th className="px-2 py-1 border">ServiceId Text</th>
                <th className="px-2 py-1 border">Script Tags</th>
                <th className="px-2 py-1 border">Body Script Tags</th>
                <th className="px-2 py-1 border">Banner</th>
                <th className="px-2 py-1 border">Created At</th>
                {userRole !== 'cp' && <th className="px-2 py-1 border">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredServiceIds && filteredServiceIds.length > 0 ? (
                filteredServiceIds.slice(0, visibleCount).map((sid: any) => {
                  const cp = cps.find((cp: any) => cp.cpid === sid.cpId);
                  return (
                    <tr
                      key={sid.serviceId}
                      className="hover:bg-yellow-50 transition-colors duration-200"
                    >
                      <td className="px-2 py-1 border">
                        <button
                          type="button"
                          onClick={() => handleViewModal(sid)}
                          className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                        >
                          {sid.serviceId}
                        </button>
                      </td>
                      <td className="px-2 py-1 border">{cp ? cp.cpName : sid.cpId}</td>
                      <td className="px-2 py-1 border">{sid.serviceIdName}</td>
                      <td className="px-2 py-1 border">
                        {sid.serviceIdText && sid.serviceIdText.length > 12 ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">
                                  {truncateText(sid.serviceIdText)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md">
                                <div className="whitespace-pre-wrap text-sm">
                                  {sid.serviceIdText}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          sid.serviceIdText || '-'
                        )}
                      </td>
                      <td className="px-2 py-1 border">
                        {sid.scriptTags ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-green-600 font-medium">
                                  ✓ Scripts
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md">
                                <div className="whitespace-pre-wrap text-sm">{sid.scriptTags}</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-2 py-1 border">
                        {sid.bodyScriptTags ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-green-600 font-medium">
                                  ✓ Body Scripts
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md">
                                <div className="whitespace-pre-wrap text-sm">
                                  {sid.bodyScriptTags}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-2 py-1 border">
                        {sid.bannerUrl ? (
                          <button
                            type="button"
                            onClick={() => setSelectedBanner(sid.bannerUrl)}
                            className="hover:opacity-80 transition-opacity"
                          >
                            <img
                              src={sid.bannerUrl}
                              alt="Banner"
                              className="h-10 w-auto rounded shadow cursor-pointer"
                            />
                          </button>
                        ) : (
                          <span className="text-gray-400">No Image</span>
                        )}
                      </td>
                      <td className="px-2 py-1 border">{formatDate(sid.createdAt)}</td>
                      {userRole !== 'cp' && (
                        <td className="px-2 py-1 border">
                          <Button
                            size="sm"
                            onClick={() => (isViewOnly ? handleView(sid) : handleEdit(sid))}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            {isViewOnly ? 'View' : 'Edit'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="text-center py-4">
                    {cpNameFilter || serviceIdFilter
                      ? `No Service IDs found for CP name containing "${cpNameFilter}".`
                      : 'No Service IDs found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Infinite scroll status */}
        {filteredServiceIds.length > 0 && hasScrolled && (
          <div className="mt-3 flex flex-col items-center gap-1">
            <p className="text-sm text-gray-500">
              Showing {Math.min(visibleCount, filteredServiceIds.length)} of{' '}
              {filteredServiceIds.length} service IDs
            </p>
            {visibleCount < filteredServiceIds.length && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <svg
                  className="animate-spin h-4 w-4 text-gray-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  ></path>
                </svg>
                Scroll down to load more...
              </div>
            )}
            {visibleCount >= filteredServiceIds.length &&
              filteredServiceIds.length > ITEMS_PER_PAGE && (
                <p className="text-sm text-gray-400">All records loaded</p>
              )}
          </div>
        )}
      </div>

      {/* Banner Modal */}
      <Dialog open={!!selectedBanner} onOpenChange={(open) => !open && setSelectedBanner(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Banner Image</DialogTitle>
          </DialogHeader>
          {selectedBanner && (
            <div className="flex justify-center">
              <img
                src={selectedBanner}
                alt="Banner Full Size"
                className="max-w-full max-h-[70vh] object-contain rounded shadow-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Service ID Modal */}
      <Dialog open={editModalOpen} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Service ID: {editServiceId?.serviceIdName}</DialogTitle>
          </DialogHeader>
          {editServiceId && (
            <Form
              method="post"
              className="space-y-6"
              encType="multipart/form-data"
              onSubmit={handleSubmit}
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              {/* Basic Information Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="flex flex-col">
                    <label htmlFor="edit-serviceId" className="text-sm font-medium mb-1">
                      Service ID
                    </label>
                    <Input
                      id="edit-serviceId"
                      name="serviceId"
                      placeholder="Service ID"
                      value={form.serviceId}
                      onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
                      required
                      disabled={true}
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-cpId" className="text-sm font-medium mb-1">
                      Content Partner (CP)
                    </label>
                    {userRole === 'cp' ? (
                      <div className="border rounded px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                        {userCpName} ({userCpid})
                        <input type="hidden" name="cpId" value={userCpid} />
                      </div>
                    ) : (
                      <select
                        id="edit-cpId"
                        name="cpId"
                        value={form.cpId}
                        onChange={(e) => setForm((f) => ({ ...f, cpId: e.target.value }))}
                        required
                        className="border rounded px-2 py-1"
                      >
                        <option value="">Select CP</option>
                        {cps.map((cp: any) => (
                          <option key={cp.cpid} value={cp.cpid}>
                            {cp.cpName} ({cp.cpid})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-serviceIdName" className="text-sm font-medium mb-1">
                      ServiceId Name
                    </label>
                    <Input
                      id="edit-serviceIdName"
                      name="serviceIdName"
                      placeholder="ServiceId Name"
                      value={form.serviceIdName}
                      onChange={(e) => handleChange('serviceIdName', e.target.value)}
                      required
                    />
                    {errors.serviceIdName && (
                      <p className="text-red-500 text-sm">{errors.serviceIdName}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Text Content Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Text Content
                </h3>
                <div className="flex flex-col">
                  <label htmlFor="edit-serviceIdText" className="text-sm font-medium mb-1">
                    ServiceId Text
                  </label>
                  <Textarea
                    id="edit-serviceIdText"
                    name="serviceIdText"
                    placeholder="ServiceId Text"
                    value={form.serviceIdText}
                    onChange={(e) => handleChange('serviceIdText', e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                  {errors.serviceIdText && (
                    <p className="text-red-500 text-sm">{errors.serviceIdText}</p>
                  )}
                </div>
              </div>

              {/* Script Tags Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Script Tags
                </h3>
                <div className="flex flex-col">
                  <label htmlFor="edit-scriptTags" className="text-sm font-medium mb-1">
                    Script Tags (Optional)
                    <span className="text-xs text-gray-500 ml-2">
                      scripts tags that needs to be put in &lt;head&gt; section of landing page
                    </span>
                    {form.scriptTags && (
                      <span
                        className={`ml-2 text-xs ${scriptValidation.isValid ? 'text-green-600' : 'text-red-600'
                          }`}
                      >
                        {scriptValidation.isValid ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                  </label>
                  <Textarea
                    id="edit-scriptTags"
                    name="scriptTags"
                    placeholder="Enter script tags (e.g., Google Analytics, Facebook Pixel)"
                    value={form.scriptTags}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setForm((f) => ({ ...f, scriptTags: newValue }));
                      if (newValue.trim()) {
                        setScriptValidation(validateScriptTags(newValue));
                      } else {
                        setScriptValidation({ isValid: true, errors: [], warnings: [] });
                      }
                    }}
                    rows={4}
                    className={`resize-none ${form.scriptTags && !scriptValidation.isValid
                      ? 'border-red-500 focus:border-red-500'
                      : form.scriptTags && scriptValidation.isValid
                        ? 'border-green-500 focus:border-green-500'
                        : ''
                      }`}
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    <p className="mb-1">Allowed script types:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>
                        <strong>External scripts:</strong> Only from Google and Facebook domains
                        (must include src attribute)
                      </li>
                      <li>
                        <strong>Inline scripts:</strong> Only Google Analytics, Google Tag Manager,
                        and Facebook Pixel code
                      </li>
                    </ul>
                    <p className="mt-2">
                      Example: &lt;script async
                      src="https://www.googletagmanager.com/gtag/js?id=TAG_ID"&gt;&lt;/script&gt;
                    </p>
                  </div>
                  {scriptValidation.errors.length > 0 && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                      <p className="font-medium text-red-800 mb-1">Validation Errors:</p>
                      <ul className="list-disc list-inside space-y-1 text-red-700">
                        {scriptValidation.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {scriptValidation.warnings.length > 0 && (
                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                      <p className="font-medium text-yellow-800 mb-1">Warnings:</p>
                      <ul className="list-disc list-inside space-y-1 text-yellow-700">
                        {scriptValidation.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Body Script Tags Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Body Script Tags
                </h3>
                <div className="flex flex-col">
                  <label htmlFor="edit-bodyScriptTags" className="text-sm font-medium mb-1">
                    Body Script Tags (Optional)
                    <span className="text-xs text-gray-500 ml-2">
                      script tags to be put in &lt;body&gt; section of landing page
                    </span>
                    {form.bodyScriptTags && (
                      <span
                        className={`ml-2 text-xs ${bodyScriptValidation.isValid ? 'text-green-600' : 'text-red-600'
                          }`}
                      >
                        {bodyScriptValidation.isValid ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                  </label>
                  <Textarea
                    id="edit-bodyScriptTags"
                    name="bodyScriptTags"
                    placeholder="Enter body script tags (e.g., Google Analytics, Facebook Pixel)"
                    value={form.bodyScriptTags}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setForm((f) => ({ ...f, bodyScriptTags: newValue }));
                      if (newValue.trim()) {
                        setBodyScriptValidation(validateScriptTags(newValue));
                      } else {
                        setBodyScriptValidation({ isValid: true, errors: [], warnings: [] });
                      }
                    }}
                    rows={4}
                    className={`resize-none ${form.bodyScriptTags && !bodyScriptValidation.isValid
                      ? 'border-red-500 focus:border-red-500'
                      : form.bodyScriptTags && bodyScriptValidation.isValid
                        ? 'border-green-500 focus:border-green-500'
                        : ''
                      }`}
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    <p className="mb-1">Allowed script types:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>
                        <strong>External scripts:</strong> Only from Google and Facebook domains
                        (must include src attribute)
                      </li>
                      <li>
                        <strong>Inline scripts:</strong> Only Google Analytics, Google Tag Manager,
                        and Facebook Pixel code
                      </li>
                    </ul>
                    <p className="mt-2">
                      Example: &lt;script async
                      src="https://www.googletagmanager.com/gtag/js?id=TAG_ID"&gt;&lt;/script&gt;
                    </p>
                  </div>
                  {bodyScriptValidation.errors.length > 0 && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                      <p className="font-medium text-red-800 mb-1">Validation Errors:</p>
                      <ul className="list-disc list-inside space-y-1 text-red-700">
                        {bodyScriptValidation.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {bodyScriptValidation.warnings.length > 0 && (
                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                      <p className="font-medium text-yellow-800 mb-1">Warnings:</p>
                      <ul className="list-disc list-inside space-y-1 text-yellow-700">
                        {bodyScriptValidation.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Banner Image Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Banner Image
                </h3>
                <div className="flex flex-col">
                  <label htmlFor="edit-banner" className="text-sm font-medium mb-1">
                    Banner Image
                  </label>
                  <input
                    id="edit-banner"
                    name="banner"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleFileChange}
                    className="border rounded px-2 py-1"
                  />
                  {bannerFile && (
                    <p className="text-sm text-gray-600 mt-1">
                      Selected: {bannerFile.name} ({Math.round(bannerFile.size / 1024)} KB)
                    </p>
                  )}
                  {editServiceId?.bannerUrl && !bannerFile && (
                    <div className="mt-2">
                      <p className="text-sm text-gray-600 mb-2">Current Banner:</p>
                      <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                        <img
                          src={editServiceId.bannerUrl}
                          alt="Current Banner"
                          className="max-w-full max-h-full object-contain rounded"
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">The image should be of 320x 160 px</p>
                </div>
              </div>

              <input type="hidden" name="serviceId" value={editServiceId.serviceId} />
              {originalServiceId && (
                <input
                  type="hidden"
                  name="originalServiceId"
                  value={JSON.stringify(originalServiceId)}
                />
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="submit" name="intent" disabled={!!errors.serviceId || !!errors.serviceIdName || !!errors.serviceIdText} value="update">

                  {navigation.state === 'submitting' ? 'Updating...' : 'Update ServiceId'}
                </Button>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      {/* Service ID View Modal */}
      <Dialog open={!!viewServiceId} onOpenChange={(open) => !open && setViewServiceId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Service ID Details</DialogTitle>
          </DialogHeader>
          {viewServiceId && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Service ID</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewServiceId.serviceId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Content Partner (CP)</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {(() => {
                      const cp = cps.find((cp: any) => cp.cpid === viewServiceId.cpId);
                      return cp ? `${cp.cpName} (${viewServiceId.cpId})` : viewServiceId.cpId;
                    })()}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">ServiceId Name</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewServiceId.serviceIdName}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Created At</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {formatDate(viewServiceId.createdAt)}
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">ServiceId Text</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {truncateText(viewServiceId.serviceIdText || '-')}
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Script Tags</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {truncateText(viewServiceId.scriptTags || '-')}
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Body Script Tags</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {truncateText(viewServiceId.bodyScriptTags || '-')}
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Banner Image</label>
                {viewServiceId.bannerUrl ? (
                  <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                    <img
                      src={viewServiceId.bannerUrl}
                      alt="Banner"
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  </div>
                ) : (
                  <div className="w-80 h-40 border rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 flex items-center justify-center">
                    No Image
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setViewServiceId(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
