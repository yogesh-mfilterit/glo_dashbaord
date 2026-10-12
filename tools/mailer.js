import nodemailer from 'nodemailer';
import { getSubscriptionsBySubscriptionId } from "../app/lib/dynamodb-subscription"
import { getAllServiceIdDeatilsByServiceId } from "../app/lib/dynamodb-serviceid";


const FROM_ADDRESS = 'mFilterIt <report@mfilterit.com>';
// const TO_ADDRESS = 'abhyudaya.singh@mfilterit.com';
const MTN_TEAM = '';

const CP_SUBJECT = 'Alert: CP has raised a new product request!';
const SUBJECT_MTN_RESPONSE = (status) =>
  status === 'Approved'
    ? 'MTN has approved your product submission!'
    : status === 'Suspended' ? 'MTN has Suspended your product submission.' : status === 'Resumed' ? 'MTN has Resumed your product — service is now LIVE.' : 'MTN has rejected your product submission.';

export async function getServiceName(serviceId) {
  const services = await getAllServiceIdDeatilsByServiceId(serviceId);
  if (!services || services.length === 0) return null;
  return services[0].serviceIdName;
}

async function sendEmail(data) {
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
    activationUrl: `http://mtn-nigeria-prod.mfilterit.org/sid/${item.serviceId}/${item.subscriptionDescription}?trfsrc=`,
    isLatest: index === 0 && data?.status === "Approved",
  }));


  //console.log({ data });
  const HTML_CONTENT = enrichedData?.userType === "cp" ? cp_html_content(enrichedData) : cp_mtn_response_html_content(enrichedData);
  const SUBJECT = enrichedData?.userType === "cp" ? CP_SUBJECT : SUBJECT_MTN_RESPONSE(enrichedData?.status);
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

    // Dynamically set recipient based on userType
    const mtnEmail = [
      'emmanuel.ayanwale2@mtn.com',
      'ndifreke.okon@mtn.com'
    ];
    const cpEmail = data?.cpEmail; // You may update this fallback as needed

    const toAddress = data?.userType === "cp"
      ? mtnEmail           // When CP submits, notify MTN team (recipient is MTN)
      : cpEmail;           // When MTN responds, notify CP (recipient is CP)

    const cc = [
      "mohi.gupta@mfilterit.com",
      "mohit.kumar@mfilterit.com",
      "vishwa.tripathi@mfilterit.com",
      "abhyudaya.singh@mfilterit.com",
      "unnat.singh@mfilterit.com",
    ]

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
  <div style="font-family: Arial, sans-serif; background-color: #f8f9fb; padding: 30px; color: #333;">
  <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); overflow: hidden;">
    
    <!-- Header -->
    <div style="background-color: #0073e6; color: #ffffff; padding: 15px 25px;">
      <h2 style="margin: 0; font-size: 18px;">New Product Created — Action Required</h2>
    </div>

    <!-- Body -->
    <div style="padding: 25px;">
      <p>Hi Team,</p>
      <p>
        A new product has been created by one of our <strong>Content Partners</strong>.
        Please review the details below and take the necessary action 
        (<strong>Approve</strong> or <strong>Reject</strong>) after verification.
      </p>

      <!-- Table -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <tr style="background-color: #f2f6fa;">
          <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Content Partner Name:</td>
          <td style="padding: 10px; border: 1px solid #dce3eb;">${data.cpName}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Name:</td>
          <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionName}</td>
        </tr>
        <tr style="background-color: #f2f6fa;">
          <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Validity:</td>
          <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionValidity}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Price:</td>
          <td style="padding: 10px; border: 1px solid #dce3eb;">₦${data.price}</td>
        </tr>
      </table>

      <p style="margin-top: 20px;">
        Kindly ensure that the product complies with all required guidelines before approval.
      </p>

      <div style="margin-top: 18px; text-align: center;">
        <a href="https://mtn-nigeria-dashboard.mfilterit.org/login" 
          style="display: inline-block; padding: 12px 28px; background-color: #0073e6; color: #fff; border-radius: 5px; text-decoration: none; font-weight: bold; font-size: 16px;">
          Go to Dashboard
        </a>
      </div>

      <p style="margin-top: 30px;">Best regards,<br/><strong>MFILTERIT Automated Notification</strong></p>
    </div>

    <!-- Footer -->
    <div style="background-color: #f1f4f8; text-align: center; padding: 10px; font-size: 12px; color: #777;">
      © ${new Date().getFullYear()} MFILTERIT. All rights reserved.
    </div>
  </div>
</div>

`;
}

const cp_mtn_response_html_content = (data) => {
  return `
  <div style="font-family: Arial, sans-serif; background-color: #f8f9fb; padding: 30px; color: #333;">
    <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); overflow: hidden;">

      <!-- Header -->
      <div style="background-color: #0073e6; color: #ffffff; padding: 15px 25px;">
        <h2 style="margin: 0; font-size: 18px;">MTN Review Update — Product Status</h2>
      </div>

      <!-- Body -->
      <div style="padding: 25px;">
        <p>Dear <strong>${data.cpName}</strong>,</p>

        <p>
        <p style=" margin: 12px 0 16px;font-size: 12px;line-height: 1.6;color: #333;">
  This is to inform you that your product submission for the service <strong >${data.serviceIdName || 'your service'}</strong>
  has been reviewed by <strong>MTN Nigeria</strong>. Please find the final decision below.</p>
<!-- Response Details -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
${data.status === 'Approved'
      ? `
<tr>
  <td colspan="2" style="padding:10px;font-weight:bold;text-align:center;border:1px solid #dce3eb;">
    Product Details
  </td>
</tr>
<tr>
  <td style="padding:10px;border:1px solid #dce3eb;font-weight:bold;font-size:12px">
    Master URL:
  </td>
  <td style="padding:10px;border:1px solid #dce3eb;font-size:12px">
    <a href="http://mtn-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(data.serviceID || '')}?trfsrc="
       target="_blank" style="color:#0073e6;text-decoration:underline;">
      http://mtn-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(data.serviceID || '')}?trfsrc=
    </a>
  </td>
</tr>
<tr>
  <td colspan="2">
    <hr style="border:none;border-top:1px solid #dce3eb;margin:10px 0;" />
  </td>
</tr>

${data.productDetails.map(product => `
<tr style="font-size:11px;">
  <td colspan="2" style="padding:0; border:1px solid #dce3eb;">
    <table style="width:100%; border-collapse:collapse;">
      
      <tr style="${product.isLatest ? 'background-color:#eef5ff;' : ''}">
        <td style="padding:8px 10px 4px; font-weight:bold;">Name:</td>
        <td style="padding:8px 10px 4px;">
          ${product.productName}
          ${product.isLatest ? '<span style="color:#28a745;font-weight:bold;"> (NEW)</span>' : ''}
        </td>
      </tr>

      <tr>
        <td style="padding:8px 10px 4px; font-weight:bold;">Plan ID URL:</td>
        <td style="padding:8px 10px 4px; word-break:break-all;">
          <a href="${product.activationUrl}" target="_blank"
             style="color:#0073e6;text-decoration:underline;">
            ${product.activationUrl}
          </a>
        </td>
      </tr>

    </table>
  </td>
</tr>

<tr>
  <td colspan="2">
    <hr style="border:none;border-top:1px solid #dce3eb;margin:10px 0;" />
  </td>
</tr>
`).join('')}


<tr>
  <td style="padding:10px;border:1px solid #dce3eb;font-weight:bold;font-size:12px">
    MTN Decision:
  </td>
  <td style="padding:10px;border:1px solid #dce3eb;font-size:12px">
    <span style="font-weight:bold; color:${data.status === 'Approved' ? '#28a745' : '#dc3545'};">
      ${data.status}
    </span>
  </td>
</tr>

`
      : ''
    }




  ${data.status === 'Suspended'
      ? `
      <tr style="background-color: #f2f6fa;">
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Name:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Validity:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionValidity}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">MTN Decision:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb;">
              <span style="font-weight: bold; color: ${data.status === 'Approved' ? '#28a745' : '#dc3545'};">
                ${data.status}
              </span>
            </td>
          </tr>

          <tr style="background-color: #fff5f5;">
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Suspended Reason:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb; color: #b71c1c;">
              ${data.suspendReason || 'No reason provided by MTN.'}
            </td>
          </tr>`
      : ''
    }
    ${data.status === 'Resumed'
      ? `
  <tr style="background-color: #f2f6fa;">
    <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Name:</td>
    <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionName}</td>
  </tr>
  <tr>
    <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Validity:</td>
    <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionValidity}</td>
  </tr>
  <tr>
    <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">MTN Decision:</td>
    <td style="padding: 10px; border: 1px solid #dce3eb;">
      <span style="font-weight: bold; color: #28a745;">Resumed</span>
    </td>
  </tr>
  <tr style="background-color: #f0fff4;">
    <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Master URL:</td>
    <td style="padding: 10px; border: 1px solid #dce3eb;">
      <a href="http://mtn-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(data.serviceID || '')}?trfsrc="
         target="_blank" style="color:#0073e6; text-decoration:underline;">
        http://mtn-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(data.serviceID || '')}?trfsrc=
      </a>
    </td>
  </tr>`
      : ''
    }

          ${data.status === 'Rejected'
      ? `
      <tr style="background-color: #f2f6fa;">
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Name:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">Product Validity:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb;">${data.subscriptionValidity}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;">MTN Decision:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb;">
              <span style="font-weight: bold; color: ${data.status === 'Approved' ? '#28a745' : '#dc3545'};">
                ${data.status}
              </span>
            </td>
          </tr>

          <tr style="background-color: #fff5f5;">
            <td style="padding: 10px; border: 1px solid #dce3eb; font-weight: bold;font-size:12px">Rejection Reason:</td>
            <td style="padding: 10px; border: 1px solid #dce3eb; color: #b71c1c;font-size:12px">
              ${data.rejectionReason || 'No reason provided by MTN.'}
            </td>
          </tr>`
      : ''
    }
        </table >

        <p style="margin-top: 20px;font-size:12px">
          ${data.status === 'Approved'
      ? `Congratulations! Your product has been <strong>approved</strong> by MTN and will be LIVE shortly.`
      : data.status === 'Suspended'
        ? `Your product has been <strong>suspended</strong> by MTN. The service is temporarily inactive. Please review the suspension reason above.`
        : data.status === 'Resumed'
          ? `Your Service has been <strong>restored</strong> by MTN and is now <strong>LIVE</strong> on the platform.`
          : `Unfortunately, your product has been <strong>rejected</strong> by MTN. Please review the rejection reason above and make the necessary corrections before resubmitting.`
    }
        </p>

        <p style="margin-top: 30px; font-size:12px">Best regards,<br/><strong>MFILTERIT Operations Team</strong></p>
      </div >


  <div style="background-color: #f1f4f8; text-align: center; padding: 10px; font-size: 12px; color: #777;">
    © ${new Date().getFullYear()} MFILTERIT. All rights reserved.
  </div>
    </div >
  </div > `;
};




// OTP email function
export async function sendOtpEmail(email, otp) {
  // console.log(`[OTP_EMAIL] Attempting to send OTP email to ${email} with OTP: ${otp}`);
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
      subject: 'Your OTP for MTN Nigeria Dashboard',
      text: `Your OTP is: ${otp}\n\nThis code will expire in 2 minutes.\n\nPlease do not share this code with anyone.`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f8f9fb; padding: 30px; color: #333;">
          <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); overflow: hidden;">
            <div style="background-color: #0073e6; color: #ffffff; padding: 15px 25px;">
              <h2 style="margin: 0; font-size: 18px;">Your OTP for MTN Nigeria Dashboard</h2>
            </div>
            <div style="padding: 25px; text-align: center;">
              <p style="font-size: 16px; margin-bottom: 20px;">Your OTP is:</p>
              <div style="font-size: 32px; font-weight: bold; color: #0073e6; margin: 20px 0; letter-spacing: 5px;">${otp}</div>
              <p style="color: #666; margin-top: 20px;">This code will expire in <strong>2 minutes</strong>.</p>
              <p style="color: #999; font-size: 12px; margin-top: 30px;">Please do not share this code with anyone.</p>
            </div>
            <div style="background-color: #f1f4f8; text-align: center; padding: 10px; font-size: 12px; color: #777;">
              © ${new Date().getFullYear()} MFILTERIT. All rights reserved.
            </div>
          </div>
        </div>
      `,
    };

    const info = await smtpTransport.sendMail(mailOptions);
    // console.log(`[OTP_EMAIL_SUCCESS] OTP email sent to ${email}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[OTP_EMAIL_ERROR] Failed to send OTP email to ${email}:`, error);
    throw error;
  }
}

export default sendEmail;