import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import {
  useLoaderData,
  Form,
  useActionData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from '@remix-run/react';
import Layout from '../components/layout';
import { Info } from 'lucide-react';

import { Checkbox } from '../components/ui/checkbox';
import {
  getAllProducts,
  createProduct,
  updateProduct,
  getProductsByCpid,
  deleteProduct,
} from '../lib/dynamodb-products';
import { getAllServiceIdDeatilsByServiceId, getAllServiceIds } from '../lib/dynamodb-serviceid';
import { hasTrfSrc, addTrfSrc } from '../lib/trfsrc-cache';
import { saveTrfSrcMapping } from '../lib/dynamodb-trfsrc';
import { useState, useEffect } from 'react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { SearchableSelect } from '../components/ui/searchable-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  unstable_parseMultipartFormData,
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  type UploadHandler,
} from '@remix-run/node';
import { S3_BUCKET_NAME } from '../lib/config';
import { getSession } from '../lib/session.server';
import {
  logDashboardActivity,
  getClientIP,
  logCpOnboardApprovalActivity,
} from '../lib/dynamodb-log';
import sendEmail from '../../tools/mailer';
import { getCPByCpid } from '~/lib/dynamodb-cp';
import fileToBase64 from '../util/fileToBase64';
import { DYNAMODB_TABLES } from '~/lib/config';
import { Loader2 } from 'lucide-react';
import { fullAuthGuard } from '~/util/authGuard';
import { saveVersionToS3 } from '~/lib/s3-version';
import { getNextVersion } from '~/lib/version';
import { S3_VERSION_BUCKET_NAME } from '../lib/config';
import { createBannerUploadHandler } from '~/lib/upload-validator.server';
import { checkQuota, incrementQuota } from '~/lib/quota-limiter.server';
const HARDCODED = {
  currency: 'NGN',
  currencySymbol: 'N',
  nodeId: 'ICELL',
  registrationChannel: 'botDetect',
};

const VALIDITY_UNITS = ['Day', 'Week', 'Month'];

const CONTENT_TYPES = [
  'Arts & Entertainment',
  'Automotive',
  'Business',
  'Careers',
  'Education',
  'Family & Parenting',
  'Food & Drink',
  'Health & Fitness',
  'Hobbies & Interests',
  'Home & Garden',
  'Law, Government & Politics',
  'News',
  'Personal Finance',
  'Pets',
  'Real Estate',
  'Science',
  'Shopping',
  'Sports',
  'Technology & Computing',
  'Travel',
  'Games',
  'Lifestyle',
];

const subscriptionDescriptionSchema = z.string().regex(/^\d+$/, {
  message: 'the serviceDescription should only contain digits 0 till 9, no alphabets allowed',
});

function isValidHttpUrl(urlString: string): boolean {
  if (!urlString || urlString.trim() === '') return true; // Allow empty URLs (optional fields)
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function formatDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleString();
}

function truncateText(text: string, maxLength: number = 80): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

const s3 = new S3Client({ region: 'ap-south-1' });
const BUCKET_NAME = S3_BUCKET_NAME;

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect('/login?message=login%20required');
  }
  const userRole = session.get('role') || null;
  const userCpid = session.get('cpid');
  const userCpName = session.get('cpName');
  const viewFilters = session.get('viewFilters');

  const [allProducts, allServiceIds] = await Promise.all([getAllProducts(), getAllServiceIds()]);

  // If user is CP role, validate they have proper CP configuration and filter products
  if (userRole === 'cp') {
    // If CP user doesn't have CPID in session, they shouldn't see any data
    if (!userCpid) {
      return json({
        products: [],
        serviceIds: [],
        userRole,
        userCpid: null,
        userCpName: null,
        viewFilters: null,
        error: 'CP configuration not found',
      });
    }

    // Filter service IDs to only show those in the user's viewFilters
    let serviceIds = allServiceIds;
    if (viewFilters && Array.isArray(viewFilters) && viewFilters.length > 0) {
      serviceIds = allServiceIds.filter((sid: any) => viewFilters.includes(sid.serviceId));
    } else {
      // Fallback: filter by cpId if viewFilters not available
      serviceIds = allServiceIds.filter((sid: any) => sid.cpId === userCpid);
    }

    // Filter products to only show those related to the CP user's service IDs
    const products = await getProductsByCpid(userCpid, serviceIds);

    const allowedStatuses = [true, false, 'suspended', 'pending', 'draft'];

    const filteredProducts = (products || []).filter((prod: any) =>
      allowedStatuses.includes(prod.isLive),
    );
    return json({
      products: filteredProducts,
      serviceIds,
      userRole,
      userCpid,
      userCpName,
      viewFilters,
      userEmail: session.get('email') || null,
    });
  }

  // For admin users, filter out rejected products (isLive: false)
  //const filteredProducts = allProducts.filter((prod: any) => prod.isLive !== false && prod.isLive !== 'draft');
  const allowedStatuses = [true, 'suspended', 'pending'];
  // const filteredProducts = allProducts.filter((prod: any) => prod.isLive === false);
  const filteredProducts = allProducts.filter((prod: any) => allowedStatuses.includes(prod.isLive));



  return json({
    products: filteredProducts,
    serviceIds: allServiceIds,
    userRole,
    userCpid,
    userCpName: null,
    viewFilters: null,
    userEmail: session.get('email') || null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  // Check user session and role
  // Auth guard — reject unauthenticated requests
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }
  const session = await getSession(request);
  const userRole = session.get('role');
  const userCpid = session.get('cpid');
  const userEmail = session.get('email');
  const viewFilters = session.get('viewFilters');



  // Check if user has operations role - they cannot create or update
  if (userRole === 'operations') {
    return json(
      { error: 'Operations role do not have permission to edit or create' },
      { status: 403 },
    );
  }

  // Note: CP users can create service descriptions even with view filters

  let formData: FormData;
  try {
    formData = await unstable_parseMultipartFormData(
      request,
      unstable_composeUploadHandlers(
        createBannerUploadHandler(s3, BUCKET_NAME, 'service-description-banners'),
        unstable_createMemoryUploadHandler(),
      ),
    );
  } catch (err: any) {
    return json({ error: err?.message || 'Invalid file upload' }, { status: 400 });
  }
  const intent = formData.get('intent');


  if (intent === 'create' || intent === 'save_draft') {
    const checkServiceId = (formData.get('serviceId') as string) || 'DRAFT';
    const checkSubDesc = formData.get('subscriptionDescription') as string;

    // Only check if subscriptionDescription is actually provided
    if (checkSubDesc && checkSubDesc.trim() !== '') {
      const checkKey = `${checkServiceId}_${checkSubDesc}`;

      const allExistingProducts = await getAllProducts();

      const duplicate = allExistingProducts.find(
        (p: any) => p.subscriptionId_subscriptionDescription === checkKey,
      );

      if (duplicate) {
        return json(
          { error: `"${checkKey}" already exists . Use a different Subscription Description.` },
          { status: 409 },
        );
      }
    }
  }
  const serviceId = formData.get('serviceId') as string;
  const subscriptionName = formData.get('subscriptionName') as string;
  const subscriptionText = formData.get('subscriptionText') as string;
  const stopSMStext = formData.get('stopSMStext') as string;
  const price = Number(formData.get('price'));
  const subscriptionValidityUnit = formData.get('subscriptionValidityUnit') as string;
  const subscriptionValidityDuration = Number(formData.get('subscriptionValidityDuration'));
  const subscriptionDescription = formData.get('subscriptionDescription') as string;
  const subscriptionProviderId = formData.get('subscriptionProviderId') as string;
  const contentType = (formData.get('contentType') as string) || 'NA';
  const serviceURL = (formData.get('serviceURL') as string) || 'NA';
  const queryParameterKey = (formData.get('queryParameterKey') as string) || '';
  const successApiCPurl = (formData.get('successApiCPurl') as string) || '';
  const failureApiCPurl = (formData.get('failureApiCPurl') as string) || '';
  const autoRenewal = formData.get('autoRenewal') === 'true';
  const subscriptionId_subscriptionDescription = `${serviceId}_${subscriptionDescription}`;
  const bannerUrl = formData.get('banner') as string | null;

  if (intent === 'preview') {
    const baseUrl = 'http://mtn-nigeria-prod.mfilterit.org';
    // const baseUrl = 'http://localhost:3000';

    const body = {
      subscriptionId_subscriptionDescription: formData.get(
        'subscriptionId_subscriptionDescription',
      ) as string,
      bannerBase64: formData.get('bannerBase64') as string,
    };

    try {
      let response = await fetch(baseUrl + '/preview-sid-page/cache-preview-banner', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      let data = await response.json();

      if (data.message == 'ok') {
        return json({ error: 'Failed to generate preview' }, { status: 400 });
      }

      return json({ success: 'preview' });
    } catch (error) {
      toast.error('Failed to generate preview banner');
      return;
    }
  }
  if (intent === 'save_draft') {
    try {
      const draftProduct: any = {
        subscriptionId_subscriptionDescription: `${formData.get('serviceId') || 'DRAFT'}_${formData.get('subscriptionDescription') || Date.now()
          }`,
        serviceId: formData.get('serviceId') || '',
        subscriptionName: formData.get('subscriptionName') || '',
        subscriptionDescription: formData.get('subscriptionDescription') || '',
        subscriptionText: formData.get('subscriptionText') || '',
        stopSMStext: formData.get('stopSMStext') || '',
        price: Number(formData.get('price') || 0),
        subscriptionValidityUnit: formData.get('subscriptionValidityUnit') || '',
        subscriptionValidityDuration: Number(formData.get('subscriptionValidityDuration') || 0),
        subscriptionProviderId: formData.get('subscriptionProviderId') || 'CSM',
        contentType: formData.get('contentType') || '',
        serviceURL: formData.get('serviceURL') || '',
        queryParameterKey: formData.get('queryParameterKey') || '',
        successApiCPurl: formData.get('successApiCPurl') || '',
        failureApiCPurl: formData.get('failureApiCPurl') || '',
        isLive: 'draft',
        ...HARDCODED,
        createdAt: new Date().toISOString(),
      };
      if (bannerUrl) draftProduct.bannerUrl = bannerUrl;
      await createProduct(draftProduct);
      return json({ success: 'draft_saved' });
    } catch (err) {
      console.error('Draft save error:', err);
      return json({ error: 'Failed to save draft' }, { status: 500 });
    }
  }
  if (intent === 'delete_draft') {
    const id = formData.get('subscriptionId_subscriptionDescription') as string;

    if (!id) {
      return json({ error: 'Subscription ID is required' }, { status: 400 });
    }

    try {
      await deleteProduct(id);

      // Optional: Log the deletion activity
      const ipAddress = getClientIP(request);
      await logDashboardActivity(
        DYNAMODB_TABLES.CP_PRODUCTS,
        'DELETE_DRAFT_PRODUCT',
        { id },
        ipAddress,
        userEmail,
      );

      return json({ success: 'deleted' });
    } catch (err) {
      console.error('Delete error:', err);
      return json({ error: 'Failed to delete draft' }, { status: 500 });
    }
  }
  // For CP users, ensure they have proper CP configuration and can only create/update products for their own service IDs
  if (userRole === 'cp') {
    if (!userCpid) {
      return json(
        { error: 'CP configuration not found. Please contact administrator.' },
        { status: 403 },
      );
    }

    // Get all service IDs for this CP user
    const allServiceIds = await getAllServiceIds();
    const cpServiceIds = allServiceIds
      .filter((sid: any) => sid.cpId === userCpid)
      .map((sid: any) => sid.serviceId);
    if (!cpServiceIds.includes(serviceId)) {
      return json(
        { error: 'You can only create or update products for your own service IDs.' },
        { status: 403 },
      );
    }
  }

  // Only validate form fields for create and update intents
  const isDraftUpdate = formData.get('isDraftUpdate') === 'true';
  if (intent === 'create' || intent === 'update' && !isDraftUpdate) {
    const validation = subscriptionDescriptionSchema.safeParse(subscriptionDescription);
    if (!validation.success) {
      return json({ error: validation.error.errors[0].message }, { status: 400 });
    }
    if (!stopSMStext || stopSMStext.trim() === '') {
      return json({ error: 'stopSMStext is required and cannot be blank' }, { status: 400 });
    }
    if (!subscriptionValidityDuration || subscriptionValidityDuration < 1) {
      return json({ error: 'Validity duration must be at least 1' }, { status: 400 });
    }

    if (subscriptionValidityUnit === 'Month' && subscriptionValidityDuration > 12) {
      return json({ error: 'For Month, validity duration cannot exceed 12' }, { status: 400 });
    }

    // Validate CP API URLs
    if (!isValidHttpUrl(successApiCPurl)) {
      return json({ error: 'successApiCPurl must be a valid HTTP or HTTPS URL' }, { status: 400 });
    }
    if (!isValidHttpUrl(failureApiCPurl)) {
      return json({ error: 'failureApiCPurl must be a valid HTTP or HTTPS URL' }, { status: 400 });
    }
  }

  // Only process banner URL for create and update intents
  let finalBannerUrl = bannerUrl;
  if (
    (intent === 'create' || intent === 'update') &&
    typeof bannerUrl === 'string' &&
    bannerUrl &&
    subscriptionDescription
  ) {
    // Extract the original filename from the S3 URL
    const urlParts = bannerUrl.split('/');
    const originalFilename = urlParts[urlParts.length - 1];
    const ext = originalFilename.split('.').pop();
    //const newKey = `service-description-banners/${subscriptionDescription}.${ext}`;
    const originalProductData = formData.get('originalProduct') as string;
    const parsedOriginalProduct = originalProductData ? JSON.parse(originalProductData) : null;
    const currentVersion = getNextVersion(parsedOriginalProduct?.version || 'v_0.00');
    const newKey = `service-description-banners/${subscriptionDescription}/${currentVersion}.${ext}`;
    const R2_ACCOUNT_ID = "139087e10f57fa8607819419a2a2309e";
    const R2_ACCESS_KEY_ID = "a787b7861a15facfe4b37d1341a93991";
    const R2_SECRET_ACCESS_KEY = "e9807b67669da368431db05e2fb0d41b3cb6f3ecd188f58a4f3588581be7febf";
    const R2_BUCKET_NAME = "static-content";
    const r2 = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
    try {
      console.log("S3 Object ContentType: 448");
      // Copy the object to the new key
      await s3.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/service-description-banners/${originalFilename}`,
          Key: newKey,
        }),
      );
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: newKey,
        })
      );
      const bytes = await object.Body?.transformToByteArray();
      const r2Key = `service-description-banners/${subscriptionDescription}.${ext}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: r2Key,
          Body: Buffer.from(bytes!),
          ContentType: object.ContentType,
        })
      );



      // Delete the original upload
      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `service-description-banners/${originalFilename}`,
        }),
      );
      finalBannerUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${newKey}`;
    } catch (err) {
      // fallback to original bannerUrl if copy fails
    }
  }

  if (intent === 'create') {
    const quota = await checkQuota(userEmail, 'create_service_description');
    if (!quota.allowed) return json({ error: quota.message }, { status: 429 });

    const callbackType = formData.get('callbackType') as 'CAPTIVE' | 'NON_CAPTIVE' | null;

    const trfSrcName = formData.get('trfsrcName') as string | null;
    const trfSrcUrls = formData
      .getAll('trfsrcUrls')
      .filter((url): url is string => typeof url === 'string' && url.trim() !== '');

    if (callbackType && trfSrcName) {
      if (hasTrfSrc(trfSrcName, callbackType)) {
        return json(
          {
            error: `trfSrc name "${trfSrcName}" already exists for ${callbackType} callback`,
          },
          { status: 409 },
        );
      }

      console.log('Saving TRFSRC:', {
        trfSrcName,
        trfSrcUrls,
        callbackType,
      });

      await saveTrfSrcMapping({ trfSrcName, trfSrcUrls, callbackType });
      // addTrfSrc(trfSrcName);
      addTrfSrc(trfSrcName, callbackType);
    }

    const newProduct: any = {
      subscriptionId_subscriptionDescription,
      serviceId,
      subscriptionName,
      subscriptionText,
      stopSMStext,
      price,
      subscriptionValidityDuration,
      subscriptionValidityUnit,
      subscriptionDescription,
      subscriptionProviderId,
      contentType,
      serviceURL,
      bannerUrl: finalBannerUrl,
      autoRenewal,
      ...HARDCODED,
      version: 'v_0.00',
    };

    // Only add queryParameterKey if it's provided
    if (queryParameterKey && queryParameterKey.trim() !== '') {
      newProduct.queryParameterKey = queryParameterKey.trim();
    }
    if (successApiCPurl && successApiCPurl.trim() !== '') {
      newProduct.successApiCPurl = successApiCPurl.trim();
    }
    if (failureApiCPurl && failureApiCPurl.trim() !== '') {
      newProduct.failureApiCPurl = failureApiCPurl.trim();
    }

    // Ensure consistent boolean for approved; keep 'pending' string for CP flow
    newProduct.isLive = userRole === 'cp' ? 'pending' : true;
    await createProduct(newProduct);
    await saveVersionToS3(S3_VERSION_BUCKET_NAME, 'service-description', subscriptionId_subscriptionDescription, newProduct);

    // Log the create activity
    const ipAddress = getClientIP(request);
    await logDashboardActivity(
      DYNAMODB_TABLES.CP_PRODUCTS,
      'CREATE_SERVICE_PRODUCT',
      newProduct,
      ipAddress,
      userEmail,
    );

    // Log CP onboard approval activity for tracking
    if (userRole === 'cp') {
      // Get CP details for the current user
      const cpDetails = await getCPByCpid(userCpid);

      await logCpOnboardApprovalActivity(
        'CREATE',
        subscriptionId_subscriptionDescription,
        newProduct,
        ipAddress,
        newProduct.isLive,
        userEmail,
      );

      const emailData = {
        userType: 'cp',
        cpName: cpDetails?.cpName || '',
        cpEmail: cpDetails?.cpEmail || '',
        subscriptionName: newProduct.subscriptionName,
        subscriptionValidity: `${newProduct.subscriptionValidityDuration} ${newProduct.subscriptionValidityUnit
          }${newProduct.subscriptionValidityDuration > 1 ? 's' : ''}`,
        price: newProduct.price,
        subscriptionDescription: newProduct.subscriptionDescription,
      };
      await sendEmail(emailData);
    }

    // Check if user is admin, then send notification/email to CP
    if (userRole === 'admin') {
      const serviceData = await getAllServiceIdDeatilsByServiceId(newProduct.serviceId);
      const cpDetail = serviceData[0].cpId;
      // Lookup CP details
      const cpDetails = await getCPByCpid(cpDetail);

      if (cpDetails && cpDetails.cpEmail) {
        const adminEmailData = {
          userType: 'admin_response',
          cpName: cpDetails.cpName || '',
          cpEmail: cpDetails.cpEmail,
          subscriptionName: newProduct.subscriptionName,
          subscriptionValidity: `${newProduct.subscriptionValidityDuration} ${newProduct.subscriptionValidityUnit
            }${newProduct.subscriptionValidityDuration > 1 ? 's' : ''}`,
          price: newProduct.price,
          serviceID: newProduct.serviceId,
          subscriptionId: newProduct.serviceId,
          subscriptionDescription: newProduct.subscriptionDescription,
          status: 'Approved',
        };

        await sendEmail(adminEmailData);
      }
    }

    incrementQuota(userEmail, 'create_service_description');
    return json({ success: 'created' });
  } else if (intent === 'update') {
    const updateQuota = await checkQuota(userEmail, 'update');
    if (!updateQuota.allowed) return json({ error: updateQuota.message }, { status: 429 });
    const originalProductData = formData.get('originalProduct') as string;
    const originalProduct = originalProductData ? JSON.parse(originalProductData) : null;

    // Compare current values with original values to determine which fields have changed
    const updateData: any = {};
    const addIfChanged = (key: string, newVal: any, origVal: any) => {
      if (!originalProduct || newVal !== origVal) {
        updateData[key] = newVal;
      }
    };

    // Check each field and only include it if it has changed
    if (subscriptionName !== originalProduct?.subscriptionName) {
      updateData.subscriptionName = subscriptionName;
    }
    if (subscriptionText !== originalProduct?.subscriptionText) {
      updateData.subscriptionText = subscriptionText;
    }
    if (stopSMStext !== originalProduct?.stopSMStext) {
      updateData.stopSMStext = stopSMStext;
    }
    if (price !== originalProduct?.price) {
      updateData.price = price;
    }
    if (subscriptionValidityDuration !== originalProduct?.subscriptionValidityDuration) {
      updateData.subscriptionValidityDuration = subscriptionValidityDuration;
    }
    if (subscriptionValidityUnit !== originalProduct?.subscriptionValidityUnit) {
      updateData.subscriptionValidityUnit = subscriptionValidityUnit;
    }
    if (contentType !== originalProduct?.contentType) {
      updateData.contentType = contentType;
    }
    if (serviceURL !== originalProduct?.serviceURL) {
      updateData.serviceURL = serviceURL;
    }
    if (autoRenewal !== originalProduct?.autoRenewal) {
      updateData.autoRenewal = autoRenewal;
    }

    // Handle queryParameterKey - only include if provided or if it changed
    if (queryParameterKey && queryParameterKey.trim() !== '') {
      if (queryParameterKey.trim() !== originalProduct?.queryParameterKey) {
        updateData.queryParameterKey = queryParameterKey.trim();
      }
    } else if (originalProduct?.queryParameterKey) {
      // If field is empty but original had a value, remove it
      updateData.queryParameterKey = '';
    }

    // Handle successApiCPurl - only include if it changed
    if (successApiCPurl && successApiCPurl.trim() !== '') {
      if (successApiCPurl.trim() !== originalProduct?.successApiCPurl) {
        updateData.successApiCPurl = successApiCPurl.trim();
      }
    } else if (originalProduct?.successApiCPurl) {
      // If field is empty but original had a value, keep original value (don't change)
      // Do nothing - field won't be updated
    }

    // Handle failureApiCPurl - only include if it changed
    if (failureApiCPurl && failureApiCPurl.trim() !== '') {
      if (failureApiCPurl.trim() !== originalProduct?.failureApiCPurl) {
        updateData.failureApiCPurl = failureApiCPurl.trim();
      }
    } else if (originalProduct?.failureApiCPurl) {
      // If field is empty but original had a value, keep original value (don't change)
      // Do nothing - field won't be updated
    }

    // Only include bannerUrl if a new banner is provided
    if (bannerUrl && finalBannerUrl) {
      updateData.bannerUrl = finalBannerUrl;
    }
    const promoteDraftToPending = formData.get('promoteDraftToPending');
    if (promoteDraftToPending === 'true' && userRole === 'cp') {
      updateData.isLive = 'pending';
    }

    // Only proceed with update if there are fields to update
    if (Object.keys(updateData).length > 0) {
      await updateProduct(
        formData.get('subscriptionId_subscriptionDescription') as string,
        updateData,
      );
      const allProductsForVersion = await getAllProducts();
      const currentProductData = allProductsForVersion.find(
        (p: any) => p.subscriptionId_subscriptionDescription === formData.get('subscriptionId_subscriptionDescription')
      );
      if (currentProductData) {
        await saveVersionToS3(S3_VERSION_BUCKET_NAME, 'service-description', formData.get('subscriptionId_subscriptionDescription') as string, currentProductData);
        updateData.version = currentProductData.version;

      }

      // Log the update activity
      const ipAddress = getClientIP(request);
      await logDashboardActivity(
        DYNAMODB_TABLES.CP_PRODUCTS,
        'UPDATE_SERVICE_PRODUCT',
        {
          subscriptionId_subscriptionDescription: formData.get(
            'subscriptionId_subscriptionDescription',
          ) as string,
          ...updateData,
        },
        ipAddress,
        userEmail,
      );
    }
    if (promoteDraftToPending === 'true' && userRole === 'cp') {
      const cpDetails = await getCPByCpid(userCpid);

      const emailData = {
        userType: 'cp',
        cpName: cpDetails?.cpName || '',
        cpEmail: cpDetails?.cpEmail || '',
        subscriptionName: subscriptionName,
        subscriptionValidity: `${subscriptionValidityDuration} ${subscriptionValidityUnit}${subscriptionValidityDuration > 1 ? 's' : ''
          }`,
        price: price,
        subscriptionDescription: subscriptionDescription,
      };
      await sendEmail(emailData);

      await logCpOnboardApprovalActivity(
        'CREATE',
        subscriptionId_subscriptionDescription,
        { isLive: 'pending' },
        getClientIP(request),
        'pending',
        userEmail,
      );
    }

    incrementQuota(userEmail, 'update');
    return json({ success: 'updated' });
  } else if (intent === 'approve') {
    // Only allow admin users to approve service descriptions
    if (userRole !== 'admin') {
      return json(
        { error: 'Access denied. Admin role required to approve service descriptions.' },
        { status: 403 },
      );
    }

    const subscriptionId_subscriptionDescription = formData.get(
      'subscriptionId_subscriptionDescription',
    ) as string;

    // Get the product details to extract CP information
    const allProducts = await getAllProducts();
    const productToApprove = allProducts.find(
      (prod: any) =>
        prod.subscriptionId_subscriptionDescription === subscriptionId_subscriptionDescription,
    );

    if (!productToApprove) {
      return json({ error: 'Product not found' }, { status: 404 });
    }

    // Get CP details from the product's service ID
    const allServiceIds = await getAllServiceIds();
    const serviceDetails = allServiceIds.find(
      (sid: any) => sid.serviceId === productToApprove.serviceId,
    );

    if (!serviceDetails) {
      return json({ error: 'Service details not found' }, { status: 404 });
    }

    // Get CP details using the CP ID from service details
    const cpDetails = await getCPByCpid(serviceDetails.cpId);

    // Update the product to set isLive to true
    await updateProduct(subscriptionId_subscriptionDescription, { isLive: true });

    // Prepare email data
    const emailData = {
      userType: 'admin_response', // This will use the MTN response template
      status: 'Approved',
      cpName: cpDetails?.cpName || 'Unknown CP',
      cpEmail: cpDetails?.cpEmail || '',
      subscriptionName: productToApprove.subscriptionName,
      subscriptionValidity: `${productToApprove.subscriptionValidityDuration} ${productToApprove.subscriptionValidityUnit
        }${productToApprove.subscriptionValidityDuration > 1 ? 's' : ''}`,
      serviceID: productToApprove.serviceId,
      subscriptionDescription: productToApprove.subscriptionDescription,
    };



    try {
      await sendEmail(emailData);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the approval if email fails, just log it
    }

    // Log the approval activity
    const ipAddress = getClientIP(request);


    await logDashboardActivity(
      DYNAMODB_TABLES.CP_PRODUCTS,
      'APPROVE_SERVICE_PRODUCT',
      { email: userEmail, subscriptionId_subscriptionDescription, isLive: true },
      ipAddress,
      userEmail,
    );

    await logCpOnboardApprovalActivity(
      'APPROVE',
      subscriptionId_subscriptionDescription,
      { isLive: true },
      ipAddress,
      true,
      userEmail,
    );

    return json({ success: 'approved' });
  } else if (intent === 'reject') {


    // Only allow admin users to reject service descriptions
    if (userRole !== 'admin') {

      return json(
        { error: 'Access denied. Admin role required to reject service descriptions.' },
        { status: 403 },
      );
    }

    const subscriptionId_subscriptionDescription = formData.get(
      'subscriptionId_subscriptionDescription',
    ) as string;
    const rejectReason = formData.get('rejectReason') as string;
    console.log(
      'Rejecting product:',
      subscriptionId_subscriptionDescription,
      'Reason:',
      rejectReason,
    );

    // Get the product details to extract CP information
    const allProducts = await getAllProducts();

    const productToReject = allProducts.find(
      (prod: any) =>
        prod.subscriptionId_subscriptionDescription === subscriptionId_subscriptionDescription,
    );

    if (!productToReject) {

      // console.log(
      //   'Available products:',
      //   allProducts.map((p) => p.subscriptionId_subscriptionDescription),
      // );
      return json({ error: 'Product not found' }, { status: 404 });
    }



    // Get CP details from the product's service ID
    const allServiceIds = await getAllServiceIds();
    const serviceDetails = allServiceIds.find(
      (sid: any) => sid.serviceId === productToReject.serviceId,
    );

    if (!serviceDetails) {
      return json({ error: 'Service details not found' }, { status: 404 });
    }

    // Get CP details using the CP ID from service details
    const cpDetails = await getCPByCpid(serviceDetails.cpId);

    // Update the product to set isLive to false and add rejection reason
    console.log('Updating product with rejection data:', {
      isLive: false,
      rejectReason: rejectReason,
    });
    await updateProduct(subscriptionId_subscriptionDescription, {
      isLive: false,
      rejectReason: rejectReason,
    });

    // Prepare email data
    const emailData = {
      userType: 'admin_response', // This will use the MTN response template
      status: 'Rejected',
      cpName: cpDetails?.cpName || 'Unknown CP',
      cpEmail: cpDetails?.cpEmail || '',
      subscriptionName: productToReject.subscriptionName,
      subscriptionValidity: `${productToReject.subscriptionValidityDuration} ${productToReject.subscriptionValidityUnit
        }${productToReject.subscriptionValidityDuration > 1 ? 's' : ''}`,
      serviceID: productToReject.serviceId,
      rejectionReason: rejectReason,
    };

    try {
      await sendEmail(emailData);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the rejection if email fails, just log it
    }

    // Log the rejection activity
    const ipAddress = getClientIP(request);
    await logDashboardActivity(
      DYNAMODB_TABLES.CP_PRODUCTS,
      'REJECT_SERVICE_PRODUCT',
      {
        email: userEmail,
        subscriptionId_subscriptionDescription,
        isLive: false,
        rejectReason: rejectReason,
      },
      ipAddress,
      userEmail,
    );

    await logCpOnboardApprovalActivity(
      'REJECT',
      subscriptionId_subscriptionDescription,
      { isLive: false, rejectReason: rejectReason },
      ipAddress,
      false,
      userEmail,
    );

    return json({ success: 'rejected' });
  } else if (intent == 'bulk_approve' || intent === 'bulk_reject') {


    // Only allow admin users to reject service descriptions
    if (userRole !== 'admin') {

      return json(
        { error: `Access denied. Admin role required to ${intent} service descriptions.` },
        { status: 403 },
      );
    }

    const subscriptionId_subscriptionDescriptions = formData.get(
      'subscriptionId_subscriptionDescriptions',
    );

    if (!subscriptionId_subscriptionDescriptions) {
      return json({ error: 'No subscription IDs provided' }, { status: 400 });
    }
    const productIds = subscriptionId_subscriptionDescriptions.toString().split(',');
    const bulkActionReason =
      formData?.get('bulkActionReason')?.toString().trim() || 'No reason provided';
    console.log(
      `${intent}ing product:`,
      subscriptionId_subscriptionDescriptions,
      'Reason:',
      bulkActionReason,
    );

    // Get the product details to extract CP information
    const allProducts = await getAllProducts();
    const productsForAction = allProducts.filter((prod: any) =>
      productIds.includes(prod.subscriptionId_subscriptionDescription),
    );


    if (productsForAction.length === 0) {

      // console.log(
      //   'Available products:',
      //   allProducts.map((p) => p.subscriptionId_subscriptionDescription),
      // );
      return json({ error: 'Product not found' }, { status: 404 });
    }

    // console.log(
    //   `Product found for ${intent}:`,
    //   productsForAction.map((p) => p.subscriptionName),
    // );
    // Get CP details from the product's service ID

    const allServiceIds = await getAllServiceIds();
    const failedServiceDetails = [];
    for (const product of productsForAction) {
      const serviceDetails = allServiceIds.find((sid: any) => sid.serviceId === product.serviceId);

      if (!serviceDetails) {
        failedServiceDetails.push(product.subscriptionId_subscriptionDescription);
        continue;
      }

      // Get CP details using the CP ID from service details
      const cpDetails = await getCPByCpid(serviceDetails.cpId);

      // Update the product to set isLive to false and add rejection reason
      console.log('Updating product with bulk action data:', {
        subscriptionId_subscriptionDescription: product.subscriptionId_subscriptionDescription,
        isLive: intent === 'bulk_reject' ? false : true,
        rejectReason: bulkActionReason,
      });

      await updateProduct(product.subscriptionId_subscriptionDescription, {
        isLive: intent === 'bulk_reject' ? false : true,
        rejectReason: bulkActionReason,

      });


      // Prepare email data
      const emailData = {
        userType: 'admin_response', // This will use the MTN response template
        status: intent === 'bulk_reject' ? 'Rejected' : 'Approved',
        cpName: cpDetails?.cpName || 'Unknown CP',
        cpEmail: cpDetails?.cpEmail || '',
        subscriptionName: product.subscriptionName,
        subscriptionValidity: `${product.subscriptionValidityDuration} ${product.subscriptionValidityUnit
          }${product.subscriptionValidityDuration > 1 ? 's' : ''}`,
        serviceID: product.serviceId,
        rejectionReason: bulkActionReason,
      };

      try {

        await sendEmail(emailData);
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        // Don't fail the rejection if email fails, just log it
      }

      const ipAddress = getClientIP(request);
      // Log the rejection activity
      await logDashboardActivity(
        DYNAMODB_TABLES.CP_PRODUCTS,
        intent === 'bulk_reject' ? 'REJECT_BULK_SERVICE_PRODUCT' : 'APPROVE_BULK_SERVICE_PRODUCT',
        {
          email: userEmail,
          subscriptionId_subscriptionDescription,
          isLive: intent === 'bulk_reject' ? false : true,
          rejectReason: bulkActionReason,

        },
        ipAddress,
        userEmail,
      );

      await logCpOnboardApprovalActivity(
        intent === 'bulk_reject' ? 'REJECT_BULK' : 'APPROVE_BULK',
        subscriptionId_subscriptionDescription,
        { isLive: intent === 'bulk_reject' ? false : true, rejectReason: bulkActionReason },
        ipAddress,
        intent === 'bulk_reject' ? false : true,
        userEmail,
      );
    }
    return json({
      success: intent === 'bulk_reject' ? 'rejected' : 'approved',
      failedServiceDetails,
    });
  } else if (intent === 'suspend') {
    if (userRole !== 'admin') {
      return json(
        { error: 'Access denied. Admin role required to suspend service descriptions.' },
        { status: 403 },
      );
    }
    const subscriptionId_subscriptionDescription = formData.get(
      'subscriptionId_subscriptionDescription',
    ) as string;

    const suspendReason = formData.get('suspendReason') as string;
    const suspendStartDate = formData.get('suspendStartDate') as string | null;
    const suspendEndDate = formData.get('suspendEndDate') as string | null;

    if (!suspendReason || !suspendReason.trim()) {
      return json({ error: 'Suspend reason is required.' }, { status: 400 });
    }
    const allProducts = await getAllProducts();
    const productToSuspend = allProducts.find(
      (prod: any) =>
        prod.subscriptionId_subscriptionDescription === subscriptionId_subscriptionDescription,
    );
    if (!productToSuspend) {
      return json({ error: 'Product not found' }, { status: 404 });
    }
    const allServiceIds = await getAllServiceIds();
    const serviceDetails = allServiceIds.find(
      (sid: any) => sid.serviceId === productToSuspend.serviceId,
    );
    if (!serviceDetails) {
      return json({ error: 'Service details not found' }, { status: 404 });
    }
    const cpDetails = await getCPByCpid(serviceDetails.cpId);
    const updateData: any = {
      isLive: 'suspended',
      suspendReason,
    };
    if (suspendStartDate && suspendEndDate) {
      updateData.suspendStartDate = suspendStartDate;
      updateData.suspendEndDate = suspendEndDate;
    } else {
      updateData.suspendStartDate = '';
      updateData.suspendEndDate = '';
    }
    await updateProduct(subscriptionId_subscriptionDescription, updateData);

    const emailData = {
      userType: 'admin_response',
      status: 'Suspended',
      cpName: cpDetails?.cpName || 'Unknown CP',
      cpEmail: cpDetails?.cpEmail || '',
      subscriptionName: productToSuspend.subscriptionName,
      subscriptionValidity: `${productToSuspend.subscriptionValidityDuration} ${productToSuspend.subscriptionValidityUnit
        }${productToSuspend.subscriptionValidityDuration > 1 ? 's' : ''}`,
      serviceID: productToSuspend.serviceId,
      suspendReason,
    };
    try {
      await sendEmail(emailData);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    return json({ success: 'suspended' });
  } else if (intent === 'resume') {
    if (userRole !== 'admin') {
      return json({ error: 'Admin only' }, { status: 403 });
    }

    const id = formData.get('subscriptionId_subscriptionDescription') as string;

    await updateProduct(id, {
      isLive: true,
      suspendReason: '',
    });
    const allProducts = await getAllProducts();
    const productToResume = allProducts.find(
      (prod: any) => prod.subscriptionId_subscriptionDescription === id,
    );
    if (productToResume) {
      const allServiceIds = await getAllServiceIds();
      const serviceDetails = allServiceIds.find(
        (sid: any) => sid.serviceId === productToResume.serviceId,
      );

      if (serviceDetails) {
        const cpDetails = await getCPByCpid(serviceDetails.cpId);

        const emailData = {
          userType: 'admin_response',
          status: 'Resumed',
          cpName: cpDetails?.cpName || 'Unknown CP',
          cpEmail: cpDetails?.cpEmail || '',
          subscriptionName: productToResume.subscriptionName,
          subscriptionValidity: `${productToResume.subscriptionValidityDuration} ${productToResume.subscriptionValidityUnit
            }${productToResume.subscriptionValidityDuration > 1 ? 's' : ''}`,
          serviceID: productToResume.serviceId,
          subscriptionDescription: productToResume.subscriptionDescription,
        };

        try {
          await sendEmail(emailData);
        } catch (emailError) {
          console.error('Email sending failed on resume:', emailError);
        }
      }
    }

    const ipAddress = getClientIP(request);
    await logDashboardActivity(
      DYNAMODB_TABLES.CP_PRODUCTS,
      'RESUME_SERVICE_PRODUCT',
      { email: userEmail, subscriptionId_subscriptionDescription: id, isLive: true },
      ipAddress,
      userEmail,
    );

    return json({ success: 'resumed' });
  } else if (intent === 'save_draft') {
    const draftProduct: any = {
      subscriptionId_subscriptionDescription: `${formData.get('serviceId')}_${formData.get('subscriptionDescription') || Date.now()
        }`,
      serviceId: formData.get('serviceId') || '',
      subscriptionName: formData.get('subscriptionName') || '',
      subscriptionDescription: formData.get('subscriptionDescription') || '',
      subscriptionText: formData.get('subscriptionText') || '',
      stopSMStext: formData.get('stopSMStext') || '',
      price: Number(formData.get('price') || 0),
      subscriptionValidityUnit: formData.get('subscriptionValidityUnit') || '',
      subscriptionValidityDuration: Number(formData.get('subscriptionValidityDuration') || 0),
      subscriptionProviderId: formData.get('subscriptionProviderId') || 'CSM',
      contentType: formData.get('contentType') || '',
      serviceURL: formData.get('serviceURL') || '',
      queryParameterKey: formData.get('queryParameterKey') || '',
      successApiCPurl: formData.get('successApiCPurl') || '',
      failureApiCPurl: formData.get('failureApiCPurl') || '',
      autoRenewal,
      isLive: 'draft',
      ...HARDCODED,
      createdAt: new Date().toISOString(),
    };
    if (bannerUrl) draftProduct.bannerUrl = bannerUrl;
    await createProduct(draftProduct);
    return json({ success: 'draft_saved' });
  }

  return null;
}

export default function ServiceDescriptions() {
  const { products, serviceIds, userRole, userCpid, userCpName, viewFilters, userEmail, error } =
    useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { revalidate } = useRevalidator();
  const [editProduct, setEditProduct] = useState<any | null>(null);
  const [originalProduct, setOriginalProduct] = useState<any | null>(null);
  const [form, setForm] = useState({
    serviceId: '',
    subscriptionName: '',
    subscriptionText: '',
    stopSMStext: '',
    price: 0,
    subscriptionValidityUnit: 'Month' as 'Day' | 'Week' | 'Month',
    subscriptionValidityDuration: '1' as number | '',
    subscriptionDescription: '',
    subscriptionProviderId: 'CSM',
    contentType: '',
    serviceURL: '',
    queryParameterKey: '',
    successApiCPurl: '',
    failureApiCPurl: '',
    autoRenewal: true, // Default to ON
  });
  const [showForm, setShowForm] = useState(false);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [filterText, setFilterText] = useState('');
  const [serviceIdFilter, setServiceIdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedBanner, setSelectedBanner] = useState<string | null>(null);
  const [viewProduct, setViewProduct] = useState<any | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [bulkActioModalOpen, setBulkActioModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendStartDate, setSuspendStartDate] = useState('');
  const [suspendEndDate, setSuspendEndDate] = useState('');
  const [useSuspendPeriod, setUseSuspendPeriod] = useState(false);
  const [isSuspending, setIsSuspending] = useState(false);
  type CallbackType = 'CAPTIVE' | 'NON_CAPTIVE' | '';
  const [callbackType, setCallbackType] = useState<CallbackType>('');
  const [trfSrcUrls, setTrfSrcUrls] = useState<string[]>([]);
  const [trfSrcName, setTrfSrcName] = useState('');
  const resetCallbackState = () => {
    setCallbackType('');
    setTrfSrcName('');
    setTrfSrcUrls([]);
  };
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [viewRejectReason, setViewRejectReason] = useState<string | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState('');
  const [selectedForBulkAction, setSelectedForBulkAction] = useState<Set<string>>(new Set());
  const [bulkActionReason, setBulkActionReason] = useState('');
  const ITEMS_PER_PAGE = 20;
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Scroll to top on page load / refresh
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const totalProducts =
    userRole === 'cp'
      ? products.filter((prod: any) => prod.isLive !== 'draft').length
      : products.length;
  const totalApprovedProducts = products.filter((prod: any) => prod.isLive === true).length;
  const totalRejectedProducts = products.filter((prod: any) => prod.isLive === false).length;
  const totalSuspendProducts = products.filter((prod: any) => prod.isLive === 'suspended').length;
  const totalUnderApprovalProducts = products.filter(
    (prod: any) => prod.isLive === 'pending',
  ).length;

  // Determine if user has view-only access
  const isViewOnly = userRole === 'operations';
  //that can be used for valid url is a helper function
  const isValidCallbackUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const submit = useSubmit();
  useEffect(() => {
    if (navigation.state === 'idle' && actionData) {
      if ('success' in actionData && actionData.success === 'deleted') {
        toast.success('Draft deleted successfully!');
      }
      if ('success' in actionData && actionData.success === 'created') {
        toast('Service Description created successfully!', {
          className: 'bg-green-500 text-white',
        });
        setForm({
          serviceId: '',
          subscriptionName: '',
          subscriptionText: '',
          stopSMStext: '',
          price: 0,
          subscriptionValidityUnit: 'Month',
          subscriptionValidityDuration: '',
          subscriptionDescription: '',
          subscriptionProviderId: 'CSM',
          contentType: '',
          serviceURL: '',
          queryParameterKey: '',
          successApiCPurl: '',
          failureApiCPurl: '',
          autoRenewal: true,
        });
        setShowForm(false);
        setBannerFile(null);
      } else if ('success' in actionData && actionData.success === 'updated') {
        toast('Service Description updated successfully!', {
          className: 'bg-green-500 text-white',
        });
        setEditProduct(null);
        setOriginalProduct(null);
        setEditModalOpen(false);
        setForm({
          serviceId: '',
          subscriptionName: '',
          subscriptionText: '',
          stopSMStext: '',
          price: 0,
          subscriptionValidityUnit: 'Month',
          subscriptionValidityDuration: '',
          subscriptionDescription: '',
          subscriptionProviderId: 'CSM',
          contentType: '',
          serviceURL: '',
          queryParameterKey: '',
          successApiCPurl: '',
          failureApiCPurl: '',
          autoRenewal: true,
        });
        setBannerFile(null);
        resetCallbackState();
      } else if ('error' in actionData && actionData.error) {
        toast(actionData.error, { className: 'bg-red-500 text-white' });
      }
    }
  }, [actionData, navigation.state]);
  const addTrfSrcUrl = () => {
    if (trfSrcUrls.length === 0) {
      setTrfSrcUrls(['']);
      return;
    }
    const lastUrl = trfSrcUrls[trfSrcUrls.length - 1];
    if (!lastUrl.trim()) {
      toast.error('Please enter the URL before adding another');
      return;
    }
    if (!isValidCallbackUrl(lastUrl)) {
      toast.error('Please enter a valid HTTP/HTTPS URL');
      return;
    }
    if (trfSrcUrls.slice(0, -1).includes(lastUrl)) {
      toast.error('This URL is already added. Please enter a different URL.');
      return;
    }
    setTrfSrcUrls((prev) => [...prev, '']);
  };

  const updateTrfSrcUrl = (index: number, value: string) => {
    setTrfSrcUrls((prev) => prev.map((url, i) => (i === index ? value : url)));
  };

  const removeTrfSrcUrl = (index: number) => {
    setTrfSrcUrls((prev) => prev.filter((_, i) => i !== index));
  };
  const isAddDisabled =
    trfSrcUrls.length > 0 &&
    (!trfSrcUrls[trfSrcUrls.length - 1].trim() ||
      !isValidCallbackUrl(trfSrcUrls[trfSrcUrls.length - 1]));

  const handleEdit = (prod: any) => {
    // Log when CP user clicks edit
    if (userRole === 'cp') {
      console.log(
        `CP User Edit Access: User ${userEmail || 'Unknown'
        } (CPID: ${userCpid}) clicked edit for service description: ${prod.subscriptionName} (${prod.subscriptionId_subscriptionDescription
        })`,
      );
    }

    setEditProduct(prod);
    setOriginalProduct(prod);
    setForm({
      serviceId: prod.serviceId,
      subscriptionName: prod.subscriptionName,
      subscriptionText: prod.subscriptionText,
      stopSMStext: prod.stopSMStext || '',
      price: prod.price,
      subscriptionValidityUnit: prod.subscriptionValidityUnit,
      subscriptionValidityDuration: prod.subscriptionValidityDuration,
      subscriptionDescription: prod.subscriptionDescription,
      subscriptionProviderId: prod.subscriptionProviderId,
      contentType: prod.contentType || '',
      serviceURL: prod.serviceURL || '',
      queryParameterKey: prod.queryParameterKey || '',
      successApiCPurl: prod.successApiCPurl || '',
      failureApiCPurl: prod.failureApiCPurl || '',
      autoRenewal: prod.autoRenewal !== undefined ? prod.autoRenewal : true,
    });
    setEditModalOpen(true);
  };
  const handleDeleteDraft = (prod: any) => {
    if (confirm(`Are you sure you want to delete the draft: ${prod.subscriptionName}?`)) {
      const formData = new FormData();
      formData.append('intent', 'delete_draft');
      formData.append(
        'subscriptionId_subscriptionDescription',
        prod.subscriptionId_subscriptionDescription,
      );

      encType: 'multipart/form-data';
      submit(formData, {
        method: 'post',
        encType: 'multipart/form-data',
      });
    }
  };

  const handleView = (prod: any) => {
    setEditProduct(prod);
    setOriginalProduct(prod);
    setForm({
      serviceId: prod.serviceId,
      subscriptionName: prod.subscriptionName,
      subscriptionText: prod.subscriptionText,
      stopSMStext: prod.stopSMStext || '',
      price: prod.price,
      subscriptionValidityUnit: prod.subscriptionValidityUnit,
      subscriptionValidityDuration: prod.subscriptionValidityDuration,
      subscriptionDescription: prod.subscriptionDescription,
      subscriptionProviderId: prod.subscriptionProviderId,
      contentType: prod.contentType || '',
      serviceURL: prod.serviceURL || '',
      queryParameterKey: prod.queryParameterKey || '',
      successApiCPurl: prod.successApiCPurl || '',
      failureApiCPurl: prod.failureApiCPurl || '',
      autoRenewal: prod.autoRenewal !== undefined ? prod.autoRenewal : true,
    });
    // Scroll to top of the page when view form opens
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleViewModal = (prod: any) => {
    setViewProduct(prod);
  };

  const handleCancel = () => {
    setEditProduct(null);
    setOriginalProduct(null);
    setEditModalOpen(false);
    setForm({
      serviceId: '',
      subscriptionName: '',
      subscriptionText: '',
      stopSMStext: '',
      price: 0,
      subscriptionValidityUnit: 'Month',
      subscriptionValidityDuration: '',
      subscriptionDescription: '',
      subscriptionProviderId: 'CSM',
      contentType: '',
      serviceURL: '',
      queryParameterKey: '',
      successApiCPurl: '',
      failureApiCPurl: '',
      autoRenewal: true,
    });
    setBannerFile(null);
  };

  const handleShowForm = () => {
    resetCallbackState();
    setShowForm(true);
  };
  const handleHideForm = () => {
    setShowForm(false);
    setForm({
      serviceId: '',
      subscriptionName: '',
      subscriptionText: '',
      stopSMStext: '',
      price: 0,
      subscriptionValidityUnit: 'Month',
      subscriptionValidityDuration: '',
      subscriptionDescription: '',
      subscriptionProviderId: 'CSM',
      contentType: '',
      serviceURL: '',
      queryParameterKey: '',
      successApiCPurl: '',
      failureApiCPurl: '',
      autoRenewal: true,
    });
    setBannerFile(null);
    resetCallbackState();
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const isDraftPromotion = userRole === 'cp' && editProduct?.isLive === 'draft';
    if (!bannerFile && (!editProduct || isDraftPromotion)) {
      if (isDraftPromotion && editProduct?.bannerUrl) {
        return;
      }
      e.preventDefault();
      toast('Please select a banner image', { className: 'bg-red-500 text-white' });
      return;
    }
    if (bannerFile && bannerFile.size > 5 * 1024 * 1024) {
      e.preventDefault();
      toast('File size exceeds 5 MB limit', { className: 'bg-red-500 text-white' });
      return;
    }
  };
  const handleSaveAsDraft = async () => {
    if (!form.subscriptionName || !form.subscriptionName.trim()) {
      toast.error('Subscription Name is required to save as draft');
      return;
    }
    if (!form.subscriptionDescription || !form.subscriptionDescription.trim()) {
      toast.error('Subscription Description is required to save as draft');
      return;
    }
    const fd = new FormData();
    fd.append('intent', 'save_draft');
    fd.append('serviceId', form.serviceId || '');
    fd.append('subscriptionName', form.subscriptionName || '');
    fd.append('subscriptionDescription', form.subscriptionDescription || '');
    fd.append('subscriptionText', form.subscriptionText || '');
    fd.append('stopSMStext', form.stopSMStext || '');
    fd.append('price', String(form.price || 0));
    fd.append('subscriptionValidityUnit', form.subscriptionValidityUnit || '');
    fd.append('subscriptionValidityDuration', String(form.subscriptionValidityDuration || ''));
    fd.append('subscriptionProviderId', form.subscriptionProviderId || '');
    fd.append('contentType', form.contentType || '');
    fd.append('serviceURL', form.serviceURL || '');
    fd.append('queryParameterKey', form.queryParameterKey || '');
    fd.append('successApiCPurl', form.successApiCPurl || '');
    fd.append('failureApiCPurl', form.failureApiCPurl || '');
    fd.append('autoRenewal', String(form.autoRenewal));
    if (bannerFile) fd.append('banner', bannerFile);

    const res = await fetch(window.location.pathname, { method: 'POST', body: fd });
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (res.ok) {
      toast.success('Saved as Draft!');
      handleHideForm();
      window.location.reload();
    } else {
      toast.error(data?.error || 'Failed to save draft.');
    }
  };

  const handleSelectRow = (sequenceNo: string) => {
    setSelectedForBulkAction((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sequenceNo)) newSet.delete(sequenceNo);
      else newSet.add(sequenceNo);
      return newSet;
    });
  };

  // Filter service IDs for CP users to only show their own
  const availableServiceIds =
    userRole === 'cp' && userCpid
      ? serviceIds.filter((sid: any) => sid.cpId === userCpid)
      : serviceIds;

  // Filter products based on subscription name
  const filteredProducts = products.filter((prod: any) => {
    if (prod.isLive === 'draft' && userRole !== 'cp') return false;
    const matchesName = !filterText.trim()
      ? true
      : prod.subscriptionName?.toLowerCase().includes(filterText.toLowerCase());
    const matchesServiceId = !serviceIdFilter.trim()
      ? true
      : prod.serviceId?.toLowerCase().includes(serviceIdFilter.toLowerCase());

    const isApproved =
      prod.isLive === undefined ||
      prod.isLive === null ||
      prod.isLive === true ||
      prod.isLive === 'true';
    const matchesStatus =
      statusFilter === 'ALL'
        ? prod.isLive !== 'draft'
        : statusFilter === 'APPROVED'
          ? isApproved
          : statusFilter === 'UNDER_APPROVAL'
            ? prod.isLive === 'pending'
            : statusFilter === 'SUSPENDED'
              ? prod.isLive === 'suspended'
              : statusFilter === 'DRAFT'
                ? prod.isLive === 'draft'
                : statusFilter === 'REJECTED'
                  ? prod.isLive === false
                  : false;

    return matchesName && matchesServiceId && matchesStatus;
  });

  const underApprovalProducts = filteredProducts.filter((p: any) => p.isLive === 'pending');

  // Reset visible count and scroll flag when filters change
  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
    setHasScrolled(false);
  }, [filterText, serviceIdFilter, statusFilter]);

  // Infinite scroll: load more rows when near bottom of page
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 100) setHasScrolled(true);
      const scrolledToBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300;
      if (scrolledToBottom) {
        setVisibleCount((prev) => {
          if (prev < filteredProducts.length) {
            return Math.min(prev + ITEMS_PER_PAGE, filteredProducts.length);
          }
          return prev;
        });
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [filteredProducts.length]);

  const isAllSelected =
    underApprovalProducts.length > 0 &&
    underApprovalProducts.every((p: any) =>
      selectedForBulkAction.has(p.subscriptionId_subscriptionDescription),
    );

  const toggleSelectAll = () => {
    setSelectedForBulkAction((prev) => {
      const newSet = new Set(prev);

      if (isAllSelected) {
        underApprovalProducts.forEach((p: any) =>
          newSet.delete(p.subscriptionId_subscriptionDescription),
        );
      } else {
        underApprovalProducts.forEach((p: any) =>
          newSet.add(p.subscriptionId_subscriptionDescription),
        );
      }

      return newSet;
    });
  };

  const handleApprove = (prod: any) => {
    setSelectedProduct(prod);
    setApproveModalOpen(true);
  };

  const confirmApprove = async () => {
    if (!selectedProduct) return;

    setIsApproving(true);

    try {
      const formData = new FormData();
      formData.append('intent', 'approve');
      formData.append(
        'subscriptionId_subscriptionDescription',
        selectedProduct.subscriptionId_subscriptionDescription,
      );

      const response = await fetch(window.location.pathname, {
        method: 'POST',
        body: formData,
      });



      if (response.ok) {
        toast.success('Service description approved successfully!');
        setApproveModalOpen(false);
        setSelectedProduct(null);
        // Reload the page to reflect the changes
        window.location.reload();
      } else {
        toast.error('Failed to approve service description');
      }
    } catch (error) {
      console.error('Error approving service description:', error);
      toast.error('Error approving service description');
    } finally {
      setIsApproving(false);
    }
  };
  const getStatus = (service: any) => {
    let status = 'Unknown';
    if (service.isLive === 'draft') return 'Draft';

    if (['pending'].includes(service.isLive)) status = 'Under Approval';
    else if ([true, 'true', undefined, null, ''].includes(service.isLive)) status = 'Approved';
    else if ([false].includes(service.isLive)) status = 'Rejected';
    else if (['suspended'].includes(service.isLive)) status = 'Suspended';

    return status;
  };

  const confirmBulkAction = async (action: 'bulk_approve' | 'bulk_reject') => {
    if (selectedForBulkAction.size === 0) return;

    setIsBulkProcessing(action);

    try {
      const formData = new FormData();
      formData.append('intent', action);
      formData.append('bulkActionReason', bulkActionReason);
      formData.append(
        'subscriptionId_subscriptionDescriptions',
        Array.from(selectedForBulkAction).join(','),
      );



      const response = await fetch(window.location.pathname, {
        method: 'POST',
        body: formData,
      });
      // return null;



      if (response.ok) {
        toast.success(`Service descriptions ${action} successfully!`);
        setBulkActioModalOpen(false);
        setSelectedForBulkAction(new Set());
        setBulkActionReason('');
        // Reload the page to reflect the changes
        window.location.reload();
      } else {
        toast.error(`Failed to ${action} service descriptions`);
      }
    } catch (error) {
      console.error(`Error ${action} service descriptions:`, error);
      toast.error(`Error ${action} service descriptions`);
    } finally {
      setIsBulkProcessing('');
    }
  };

  const handleReject = (prod: any) => {
    setSelectedProduct(prod);
    setRejectReason('');
    setRejectModalOpen(true);
  };
  const handleSuspend = (prod: any) => {
    setSelectedProduct(prod);
    setSuspendReason('');
    setSuspendModalOpen(true);
  };
  const handleResume = (prod: any) => {
    setSelectedProduct(prod);
    setResumeModalOpen(true);
  };

  const confirmReject = async () => {
    if (!selectedProduct || !rejectReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }

    setIsRejecting(true);

    try {
      const formData = new FormData();
      formData.append('intent', 'reject');
      formData.append(
        'subscriptionId_subscriptionDescription',
        selectedProduct.subscriptionId_subscriptionDescription,
      );
      formData.append('rejectReason', rejectReason.trim());

      console.log('Sending rejection request:', {
        intent: 'reject',
        subscriptionId_subscriptionDescription:
          selectedProduct.subscriptionId_subscriptionDescription,
        rejectReason: rejectReason.trim(),
      });

      const response = await fetch(window.location.pathname, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success('Service description rejected successfully!');
        setRejectModalOpen(false);
        setSelectedProduct(null);
        setRejectReason('');
        // Reload the page to reflect the changes
        window.location.reload();
      } else {
        // Get the error message from the response
        const errorData = await response.json();
        console.error('Rejection failed:', errorData);
        toast.error(errorData.error || 'Failed to reject service description');
      }
    } catch (error) {
      console.error('Error rejecting service description:', error);
      toast.error('Error rejecting service description');
    } finally {
      setIsRejecting(false);
    }
  };
  const confirmSuspend = async () => {
    if (!selectedProduct) return;
    if (useSuspendPeriod && !suspendEndDate) {
      toast.error('Please select suspension end date');
      return;
    }

    if (!suspendReason.trim()) {
      toast.error('Please provide suspension reason');
      return;
    }

    setIsSuspending(true);

    try {
      const formData = new FormData();
      formData.append('intent', 'suspend');
      formData.append(
        'subscriptionId_subscriptionDescription',
        selectedProduct.subscriptionId_subscriptionDescription,
      );
      formData.append('suspendReason', suspendReason.trim());
      if (useSuspendPeriod) {
        formData.append('suspendStartDate', suspendStartDate);
        formData.append('suspendEndDate', suspendEndDate);
      }

      const response = await fetch(window.location.pathname, {
        method: 'POST',
        body: formData,
      });

      ;

      if (response.ok) {
        toast.success('Service description Suspended successfully!');
        setSuspendModalOpen(false);
        setSelectedProduct(null);
        setSuspendReason('');
        setSuspendReason('');
        setSuspendStartDate('');
        setSuspendEndDate('');
        setUseSuspendPeriod(false);

        // Reload the page to reflect the changes
        window.location.reload();
      } else {
        toast.error('Failed to suspend service description');
      }
    } catch (error) {
      console.error('Error suspended service description:', error);
      toast.error('Error suspended service description');
    } finally {
      setIsApproving(false);
    }
  };
  const confirmResume = async () => {
    if (!selectedProduct) return;

    try {
      const formData = new FormData();
      formData.append('intent', 'resume');
      formData.append(
        'subscriptionId_subscriptionDescription',
        selectedProduct.subscriptionId_subscriptionDescription,
      );

      const response = await fetch(window.location.pathname, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success('Service resumed successfully!');
        setResumeModalOpen(false);
        setSelectedProduct(null);
        window.location.reload();
      } else {
        toast.error('Failed to resume service');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error resuming service');
    }
  };

  const generate_preview_url = (data: any) => {
    const baseUrl = 'http://mtn-nigeria-prod.mfilterit.org';
    // const baseUrl = 'http://localhost:3000';
    const url = new URL(
      baseUrl + '/preview-sid-page/' + data.subscriptionId_subscriptionDescription,
    );
    const queryParams = {
      sn: data.subscriptionName,
      st: data.subscriptionText,
      p: data.price,
      v: data.subscriptionValidityUnit,
      bu: data?.bannerUrl,
    };

    Object.entries(queryParams).forEach(
      ([k, v]) => v && url.searchParams.append(k, v.toString() as string),
    );
    return window.open(url.toString(), '_blank');
  };

  const preview_service = async () => {
    setIsApproving(true);
    if (
      !bannerFile ||
      !form.subscriptionName ||
      !form.subscriptionText ||
      !form.price ||
      !form.subscriptionValidityUnit
    ) {
      toast.error('Please fill all the fields');
      return;
    }
    const base64 = await fileToBase64(bannerFile);
    const subscriptionId_subscriptionDescription =
      form.serviceId + '_' + form.subscriptionDescription;
    const newFormData = new FormData();
    newFormData.append('intent', 'preview');
    newFormData.append('bannerBase64', base64);
    newFormData.append(
      'subscriptionId_subscriptionDescription',
      form.serviceId + '_' + form.subscriptionDescription,
    );
    newFormData.append('autoRenewal', String(form.autoRenewal));
    try {
      fetch('service-descriptions', {
        method: 'POST',
        body: newFormData,
      })
        .then((res) => {
          if (!res.ok) {
            return toast.error('Failed to Generate Preview');
          }

          return generate_preview_url({
            subscriptionId_subscriptionDescription,
            subscriptionName: form.subscriptionName,
            subscriptionText: form.subscriptionText,
            price: form.price,
            subscriptionValidityUnit: form.subscriptionValidityUnit,
            autoRenewal: form.autoRenewal,
          });
        })
        .finally(() => setIsApproving(false));
    } catch (error) {
      toast.error('Failed to generate preview banner');
      return;
    }

    return;
  };

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <strong>Error:</strong> {error}. Please contact your administrator.
        </div>
      )}
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-4">
        {userRole === 'cp' ? 'My Service Descriptions' : 'Service Descriptions'}
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
              <div className="flex gap-4 flex-wrap">
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Service ID</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.serviceId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Subscription Name</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.subscriptionName}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Subscription Description</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.subscriptionDescription}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Price</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.price}
                  </div>
                </div>
              </div>
              <div className="flex gap-4 flex-wrap">
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Subscription Text</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 min-h-[60px] whitespace-pre-wrap">
                    {form.subscriptionText || '-'}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Stop SMS Text</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.stopSMStext || '-'}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Validity Unit</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.subscriptionValidityUnit}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Content Type</label>
                  <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                    {form.contentType || 'NA'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Service URL</label>
                <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {form.serviceURL && form.serviceURL !== 'NA' ? (
                    <a
                      href={form.serviceURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {form.serviceURL}
                    </a>
                  ) : (
                    'NA'
                  )}
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Banner Image</label>
                {editProduct?.bannerUrl ? (
                  <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                    <img
                      src={editProduct.bannerUrl}
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
              className="space-y-6"
              encType="multipart/form-data"
              // reloadDocument
              onSubmit={handleSubmit}
            >
              {/* Basic Information Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="flex flex-col">
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
                            <p>Select the service id, this product is variant of</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <SearchableSelect
                      options={availableServiceIds.map((sid: any) => ({
                        value: sid.serviceId,
                        label: sid.serviceId,
                      }))}
                      value={form.serviceId}
                      onValueChange={(value) => setForm((f) => ({ ...f, serviceId: value }))}
                      placeholder="Select Service ID"
                      searchPlaceholder="Search Service ID..."
                      disabled={!!editProduct}
                    />
                    <input type="hidden" name="serviceId" value={form.serviceId} required />
                    {callbackType && (
                      <>
                        <input type="hidden" name="callbackType" value={callbackType} />
                        <input type="hidden" name="trfsrcName" value={trfSrcName} />

                        {trfSrcUrls.map((url, index) => (
                          <input key={index} type="hidden" name="trfsrcUrls" value={url} />
                        ))}
                      </>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="subscriptionName" className="text-sm font-medium">
                        Subscription Name
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
                            <p>This will be shown as the title of the product page</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="subscriptionName"
                      name="subscriptionName"
                      placeholder="Subscription Name"
                      value={form.subscriptionName}
                      onChange={(e) => setForm((f) => ({ ...f, subscriptionName: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="subscriptionDescription" className="text-sm font-medium">
                        Subscription Description / Plan ID
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
                            <p>
                              Enter ServiceDescription value EXACTLY as defined in SDP. Must contain
                              only digits (0-9), no letters or special characters.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="subscriptionDescription"
                      name="subscriptionDescription"
                      placeholder="Enter only digits (0-9)"
                      value={form.subscriptionDescription}
                      onChange={(e) => {
                        // Only allow digits
                        const value = e.target.value.replace(/[^0-9]/g, '');
                        setForm((f) => ({ ...f, subscriptionDescription: value }));
                      }}
                      required
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="price" className="text-sm font-medium mb-1">
                      Price
                    </label>
                    <Input
                      id="price"
                      name="price"
                      type="number"
                      placeholder="Price"
                      value={form.price}
                      onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                      required
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="subscriptionValidityUnit" className="text-sm font-medium mb-1">
                      Validity Unit
                    </label>
                    <select
                      id="subscriptionValidityUnit"
                      name="subscriptionValidityUnit"
                      value={form.subscriptionValidityUnit}
                      onChange={(e) => {
                        const unit = e.target.value as 'Day' | 'Week' | 'Month';

                        setForm((f) => ({
                          ...f,
                          subscriptionValidityUnit: unit,
                          subscriptionValidityDuration: 1,
                        }));
                      }}
                      required
                      className="border rounded px-2 py-1"
                    >
                      {VALIDITY_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="text-sm font-medium mb-1">Validity Duration</label>

                    <Input
                      type="number"
                      min={1}
                      step={1}
                      max={form.subscriptionValidityUnit === 'Month' ? 12 : undefined}
                      value={form.subscriptionValidityDuration}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setForm((f) => ({
                            ...f,
                            subscriptionValidityDuration: '',
                          }));
                          return;
                        }
                        const num = Number(raw);
                        if (!Number.isInteger(num)) return;
                        if (num < 1) {
                          toast.error('Validity duration must be greater than 0');
                          return;
                        }
                        if (form.subscriptionValidityUnit === 'Month' && num > 12) {
                          toast.error('For Month, duration must be between 1 and 12');
                          return;
                        }
                        setForm((f) => ({
                          ...f,
                          subscriptionValidityDuration: num,
                        }));
                      }}
                      required
                    />
                  </div>
                  {/* <input
                    type="hidden"
                    name="subscriptionValidityDuration"
                    value={form.subscriptionValidityDuration}
                  /> */}

                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="contentType" className="text-sm font-medium">
                        Content Type
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
                            <p>
                              Which category this product falls in?. This info is used only for
                              analytics
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <select
                      id="contentType"
                      name="contentType"
                      value={form.contentType}
                      onChange={(e) => setForm((f) => ({ ...f, contentType: e.target.value }))}
                      className="border rounded px-2 py-1"
                    >
                      <option value="">Select Content Type</option>
                      {CONTENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="queryParameterKey" className="text-sm font-medium">
                        Query Parameter Key to Track (Optional)
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
                            <p>
                              Name the key to extract from query parameters on landing page. The
                              value in this key should always change with every traffic hit. if
                              specified, this key's value will be used as SDP transaction id
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="queryParameterKey"
                      name="queryParameterKey"
                      placeholder="e.g., user_id, session_id"
                      value={form.queryParameterKey}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, queryParameterKey: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <div className="flex items-center gap-2">
                  <label htmlFor="autoRenewal" className="text-lg font-semibold  text-gray-800 dark:text-gray-200">
                    Auto Subscription
                  </label>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-gray-400 hover:text-gray-600 text-sm flex items-center justify-center"
                        >
                          ?
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Enable automatic renewal of subscriptions</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-500">OFF</label>
                  <input type="hidden" name="autoRenewal" value={String(form.autoRenewal)} />
                  <input
                    type="checkbox"
                    id="autoRenewal"
                    checked={form.autoRenewal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, autoRenewal: e.target.checked }))
                    }
                    className="w-10 h-5 appearance-none bg-gray-300 rounded-full relative cursor-pointer transition-all duration-300
      before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4 before:bg-white before:rounded-full before:shadow-md before:transition-all
      checked:bg-blue-600 checked:before:translate-x-5"
                  />

                  <label className="text-sm text-gray-500">ON</label>
                </div>
              </div>

              {/* Text Content Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Text Content
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="subscriptionText" className="text-sm font-medium">
                        Subscription Text <span className="text-red-500">*</span>
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
                            <p>This will be used as the page content. keep it short</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Textarea
                      id="subscriptionText"
                      name="subscriptionText"
                      placeholder="Subscription Text"
                      value={form.subscriptionText}
                      onChange={(e) => setForm((f) => ({ ...f, subscriptionText: e.target.value }))}
                      required
                      rows={3}
                      className="resize-none"
                    />
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="stopSMStext" className="text-sm font-medium">
                        Stop SMS Text <span className="text-red-500">*</span>
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
                            <p>
                              This information will be shown in thank-you page after successful
                              subscription submission
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Textarea
                      id="stopSMStext"
                      name="stopSMStext"
                      placeholder="Stop SMS Text"
                      value={form.stopSMStext}
                      onChange={(e) => setForm((f) => ({ ...f, stopSMStext: e.target.value }))}
                      required
                      rows={3}
                      className="resize-none"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor="serviceURL" className="text-sm font-medium">
                        Service URL (Optional)
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
                            <p>
                              Enter the url where user is redirected to, after successful SDP
                              submission. The original received query parameter, msisdn,
                              subscriptionId and subscriptionDescription will be added as query
                              parameters during redirection
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Textarea
                      id="serviceURL"
                      name="serviceURL"
                      placeholder="https://example.com"
                      value={form.serviceURL}
                      onChange={(e) => setForm((f) => ({ ...f, serviceURL: e.target.value }))}
                      rows={2}
                      className="resize-none"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1 mb-1">
                        <label htmlFor="edit-successApiCPurl" className="text-sm font-medium">
                          Callback URL - SDP Success (Optional)
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
                              <p>enter CP api path to notify sdp success</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>

                      <Textarea
                        id="edit-successApiCPurl"
                        name="successApiCPurl"
                        placeholder="http://example.com/api/success"
                        value={form.successApiCPurl}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, successApiCPurl: e.target.value }))
                        }
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1 mb-1">
                        <label htmlFor="edit-failureApiCPurl" className="text-sm font-medium">
                          Callback URL - SDP Failure (Optional)
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
                              <p>enter CP api path to notify sdp failure</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Textarea
                        id="edit-failureApiCPurl"
                        name="failureApiCPurl"
                        placeholder="http://example.com/api/failure"
                        value={form.failureApiCPurl}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, failureApiCPurl: e.target.value }))
                        }
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                  </div>
                </div>
                {/* Captive Portal Callback Section */}
                {/* <div className="mt-6">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col max-w-xs"> */}
                {/* <label className="text-sm font-medium mb-1">
                        Callback Type
                      </label> */}

                {/* <select
                        value={callbackType}
                        onChange={(e) => {
                          const value = e.target.value as CallbackType;
                          setCallbackType(value);

                          if (!value) {
                            setTrfSrcName("");
                            setTrfSrcUrls([]);
                          }
                        }}
                        className="border rounded px-2 py-1"
                      >
                        <option value="">Select Callback Type</option>
                        <option value="CAPTIVE">Captive Portal Callback</option>
                        <option value="NON_CAPTIVE">Non-Captive Portal Callback</option>
                      </select> */}
                {/* </div>

                  </div>

                  {callbackType && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <label className="text-sm font-medium whitespace-nowrap">
                          trfsrc Name
                        </label>

                        <Input
                          placeholder="Enter trfsrc name"
                          value={trfSrcName}
                          onChange={(e) => setTrfSrcName(e.target.value)}
                          className="max-w-xs"
                        />
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={addTrfSrcUrl}
                        disabled={isAddDisabled}
                      >
                        + Add Url
                      </Button> */}

                {/* {trfSrcUrls.map((url, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <div className="flex flex-col gap-1">
                            <Input
                              placeholder="https://example.com/callback"
                              value={url}
                              onChange={(e) => updateTrfSrcUrl(index, e.target.value)}
                              className="w-96"
                            />

                            {url && !isValidCallbackUrl(url) && (
                              <span className="text-xs text-red-500">
                                Please enter a valid HTTP/HTTPS URL
                              </span>
                            )}
                          </div> */}

                {/* <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeTrfSrcUrl(index)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>

                  )} */}

                {/* 
              </div>
              <br /> */}
                {/* <Button
  type="submit"
  name="intent"
  value="test_trfsrc"
  size="sm"
  variant="outline"
 className="bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
  disabled={!trfSrcName || trfSrcUrls.length === 0}
>
  Test Captive Callback
</Button> */}
              </div>

              {/* System Configuration Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  System Configuration
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="flex flex-col">
                    <label htmlFor="subscriptionProviderId" className="text-sm font-medium mb-1">
                      Provider ID
                    </label>
                    <Input
                      id="subscriptionProviderId"
                      name="subscriptionProviderId"
                      placeholder="Provider ID"
                      value={form.subscriptionProviderId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, subscriptionProviderId: e.target.value }))
                      }
                      required
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="currency" className="text-sm font-medium mb-1">
                      Currency
                    </label>
                    <Input
                      id="currency"
                      name="currency"
                      value={HARDCODED.currency}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="currencySymbol" className="text-sm font-medium mb-1">
                      Currency Symbol
                    </label>
                    <Input
                      id="currencySymbol"
                      name="currencySymbol"
                      value={HARDCODED.currencySymbol}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="nodeId" className="text-sm font-medium mb-1">
                      Node ID
                    </label>
                    <Input
                      id="nodeId"
                      name="nodeId"
                      value={HARDCODED.nodeId}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="registrationChannel" className="text-sm font-medium mb-1">
                      Registration Channel
                    </label>
                    <Input
                      id="registrationChannel"
                      name="registrationChannel"
                      value={HARDCODED.registrationChannel}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                </div>
              </div>

              {/* Banner Image Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Banner Image
                </h3>
                <div className="flex flex-col">
                  <label htmlFor="banner" className="text-sm font-medium mb-1">
                    Banner Image {!editProduct && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    id="banner"
                    name="banner"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleFileChange}
                    className="border rounded px-2 py-1"
                    required={!editProduct}
                  />
                  {bannerFile && (
                    <p className="text-sm text-gray-600 mt-1">
                      Selected: {bannerFile.name} ({Math.round(bannerFile.size / 1024)} KB)
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">The image should be of 320x 160 px</p>

                  <div className="Preview-service">
                    <div className="mt-3">
                      <Button
                        type="button"
                        className={`${bannerFile &&
                          form.price &&
                          form.subscriptionName &&
                          form.subscriptionText &&
                          form.subscriptionValidityUnit
                          ? 'bg-orange-300 hover:bg-orange-400'
                          : 'bg-gray-300 hover:bg-gray-300'
                          }`}
                        disabled={isApproving}
                        onClick={preview_service}
                      >
                        Live Service Preview
                        {isApproving ? <Loader2 className="animate-spin" /> : ''}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              {editProduct && (
                <input
                  type="hidden"
                  name="subscriptionId_subscriptionDescription"
                  value={editProduct.subscriptionId_subscriptionDescription}
                />
              )}
              {originalProduct && (
                <input
                  type="hidden"
                  name="originalProduct"
                  value={JSON.stringify(originalProduct)}
                />
              )}
              {userRole === 'cp' && editProduct?.isLive === 'draft' && (
                <input type="hidden" name="promoteDraftToPending" value="true" />
              )}
              <input
                type="hidden"
                name="subscriptionValidityDuration"
                value={form.subscriptionValidityDuration}
              />
              <div className="flex gap-2">
                <Button type="submit" name="intent" value={editProduct ? 'update' : 'create'}>
                  {navigation.state === 'submitting'
                    ? editProduct
                      ? 'Updating...'
                      : 'Creating...'
                    : editProduct
                      ? 'Update Service Description'
                      : 'Create Service Description'}
                </Button>
                {!editProduct && userRole !== 'admin' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="bg-purple-300 text-purple-900 hover:bg-purple-400"
                    onClick={handleSaveAsDraft}
                  >
                    Save as Draft
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={editProduct ? handleCancel : handleHideForm}
                >
                  Cancel
                </Button>
              </div>
            </Form>
          )}
        </div>
      )}
      <div>
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <h2 className="text-2xl font-bold flex items-center gap-4 ">
            <span className="inline-flex items-center gap-2">
              <span>All Service Descriptions</span>
            </span>
            <div className="flex gap-2 text-sm font-normal">
              <span
                className="px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                title="Total"
              >
                Total <b>{totalProducts}</b>
              </span>
              <span
                className="px-2 py-1 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                title="Approved"
              >
                Approved <b>{totalApprovedProducts}</b>
              </span>
              {userRole === 'cp' && (
                <>
                  <span
                    className="px-2 py-1 rounded bg-red-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                    title="Rejected"
                  >
                    Rejected <b>{totalRejectedProducts}</b>
                  </span>
                </>
              )}

              <span
                className="px-2 py-1 rounded bg-blue-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                title="Suspended"
              >
                Suspended <b>{totalSuspendProducts}</b>
              </span>

              <span
                className="px-2 py-1 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                title="Under Approval"
              >
                Under Approval <b>{totalUnderApprovalProducts}</b>
              </span>
              {/* <span className="px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" title="Rejected">
                Rejected <b>{totalRejectedProducts}</b>
              </span> */}
            </div>
          </h2>
        </div>
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
          <Input
            type="text"
            placeholder="Filter by subscription name..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="max-w-md"
          />

          <Input
            id="serviceIdFilter"
            type="text"
            placeholder="Filter by Service ID ..."
            value={serviceIdFilter}
            onChange={(e) => setServiceIdFilter(e.target.value)}
            className="max-w-md"
          />


          <div className="flex items-center gap-2">
            <label htmlFor="statusFilter" className="text-sm font-medium">
              Status
            </label>
            <select
              id="statusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded px-2 py-1 bg-white text-gray-900"
            >
              <option value="ALL" className="text-gray-900">
                All
              </option>
              <option value="APPROVED" className="text-gray-900">
                Approved
              </option>
              <option value="UNDER_APPROVAL" className="text-gray-900">
                Under Approval
              </option>
              <option value="SUSPENDED" className="text-gray-900">
                Suspended
              </option>
              {userRole === 'cp' && (
                <>
                  <option value="DRAFT" className="text-gray-900">
                    Draft
                  </option>
                  <option value="REJECTED" className="text-gray-900">
                    Rejected
                  </option>
                </>
              )}
            </select>
          </div>
          {statusFilter === 'UNDER_APPROVAL' && (
            <div>
              <Button type="button" variant="outline" onClick={() => setBulkActioModalOpen(true)}>
                Bulk Action
              </Button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                {statusFilter === 'UNDER_APPROVAL' && (
                  <th className="px-2 py-1 border">
                    <input
                      className="mx-auto"
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th className="px-2 py-1 border">Service ID</th>
                <th className="px-2 py-1 border">Service Description</th>
                <th className="px-2 py-1 border">Banner</th>
                <th className="px-2 py-1 border">Subscription Name</th>
                <th className="px-2 py-1 border">Price</th>
                <th className="px-2 py-1 border">Subscription Text</th>
                <th className="px-2 py-1 border">Stop SMS Text</th>
                <th className="px-2 py-1 border">Validity Unit</th>
                <th className="px-2 py-1 border">Content Type</th>
                <th className="px-2 py-1 border">Auto Subscription</th>
                <th className="px-2 py-1 border">Query Parameter Key</th>
                <th className="px-2 py-1 border">Service URL</th>
                <th className="px-2 py-1 border">Status</th>
                {(userRole !== 'cp' || statusFilter === 'DRAFT') && (
                  <th className="px-2 py-1 border">Actions</th>
                )}
                {statusFilter === 'REJECTED' && <th className="px-2 py-1 border">Reject Reason</th>}
                {/* {statusFilter === 'REJECTED' && (
                  <th className="px-2 py-1 border">Status</th>
                )} */}

                {/* {userRole !== 'cp' && <th className="px-2 py-1 border">Approve/Reject</th>} */}
              </tr>
            </thead>
            <tbody>
              {filteredProducts && filteredProducts.length > 0 ? (
                filteredProducts.slice(0, visibleCount).map((prod: any) => {
                  const [serviceId, serviceDescription] = (
                    prod.subscriptionId_subscriptionDescription || '_'
                  ).split('_');
                  return (
                    <tr
                      key={prod.subscriptionId_subscriptionDescription}
                      className="hover:bg-yellow-50 transition-colors duration-200"
                    >
                      {statusFilter === 'UNDER_APPROVAL' && (
                        <td className="px-2 py-1 border">
                          <input
                            className="mx-auto"
                            type="checkbox"
                            checked={selectedForBulkAction.has(
                              prod.subscriptionId_subscriptionDescription,
                            )}
                            onChange={() =>
                              handleSelectRow(prod.subscriptionId_subscriptionDescription)
                            }
                          />
                        </td>
                      )}
                      <td className="px-2 py-1 border">{serviceId}</td>
                      <td className="px-2 py-1 border">
                        <button
                          type="button"
                          onClick={() => handleViewModal(prod)}
                          className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                        >
                          {serviceDescription}
                        </button>
                      </td>
                      <td className="px-2 py-1 border">
                        {prod.bannerUrl ? (
                          <button
                            type="button"
                            onClick={() => setSelectedBanner(prod.bannerUrl)}
                            className="hover:opacity-80 transition-opacity"
                          >
                            <img
                              src={prod.bannerUrl}
                              alt="Banner"
                              className="h-10 w-auto rounded shadow cursor-pointer"
                            />
                          </button>
                        ) : (
                          <span className="text-gray-400">No Image</span>
                        )}
                      </td>
                      <td className="px-2 py-1 border">{prod.subscriptionName}</td>
                      <td className="px-2 py-1 border">{prod.price}</td>
                      <td className="px-2 py-1 border">
                        {prod.subscriptionText && prod.subscriptionText.length > 80 ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">
                                  {truncateText(prod.subscriptionText, 80)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md">
                                <div className="whitespace-pre-wrap text-sm">
                                  {prod.subscriptionText}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          prod.subscriptionText || '-'
                        )}
                      </td>
                      <td className="px-2 py-1 border">{prod.stopSMStext || 'Not set'}</td>
                      <td className="px-2 py-1 border">{prod.subscriptionValidityUnit}</td>
                      <td className="px-2 py-1 border">{prod.contentType || 'NA'}</td>
                      <td className="px-2 py-1 border">{prod.autoRenewal !== undefined ? (prod.autoRenewal ? 'ON' : 'OFF') : 'NA'}</td>
                      <td className="px-2 py-1 border">{prod.queryParameterKey || 'Not set'}</td>
                      <td className="px-2 py-1 border">
                        {prod.serviceURL && prod.serviceURL !== 'NA' ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={prod.serviceURL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline block truncate max-w-[150px]"
                                >
                                  {
                                    prod.serviceURL
                                      .replace(/^https?:\/\//, '')
                                      .replace(/^www\./, '')
                                      .split('/')[0]
                                  }
                                  {prod.serviceURL
                                    .replace(/^https?:\/\//, '')
                                    .replace(/^www\./, '')
                                    .split('/')[0].length > 20
                                    ? '...'
                                    : ''}
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="max-w-xs break-all">{prod.serviceURL}</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          'NA'
                        )}
                      </td>

                      <td className="px-2 py-1 border">
                        {(() => {
                          const status = getStatus(prod);

                          return (
                            <span
                              className={`inline-flex items-center justify-center w-full px-2 py-1 rounded-full text-xs font-medium text-center ${status === 'Approved'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : status === 'Rejected'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                  : status === 'Suspended'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                }`}
                            >
                              {status}
                            </span>
                          );
                        })()}
                      </td>
                      {statusFilter === 'REJECTED' && (
                        <td className="px-2 py-1 border text-center">
                          {prod.rejectReason ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className=" w-full h-full flex justify-center items-center">
                                    <Info
                                      size={25}
                                      strokeWidth={1.5}
                                      onClick={() => setViewRejectReason(prod.rejectReason)}
                                      className=" cursor-pointer"
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {/* <p className="font-semibold mb-1">Reason :</p> */}
                                  <p className="text-xs">
                                    {prod.rejectReason.length > 20
                                      ? `${prod.rejectReason.substring(0, 20)}...`
                                      : prod.rejectReason}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-gray-400">Reason not being provided</span>
                          )}
                        </td>
                      )}

                      {(userRole !== 'cp' || prod.isLive === 'draft') && (
                        <td className="px-2 py-1 border">
                          <div className="flex flex-row gap-2 py-1">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => (isViewOnly ? handleView(prod) : handleEdit(prod))}
                            >
                              {isViewOnly
                                ? 'View'
                                : userRole === 'cp' && prod.isLive === 'draft'
                                  ? 'Use Draft'
                                  : 'Edit'}
                            </Button>
                            {userRole === 'cp' && prod.isLive === 'draft' && (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteDraft(prod)}
                              >
                                Delete Draft
                              </Button>
                            )}
                            {prod.isLive === 'pending' ? (
                              userRole === 'admin' && statusFilter === 'UNDER_APPROVAL' ? (
                                <div className="flex gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="success"
                                    disabled={selectedForBulkAction.has(
                                      prod.subscriptionId_subscriptionDescription,
                                    )}
                                    onClick={() => handleApprove(prod)}
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={selectedForBulkAction.has(
                                      prod.subscriptionId_subscriptionDescription,
                                    )}
                                    onClick={() => handleReject(prod)}
                                  >
                                    Reject
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-sm text-gray-500">Under Approval.</span>
                              )
                            ) : prod.isLive === true ||
                              prod.isLive === 'true' ||
                              prod.isLive === undefined ||
                              prod.isLive === null ||
                              prod.isLive === '' ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => handleSuspend(prod)}
                              >
                                Suspend
                              </Button>
                            ) : prod.isLive === 'suspended' && userRole === 'admin' ? (
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => handleResume(prod)}
                              >
                                Resume
                              </Button>
                            ) : prod.isLive === false ? (
                              <span className="text-sm text-red-600">Rejected.</span>
                            ) : (
                              <span className="text-sm text-gray-500"></span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className="text-center py-4">
                    {filterText.trim()
                      ? 'No Service Descriptions match your filter.'
                      : 'No Service Descriptions found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Infinite scroll status */}
        {filteredProducts.length > 0 && hasScrolled && (
          <div className="mt-3 flex flex-col items-center gap-1">
            <p className="text-sm text-gray-500">
              Showing {Math.min(visibleCount, filteredProducts.length)} of {filteredProducts.length}{' '}
              service descriptions
            </p>
            {visibleCount < filteredProducts.length && (
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
            {visibleCount >= filteredProducts.length &&
              filteredProducts.length > ITEMS_PER_PAGE && (
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

      {/* Product View Modal */}
      <Dialog open={!!viewProduct} onOpenChange={(open) => !open && setViewProduct(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Service Description Details</DialogTitle>
          </DialogHeader>
          {viewProduct && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Service ID</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.serviceId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Subscription Name</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.subscriptionName}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Subscription Description</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.subscriptionDescription}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Price</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.price}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Validity Unit</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.subscriptionValidityUnit}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Content Type</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.contentType || 'NA'}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Query Parameter Key</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.queryParameterKey || 'Not set'}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Provider ID</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.subscriptionProviderId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Currency</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.currency}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Currency Symbol</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.currencySymbol}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Node ID</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.nodeId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Registration Channel</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewProduct.registrationChannel}
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Subscription Text</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {viewProduct.subscriptionText || '-'}
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Stop SMS Text</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {viewProduct.stopSMStext || '-'}
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Service URL</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                  {viewProduct.serviceURL && viewProduct.serviceURL !== 'NA' ? (
                    <a
                      href={viewProduct.serviceURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {viewProduct.serviceURL}
                    </a>
                  ) : (
                    'NA'
                  )}
                </div>
              </div>

              {viewProduct.successApiCPurl && (
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Callback URL - SDP Success</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    <a
                      href={viewProduct.successApiCPurl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {viewProduct.successApiCPurl}
                    </a>
                  </div>
                </div>
              )}

              {viewProduct.failureApiCPurl && (
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Callback URL - SDP Failure</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    <a
                      href={viewProduct.failureApiCPurl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {viewProduct.failureApiCPurl}
                    </a>
                  </div>
                </div>
              )}

              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Banner Image</label>
                {viewProduct.bannerUrl ? (
                  <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                    <img
                      src={viewProduct.bannerUrl}
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
                <Button type="button" variant="outline" onClick={() => setViewProduct(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Service Description Modal */}
      <Dialog open={editModalOpen} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {' '}
              {userRole === 'cp' && editProduct?.isLive === 'draft'
                ? `Submit Draft for Approval: ${editProduct?.subscriptionName}`
                : `Edit Service Description: ${editProduct?.subscriptionName}`}
            </DialogTitle>
          </DialogHeader>
          {editProduct && (
            <Form
              method="post"
              className="space-y-6"
              encType="multipart/form-data"
              // reloadDocument
              onSubmit={handleSubmit}
            >
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
                    <SearchableSelect
                      options={availableServiceIds.map((sid: any) => ({
                        value: sid.serviceId,
                        label: sid.serviceId,
                      }))}
                      value={form.serviceId}
                      onValueChange={(value) => setForm((f) => ({ ...f, serviceId: value }))}
                      placeholder="Select Service ID"
                      searchPlaceholder="Search Service ID..."
                      disabled={true}
                    />
                    <input type="hidden" name="serviceId" value={form.serviceId} required />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-subscriptionName" className="text-sm font-medium mb-1">
                      Subscription Name
                    </label>
                    <Input
                      id="edit-subscriptionName"
                      name="subscriptionName"
                      placeholder="Subscription Name"
                      value={form.subscriptionName}
                      onChange={(e) => setForm((f) => ({ ...f, subscriptionName: e.target.value }))}
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                      required
                    />
                  </div>
                  <div className="flex flex-col">
                    <label
                      htmlFor="edit-subscriptionDescription"
                      className="text-sm font-medium mb-1"
                    >
                      Subscription Description / Plan ID
                    </label>
                    <Input
                      id="edit-subscriptionDescription"
                      name="subscriptionDescription"
                      placeholder="Enter only digits (0-9)"
                      value={form.subscriptionDescription}
                      onChange={(e) => {
                        // Only allow digits
                        const value = e.target.value.replace(/[^0-9]/g, '');
                        setForm((f) => ({ ...f, subscriptionDescription: value }));
                      }}
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                      required
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-price" className="text-sm font-medium mb-1">
                      Price
                    </label>
                    <Input
                      id="edit-price"
                      name="price"
                      type="number"
                      placeholder="Price"
                      value={form.price}
                      onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                      required
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    />
                  </div>
                  <div className="flex flex-col">
                    <label
                      htmlFor="edit-subscriptionValidityUnit"
                      className="text-sm font-medium mb-1"
                    >
                      Validity Unit
                    </label>
                    <select
                      id="edit-subscriptionValidityUnit"
                      name="subscriptionValidityUnit"
                      value={form.subscriptionValidityUnit}
                      onChange={(e) => {
                        const unit = e.target.value as 'Day' | 'Week' | 'Month';

                        setForm((f) => ({
                          ...f,
                          subscriptionValidityUnit: unit,
                          subscriptionValidityDuration: 1,
                        }));
                      }}
                      required
                      className="border rounded px-2 py-1"
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    >
                      {VALIDITY_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label
                      htmlFor="edit-subscriptionValidityDuration"
                      className="text-sm font-medium mb-1"
                    >
                      Validity Duration
                    </label>
                    <Input
                      id="edit-subscriptionValidityDuration"
                      type="number"
                      min={1}
                      step={1}
                      max={form.subscriptionValidityUnit === 'Month' ? 12 : undefined}
                      value={form.subscriptionValidityDuration}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setForm((f) => ({ ...f, subscriptionValidityDuration: '' }));
                          return;
                        }
                        const num = Number(raw);
                        if (!Number.isInteger(num)) return;
                        if (num < 1) {
                          toast.error('Validity duration must be greater than 0');
                          return;
                        }
                        if (form.subscriptionValidityUnit === 'Month' && num > 12) {
                          toast.error('For Month, duration must be between 1 and 12');
                          return;
                        }
                        setForm((f) => ({ ...f, subscriptionValidityDuration: num }));
                      }}
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                      required
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-contentType" className="text-sm font-medium mb-1">
                      Content Type
                    </label>
                    <select
                      id="edit-contentType"
                      name="contentType"
                      value={form.contentType}
                      onChange={(e) => setForm((f) => ({ ...f, contentType: e.target.value }))}
                      className="border rounded px-2 py-1"
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    >
                      <option value="">Select Content Type</option>
                      {CONTENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-queryParameterKey" className="text-sm font-medium mb-1">
                      Query Parameter Key to Track (Optional)
                    </label>
                    <Input
                      id="edit-queryParameterKey"
                      name="queryParameterKey"
                      placeholder="e.g., user_id, session_id"
                      value={form.queryParameterKey}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, queryParameterKey: e.target.value }))
                      }
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <div className="flex items-center gap-2">
                  <label htmlFor="edit-autoRenewal" className="text-lg font-semibold  text-gray-800 dark:text-gray-200">
                    Auto Subscription
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* <button
                              type="button"
                              className="w-4 h-4 flex items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600 hover:bg-gray-300 transition"
                            >
                              ?
                            </button> */}
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Enable this to set autoRenewal true (ON) or false (OFF).</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">OFF</span>
                  <input type="hidden" name="autoRenewal" value={String(form.autoRenewal)} />
                  <input
                    id="edit-autoRenewal"
                    type="checkbox"
                    checked={form.autoRenewal}
                    disabled={
                      userRole !== 'admin' &&
                      !(userRole === 'cp' && editProduct?.isLive === 'draft')
                    }
                    onChange={(e) =>
                      setForm((f) => ({ ...f, autoRenewal: e.target.checked }))
                    }
                    className="w-10 h-5 appearance-none bg-gray-300 rounded-full relative cursor-pointer transition-all duration-300
      before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4 before:bg-white before:rounded-full before:shadow-md before:transition-all
      checked:bg-blue-600 checked:before:translate-x-5"
                  />
                  <label className="text-sm text-gray-500">ON</label>
                </div>
              </div>

              {/* Text Content Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Text Content
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <label htmlFor="edit-subscriptionText" className="text-sm font-medium mb-1">
                      Subscription Text <span className="text-red-500">*</span>
                    </label>
                    <Textarea
                      id="edit-subscriptionText"
                      name="subscriptionText"
                      placeholder="Subscription Text"
                      value={form.subscriptionText}
                      onChange={(e) => setForm((f) => ({ ...f, subscriptionText: e.target.value }))}
                      required
                      rows={3}
                      className="resize-none"
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-stopSMStext" className="text-sm font-medium mb-1">
                      Stop SMS Text <span className="text-red-500">*</span>
                    </label>
                    <Textarea
                      id="edit-stopSMStext"
                      name="stopSMStext"
                      placeholder="Stop SMS Text"
                      value={form.stopSMStext}
                      onChange={(e) => setForm((f) => ({ ...f, stopSMStext: e.target.value }))}
                      required
                      rows={3}
                      className="resize-none"
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex flex-col">
                    <label htmlFor="edit-serviceURL" className="text-sm font-medium mb-1">
                      Service URL (Optional)
                    </label>
                    <Textarea
                      id="edit-serviceURL"
                      name="serviceURL"
                      placeholder="https://example.com"
                      value={form.serviceURL}
                      onChange={(e) => setForm((f) => ({ ...f, serviceURL: e.target.value }))}
                      rows={2}
                      className="resize-none"
                      disabled={
                        userRole !== 'admin' &&
                        !(userRole === 'cp' && editProduct?.isLive === 'draft')
                      }
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1 mb-1">
                        <label htmlFor="edit-successApiCPurl" className="text-sm font-medium">
                          Callback URL - SDP Success (Optional)
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
                              <p>enter CP api path to notify sdp success</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Textarea
                        id="edit-successApiCPurl"
                        name="successApiCPurl"
                        placeholder="http://example.com/api/success"
                        value={form.successApiCPurl}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, successApiCPurl: e.target.value }))
                        }
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1 mb-1">
                        <label htmlFor="edit-failureApiCPurl" className="text-sm font-medium">
                          Callback URL - SDP Failure (Optional)
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
                              <p>enter CP api path to notify sdp failure</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Textarea
                        id="edit-failureApiCPurl"
                        name="failureApiCPurl"
                        placeholder="http://example.com/api/failure"
                        value={form.failureApiCPurl}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, failureApiCPurl: e.target.value }))
                        }
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* System Configuration Section */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  System Configuration
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="flex flex-col">
                    <label
                      htmlFor="edit-subscriptionProviderId"
                      className="text-sm font-medium mb-1"
                    >
                      Provider ID
                    </label>
                    <Input
                      id="edit-subscriptionProviderId"
                      name="subscriptionProviderId"
                      placeholder="Provider ID"
                      value={form.subscriptionProviderId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, subscriptionProviderId: e.target.value }))
                      }
                      required
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-currency" className="text-sm font-medium mb-1">
                      Currency
                    </label>
                    <Input
                      id="edit-currency"
                      name="currency"
                      value={HARDCODED.currency}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-currencySymbol" className="text-sm font-medium mb-1">
                      Currency Symbol
                    </label>
                    <Input
                      id="edit-currencySymbol"
                      name="currencySymbol"
                      value={HARDCODED.currencySymbol}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-nodeId" className="text-sm font-medium mb-1">
                      Node ID
                    </label>
                    <Input
                      id="edit-nodeId"
                      name="nodeId"
                      value={HARDCODED.nodeId}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label htmlFor="edit-registrationChannel" className="text-sm font-medium mb-1">
                      Registration Channel
                    </label>
                    <Input
                      id="edit-registrationChannel"
                      name="registrationChannel"
                      value={HARDCODED.registrationChannel}
                      readOnly
                      className="bg-gray-100"
                    />
                  </div>
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
                  {editProduct?.bannerUrl && !bannerFile && (
                    <div className="mt-2">
                      <p className="text-sm text-gray-600 mb-2">Current Banner:</p>
                      <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                        <img
                          src={editProduct.bannerUrl}
                          alt="Current Banner"
                          className="max-w-full max-h-full object-contain rounded"
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">The image should be of 320x 160 px</p>
                </div>
              </div>

              <input
                type="hidden"
                name="subscriptionId_subscriptionDescription"
                value={editProduct.subscriptionId_subscriptionDescription}
              />
              <input
                type="hidden"
                name="subscriptionValidityDuration"
                value={form.subscriptionValidityDuration}
              />
              {originalProduct && (
                <input
                  type="hidden"
                  name="originalProduct"
                  value={JSON.stringify(originalProduct)}
                />
              )}
              {userRole === 'cp' && editProduct?.isLive === 'draft' && (
                <input type="hidden" name="promoteDraftToPending" value="true" />
              )}

              <Button
                type="button"
                variant="outline"
                className="text-xs text-white bg-orange-300 hover:bg-orange-400"
                onClick={() =>
                  generate_preview_url({
                    subscriptionId_subscriptionDescription:
                      editProduct.subscriptionId_subscriptionDescription,
                    subscriptionName: editProduct.subscriptionName,
                    subscriptionText: editProduct.subscriptionText,
                    price: editProduct.price,
                    subscriptionValidityUnit: editProduct.subscriptionValidityUnit,
                    bannerUrl: editProduct.bannerUrl,
                  })
                }
                disabled={isApproving}
              >
                Preview Service
              </Button>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="submit" name="intent" value="update">
                  {userRole === 'cp' && editProduct?.isLive === 'draft'
                    ? navigation.state === 'submitting'
                      ? 'Submitting...'
                      : 'Submit for Approval'
                    : navigation.state === 'submitting'
                      ? 'Updating...'
                      : 'Update Service Description'}
                </Button>
                {userRole === 'cp' && editProduct?.isLive === 'draft' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="bg-purple-300 text-purple-900 hover:bg-purple-400"
                    disabled={navigation.state === 'submitting'}
                    onClick={async () => {
                      const fd = new FormData();
                      fd.append('intent', 'update');
                      fd.append('subscriptionId_subscriptionDescription', editProduct.subscriptionId_subscriptionDescription);
                      fd.append('serviceId', form.serviceId || '');
                      fd.append('subscriptionName', form.subscriptionName || '');
                      fd.append('subscriptionDescription', form.subscriptionDescription || '');
                      fd.append('subscriptionText', form.subscriptionText || '');
                      fd.append('stopSMStext', form.stopSMStext || '');
                      fd.append('price', String(form.price || 0));
                      fd.append('subscriptionValidityUnit', form.subscriptionValidityUnit || '');
                      fd.append('subscriptionValidityDuration', String(form.subscriptionValidityDuration || ''));
                      fd.append('subscriptionProviderId', form.subscriptionProviderId || '');
                      fd.append('contentType', form.contentType || '');
                      fd.append('serviceURL', form.serviceURL || '');
                      fd.append('queryParameterKey', form.queryParameterKey || '');
                      fd.append('successApiCPurl', form.successApiCPurl || '');
                      fd.append('failureApiCPurl', form.failureApiCPurl || '');
                      fd.append('autoRenewal', String(form.autoRenewal));
                      fd.append('originalProduct', JSON.stringify(originalProduct));
                      fd.append('isDraftUpdate', 'true');
                      // NOTE: promoteDraftToPending is intentionally NOT appended — keeps isLive as 'draft'
                      if (bannerFile) fd.append('banner', bannerFile);

                      const res = await fetch(window.location.pathname, { method: 'POST', body: fd });
                      let data: any;
                      try { data = await res.json(); } catch { data = {}; }
                      if (res.ok) {
                        toast.success('Draft updated successfully!');
                        handleCancel();
                        window.location.reload();
                      } else {
                        toast.error(data?.error || 'Failed to update draft.');
                      }
                    }}
                  >
                    Update Draft
                  </Button>
                )}

                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve Confirmation Modal */}
      <Dialog
        open={approveModalOpen}
        onOpenChange={(open) => {
          // Prevent closing modal while approving
          if (!open && isApproving) {
            return;
          }
          setApproveModalOpen(open);
          if (!open) {
            setSelectedProduct(null);
            setIsApproving(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-600">
              Are you sure you want to approve this service description?
            </p>
            {selectedProduct && (
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
                <p className="font-medium">{selectedProduct.subscriptionName}</p>
                <p className="text-sm text-gray-600">Service ID: {selectedProduct.serviceId}</p>
              </div>
            )}
            <div className="">
              <Button
                type="button"
                variant="outline"
                className="text-xs text-white bg-orange-300 hover:bg-orange-400"
                onClick={() =>
                  generate_preview_url({
                    subscriptionId_subscriptionDescription:
                      selectedProduct.subscriptionId_subscriptionDescription,
                    subscriptionName: selectedProduct.subscriptionName,
                    subscriptionText: selectedProduct.subscriptionText,
                    price: selectedProduct.price,
                    subscriptionValidityUnit: selectedProduct.subscriptionValidityUnit,
                    bannerUrl: selectedProduct.bannerUrl,
                  })
                }
                disabled={isApproving}
              >
                Preview Service
              </Button>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setApproveModalOpen(false);
                    setSelectedProduct(null);
                    setIsApproving(false);
                  }}
                  disabled={isApproving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="success"
                  onClick={confirmApprove}
                  disabled={isApproving}
                >
                  {isApproving ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Approving...
                    </div>
                  ) : (
                    'Yes, Approve'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Modal */}
      <Dialog
        open={rejectModalOpen}
        onOpenChange={(open) => {
          // Prevent closing modal while rejecting
          if (!open && isRejecting) {
            return;
          }
          setRejectModalOpen(open);
          if (!open) {
            setSelectedProduct(null);
            setRejectReason('');
            setIsRejecting(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Service Description</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-600">
              Please provide a reason for rejecting this service description:
            </p>
            {selectedProduct && (
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
                <p className="font-medium">{selectedProduct.subscriptionName}</p>
                <p className="text-sm text-gray-600">Service ID: {selectedProduct.serviceId}</p>
              </div>
            )}
            <div className="flex flex-col">
              <label htmlFor="rejectReason" className="text-sm font-medium mb-1">
                Rejection Reason *
              </label>
              <Textarea
                id="rejectReason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a detailed reason for rejection..."
                rows={4}
                className="resize-none"
                disabled={isRejecting}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="text-xs text-white bg-orange-300 hover:bg-orange-400"
              onClick={() =>
                generate_preview_url({
                  subscriptionId_subscriptionDescription:
                    selectedProduct.subscriptionId_subscriptionDescription,
                  subscriptionName: selectedProduct.subscriptionName,
                  subscriptionText: selectedProduct.subscriptionText,
                  price: selectedProduct.price,
                  subscriptionValidityUnit: selectedProduct.subscriptionValidityUnit,
                  bannerUrl: selectedProduct.bannerUrl,
                })
              }
              disabled={isApproving}
            >
              Preview Service
            </Button>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRejectModalOpen(false);
                  setRejectReason('');
                  setIsRejecting(false);
                }}
                disabled={isRejecting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmReject}
                disabled={!rejectReason.trim() || isRejecting}
              >
                {isRejecting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Rejecting...
                  </div>
                ) : (
                  'Reject'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkActioModalOpen}
        onOpenChange={(open) => {
          // Prevent closing modal while approving
          if (!open && isApproving) {
            return;
          }
          setBulkActioModalOpen(open);
          if (!open) {
            setSelectedForBulkAction(new Set());
            setBulkActioModalOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-600">
              Are you sure you want to approve this service description?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="max-h-96 overflow-y-auto">
                <h3 className="text-sm font-semibold mb-4 text-gray-800 dark:text-gray-200">
                  Selected Service
                </h3>
                {selectedForBulkAction.size > 0 ? (
                  products
                    .filter((prod: any) =>
                      selectedForBulkAction.has(prod.subscriptionId_subscriptionDescription),
                    )
                    .map((prod: any) => (
                      <div
                        key={prod.subscriptionId_subscriptionDescription}
                        className="bg-gray-50 dark:bg-gray-800 p-3 rounded"
                      >
                        <p className="font-medium">{prod.subscriptionName}</p>
                        <p className="text-sm text-gray-600">Service ID: {prod.serviceId}</p>
                      </div>
                    ))
                ) : (
                  <p className="text-gray-600">No service descriptions selected.</p>
                )}
              </div>
              <div>
                <label htmlFor="bulkActionReason" className="text-sm font-medium mb-1">
                  Reason
                </label>
                <textarea
                  id="bulkActionReason"
                  name="bulkActionReason"
                  placeholder="Reason for action"
                  onChange={(e) => setBulkActionReason(e.target.value)}
                  rows={4}
                  className="resize-none w-full p-1 outline-gray-300"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="success"
                onClick={() => confirmBulkAction('bulk_approve')}
                disabled={!!isBulkProcessing}
              >
                {isBulkProcessing === 'bulk_approve' ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Approving...
                  </div>
                ) : (
                  'Approve'
                )}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => confirmBulkAction('bulk_reject')}
                disabled={!!isBulkProcessing}
              >
                {isBulkProcessing === 'bulk_reject' ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Rejecting...
                  </div>
                ) : (
                  'Reject'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={suspendModalOpen}
        onOpenChange={(open) => {
          // Prevent closing modal while suspending
          if (!open && isSuspending) {
            return;
          }
          setSuspendModalOpen(open);
          if (!open) {
            setSelectedProduct(null);
            setSuspendReason('');
            setSuspendStartDate('');
            setSuspendEndDate('');
            setUseSuspendPeriod(false);
            setIsSuspending(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend Service Description</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-gray-600">
              Please provide a reason for suspending this service description. This action is
              temporary and the service can be resumed later.
            </p>

            {selectedProduct && (
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
                <p className="font-medium">{selectedProduct.subscriptionName}</p>
                <p className="text-sm text-gray-600">Service ID: {selectedProduct.serviceId}</p>
              </div>
            )}
            {/* Suspension Period Toggle */}
            {/* <div className="flex items-center">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer">
                Suspend for a specific period

                <Checkbox
                  checked={useSuspendPeriod}
                  onCheckedChange={(checked) => {
                    const isChecked = Boolean(checked);
                    setUseSuspendPeriod(isChecked);

                    if (isChecked) {
                      const today = new Date().toISOString().split("T")[0];
                      setSuspendStartDate(today);
                    } else {
                      setSuspendStartDate("");
                      setSuspendEndDate("");
                    }
                  }}
                />

              </label>
            </div> */}

            {/* Date Fields */}
            {useSuspendPeriod && (
              <div className="flex gap-2">
                <div className="flex flex-col">
                  <label className="text-xs">Start Date</label>
                  <Input type="date" value={suspendStartDate} disabled />
                </div>

                <div className="flex flex-col">
                  <label className="text-xs">End Date</label>
                  <Input
                    type="date"
                    value={suspendEndDate}
                    onChange={(e) => setSuspendEndDate(e.target.value)}
                    disabled={!useSuspendPeriod}
                    min={suspendStartDate}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col">
              <label className="text-sm font-medium mb-1">Suspension Reason *</label>
              <Textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Please provide the reason for suspension..."
                rows={4}
                className="resize-none"
                disabled={isSuspending}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSuspendModalOpen(false);
                  setSuspendReason('');
                  setIsSuspending(false);
                }}
                disabled={isSuspending}
              >
                Cancel
              </Button>

              <Button
                type="button"
                className="bg-orange-600 hover:bg-orange-700 text-white"
                onClick={confirmSuspend}
                disabled={!suspendReason.trim() || isSuspending}
              >
                {isSuspending ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Suspending...
                  </div>
                ) : (
                  'Suspend'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={resumeModalOpen} onOpenChange={setResumeModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resume Service</DialogTitle>
          </DialogHeader>

          <p className="text-gray-600">
            Are you sure you want to resume this service? The service will become LIVE again.
          </p>

          {selectedProduct && (
            <div className="bg-gray-50 p-3 rounded">
              <p className="font-medium">{selectedProduct.subscriptionName}</p>
              <p className="text-sm">Service ID: {selectedProduct.serviceId}</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setResumeModalOpen(false)}>
              Cancel
            </Button>

            <Button className="bg-blue-600 text-white" onClick={confirmResume}>
              Resume
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Modal to show reason on Click */}
      <Dialog open={!!viewRejectReason} onOpenChange={(open) => !open && setViewRejectReason(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-black-600">Reject Reason :</DialogTitle>
          </DialogHeader>
          <div className="bg-red-50 border border-red-100 p-4 rounded-lg">
            {/* <p className="text-sm font-medium text-red-800 mb-2">Detailed Reason:</p> */}
            <div className="text-gray-700 whitespace-pre-wrap break-words italic">
              {viewRejectReason}
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button type="button" variant="outline" onClick={() => setViewRejectReason(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
