import nodemailer from 'nodemailer';
import { getSubscriptionsBySubscriptionId } from "../app/lib/dynamodb-subscription";
import { getAllServiceIdDeatilsByServiceId } from "../app/lib/dynamodb-serviceid";

const FROM_ADDRESS = 'mFilterIt <report@mfilterit.com>';
const GLO_TEAM = '';

const CP_SUBJECT = 'Alert: CP has raised a new product request!';
const SUBJECT_GLO_RESPONSE = (status) =>
  status === 'Approved'
    ? 'Glo has approved your product submission!'
    : status === 'Suspended' ? 'Glo has suspended your product submission.' : status === 'Resumed' ? 'Glo has resumed your product — service is now LIVE.' : 'Glo has rejected your product submission.';

export async function getServiceName(serviceId) {
  const services = await getAllServiceIdDeatilsByServiceId(serviceId);
  if (!services || services.length === 0) return null;
  return services[0].serviceIdName;
}

async function sendEmail(data) {
  console.log("data", data);

  const serviceId = data?.serviceId ?? data?.serviceID;
  const serviceIdName = serviceId ? await getServiceName(serviceId) : null;
  const enrichedData = {
    ...data,
    serviceId,
    serviceIdName,
  };
  const allSubscriptions = serviceId
    ? await getSubscriptionsBySubscriptionId(serviceId)
    : [];
  const approvedLiveSubscriptions = allSubscriptions.filter(
    (item) =>
      item.isLive === true &&
      item.serviceId === serviceId
  );
  const orderedProducts = [];

  approvedLiveSubscriptions.forEach((item) => {
    const isLatest =
      item.subscriptionDescription === data.subscriptionDescription;

    if (isLatest) {
      orderedProducts.unshift(item);
    } else {
      orderedProducts.push(item);
    }
  });

  enrichedData.productDetails = orderedProducts.map((item, index) => ({
    productName: `${item.subscriptionName} (${item.subscriptionValidityDuration} ${item.subscriptionValidityUnit}${item.subscriptionValidityDuration > 1 ? 's' : ''})`,
    // If you want to use a real link later, replace 'url' with your dynamic URL logic
    activationUrl: item.activationUrl || 'url',
  }));

  const HTML_CONTENT = enrichedData?.userType === "cp" ? cp_html_content(enrichedData) : cp_glo_response_html_content(enrichedData);
  const SUBJECT = enrichedData?.userType === "cp" ? CP_SUBJECT : SUBJECT_GLO_RESPONSE(enrichedData?.status);
  
  try {
    const smtpTransport = nodemailer.createTransport({
      host: "email-smtp.ap-south-1.amazonaws.com",
      port: 587,
      secure: false, // use STARTTLS
      auth: {
        user: "AKIASB2TGVD5FZDOLLVT",
        pass: "BMpL8B6vGGVunnoe+NRB88D3cMGSOmGuGkM+SmiGY5HS",
      },
    });

    const gloEmail = [
      'user1@glo.com',
      'user2@glo.com'
    ];
    const cpEmail = data?.cpEmail;

    const toAddress = data?.userType === "cp"
      ? gloEmail           // When CP submits, notify Glo team
      : cpEmail;           // When Glo responds, notify CP

    const cc = [
      "sahil.kumar@mfilterit.com",
    ];

    const mailOptions = {
      from: FROM_ADDRESS,
      to: toAddress,
      cc: cc,
      subject: SUBJECT,
      html: HTML_CONTENT,
    };

    const info = await smtpTransport.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

const cp_html_content = (data) => {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0f3f1; padding: 40px 20px; color: #1f2937;">
    <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #047857 0%, #065f46 100%); color: #ffffff; padding: 24px 30px; text-align: left;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em;">New Product Created</h2>
        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Glo Nigeria Management Portal</p>
      </div>

      <!-- Body -->
      <div style="padding: 30px;">
        <p style="margin-top: 0; font-size: 15px; color: #374151;">Hi Team,</p>
        <p style="font-size: 14px; color: #4b5563; line-height: 1.6;">
          A new product has been created by a <strong>Content Partner</strong>. Please review the details below and take necessary action (<strong>Approve</strong> or <strong>Reject</strong>) after verification.
        </p>

        <!-- Table Container -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
          <tr style="background-color: #f9fafb;">
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 13px; color: #4b5563; width: 40%;">Content Partner Name:</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #111827;">${data.cpName}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 13px; color: #4b5563;">Product Name:</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #111827;">${data.subscriptionName}</td>
          </tr>
          <tr style="background-color: #f9fafb;">
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 13px; color: #4b5563;">Product Validity:</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #111827;">${data.subscriptionValidity}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; font-weight: 600; font-size: 13px; color: #4b5563;">Price:</td>
            <td style="padding: 12px 16px; font-size: 13px; color: #111827; font-weight: 600; color: #047857;">₦${data.price}</td>
          </tr>
        </table>

        <p style="margin-top: 24px; font-size: 13px; color: #6b7280;">
          Kindly ensure that the product complies with all required guidelines before approval.
        </p>

        <!-- CTA Button -->
        <div style="margin-top: 24px; text-align: center;">
          <a href="https://glo-nigeria-dashboard.mfilterit.org/login" 
            style="display: inline-block; padding: 12px 32px; background-color: #059669; color: #ffffff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(5, 150, 105, 0.2);">
            Go to Dashboard
          </a>
        </div>

        <p style="margin-top: 35px; font-size: 13px; color: #4b5563; border-top: 1px solid #e5e7eb; paddingTop: 20px;">
          Best regards,<br/><strong style="color: #111827;">mFilterIt Automated Notification</strong>
        </p>
      </div>

      <!-- Footer -->
      <div style="background-color: #f9fafb; text-align: center; padding: 14px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
        © ${new Date().getFullYear()} MFILTERIT. All rights reserved.
      </div>
    </div>
  </div>
  `;
};

const cp_glo_response_html_content = (data) => {
  const statusColor = data.status === 'Approved' || data.status === 'Resumed' ? '#059669' : '#dc2626';
  
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0f3f1; padding: 40px 20px; color: #1f2937;">
    <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">

      <!-- Header -->
      <div style="background: linear-gradient(135deg, #047857 0%, #065f46 100%); color: #ffffff; padding: 24px 30px; text-align: left;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em;">Glo Review Update — Product Status</h2>
        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Management Portal Notification</p>
      </div>

      <!-- Body -->
      <div style="padding: 30px;">
        <p style="margin-top: 0; font-size: 15px; color: #374151;">Dear <strong>${data.cpName}</strong>,</p>

        <p style="margin: 12px 0 20px; font-size: 13px; line-height: 1.6; color: #4b5563;">
          This is to inform you that your product submission for the service <strong>${data.serviceIdName || 'your service'}</strong> has been reviewed by <strong>Glo Nigeria</strong>. Please find the final decision below.
        </p>

        <!-- Response Details Table -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
          
          ${data.status === 'Approved' ? `
            <tr style="background-color: #f9fafb;">
              <td colspan="2" style="padding: 12px 16px; font-weight: 600; text-align: center; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #047857;">
                Product Details & Links
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 12px; color: #4b5563; width: 35%;">Master URL:</td>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 12px; word-break: break-all;">
                <a href="http://glo-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(data.serviceID || '')}?trfsrc="
                   target="_blank" style="color: #059669; text-decoration: underline;">
                  http://glo-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(data.serviceID || '')}?trfsrc=
                </a>
              </td>
            </tr>

            ${data.productDetails.map(product => `
              <tr>
                <td colspan="2" style="padding: 10px 16px; border-bottom: 1px solid #e5e7eb; background-color: ${product.isLatest ? '#ecfdf5' : '#ffffff'};">
                  <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600; color: #4b5563; width: 35%;">Name:</td>
                      <td style="padding: 4px 0; color: #111827;">
                        ${product.productName}
                        ${product.isLatest ? '<span style="color: #059669; font-weight: bold;"> (NEW)</span>' : ''}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600; color: #4b5563;">Plan ID URL:</td>
                      <td style="padding: 4px 0; word-break: break-all;">
                        ${product.activationUrl && product.activationUrl !== 'url' ? `
                          <a href="${product.activationUrl}" target="_blank" style="color: #059669; text-decoration: underline;">
                            ${product.activationUrl}
                          </a>
                        ` : `
                          <span style="color: #9ca3af; font-style: italic;">Pending activation / Coming soon</span>
                        `}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            `).join('')}
          ` : ''}

          ${['Suspended', 'Resumed', 'Rejected'].includes(data.status) ? `
            <tr style="background-color: #f9fafb;">
              <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 12px; color: #4b5563; width: 35%;">Product Name:</td>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #111827;">${data.subscriptionName}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 12px; color: #4b5563;">Product Validity:</td>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #111827;">${data.subscriptionValidity}</td>
            </tr>
          ` : ''}

          <tr>
            <td style="padding: 12px 16px; font-weight: 600; font-size: 12px; color: #4b5563; border-bottom: 1px solid #e5e7eb;">Glo Decision:</td>
            <td style="padding: 12px 16px; font-size: 12px; border-bottom: 1px solid #e5e7eb;">
              <span style="font-weight: 700; color: ${statusColor};">
                ${data.status}
              </span>
            </td>
          </tr>

          ${data.status === 'Suspended' ? `
            <tr style="background-color: #fef2f2;">
              <td style="padding: 12px 16px; font-weight: 600; font-size: 12px; color: #991b1b;">Suspension Reason:</td>
              <td style="padding: 12px 16px; font-size: 12px; color: #991b1b;">
                ${data.suspendReason || 'No reason provided by Glo.'}
              </td>
            </tr>
          ` : ''}

          ${data.status === 'Rejected' ? `
            <tr style="background-color: #fef2f2;">
              <td style="padding: 12px 16px; font-weight: 600; font-size: 12px; color: #991b1b;">Rejection Reason:</td>
              <td style="padding: 12px 16px; font-size: 12px; color: #991b1b;">
                ${data.rejectionReason || 'No reason provided by Glo.'}
              </td>
            </tr>
          ` : ''}
        </table>

        <!-- Summary Status Message -->
        <p style="margin-top: 20px; font-size: 13px; color: #4b5563; line-height: 1.5;">
          ${data.status === 'Approved'
            ? `Congratulations! Your product has been <strong>approved</strong> by Glo and will be LIVE shortly.`
            : data.status === 'Suspended'
              ? `Your product has been <strong>suspended</strong> by Glo. The service is temporarily inactive. Please review the suspension reason above.`
              : data.status === 'Resumed'
                ? `Your service has been <strong>restored</strong> by Glo and is now <strong>LIVE</strong> on the platform.`
                : `Unfortunately, your product has been <strong>rejected</strong> by Glo. Please review the rejection reason above and make necessary corrections before resubmitting.`
          }
        </p>

        <p style="margin-top: 30px; font-size: 13px; color: #4b5563; border-top: 1px solid #e5e7eb; paddingTop: 20px;">
          Best regards,<br/><strong style="color: #111827;">mFilterIt Operations Team</strong>
        </p>
      </div>

      <!-- Footer -->
      <div style="background-color: #f9fafb; text-align: center; padding: 14px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
        © ${new Date().getFullYear()} MFILTERIT. All rights reserved.
      </div>
    </div>
  </div>
  `;
};

// OTP email function
export async function sendOtpEmail(email, otp) {
  try {
    const smtpTransport = nodemailer.createTransport({
      host: "email-smtp.ap-south-1.amazonaws.com",
      port: 587,
      secure: false,
      auth: {
        user: "AKIASB2TGVD5FZDOLLVT",
        pass: "BMpL8B6vGGVunnoe+NRB88D3cMGSOmGuGkM+SmiGY5HS",
      },
    });

    const mailOptions = {
      from: FROM_ADDRESS,
      to: email,
      subject: 'Your OTP for Glo Nigeria Dashboard',
      text: `Your OTP is: ${otp}\n\nThis code will expire in 2 minutes.\n\nPlease do not share this code with anyone.`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0f3f1; padding: 40px 20px; color: #1f2937;">
          <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
            
            <div style="background: linear-gradient(135deg, #047857 0%, #065f46 100%); color: #ffffff; padding: 24px 30px; text-align: left;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Authentication Required</h2>
              <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Glo Nigeria Dashboard Verification</p>
            </div>

            <div style="padding: 35px 30px; text-align: center;">
              <p style="font-size: 15px; color: #4b5563; margin-bottom: 10px;">Your One-Time Password (OTP) is:</p>
              
              <div style="font-size: 36px; font-weight: 700; color: #047857; margin: 20px 0; letter-spacing: 6px; background-color: #f0fdf4; display: inline-block; padding: 12px 24px; border-radius: 12px; border: 1px dashed #059669;">
                ${otp}
              </div>

              <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">This code will expire in <strong>2 minutes</strong>.</p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">Please do not share this code with anyone for security reasons.</p>
            </div>

            <div style="background-color: #f9fafb; text-align: center; padding: 14px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
              © ${new Date().getFullYear()} MFILTERIT. All rights reserved.
            </div>
          </div>
        </div>
      `,
    };

    const info = await smtpTransport.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[OTP_EMAIL_ERROR] Failed to send OTP email to ${email}:`, error);
    throw error;
  }
}

export default sendEmail;