import nodemailer from "nodemailer";
import { getSubscriptionsBySubscriptionId } from "../app/lib/dynamodb-subscription";
import { getAllServiceIdDeatilsByServiceId } from "../app/lib/dynamodb-serviceid";

const FROM_ADDRESS = "mFilterIt <report@mfilterit.com>";
const GLO_TEAM = "";

const CP_SUBJECT = "Alert: CP has raised a new product request!";
const SUBJECT_GLO_RESPONSE = (status) =>
  status === "Approved"
    ? "Glo has approved your product submission!"
    : status === "Suspended"
    ? "Glo has suspended your product submission."
    : status === "Resumed"
    ? "Glo has resumed your product — service is now LIVE."
    : "Glo has rejected your product submission.";

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
    (item) => item.isLive === true && item.serviceId === serviceId,
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
    productName: `${item.subscriptionName} (${
      item.subscriptionValidityDuration
    } ${item.subscriptionValidityUnit}${
      item.subscriptionValidityDuration > 1 ? "s" : ""
    })`,
    // If you want to use a real link later, replace 'url' with your dynamic URL logic
    activationUrl: item.activationUrl || "url",
    isLatest: item.subscriptionDescription === data.subscriptionDescription,
  }));

  const HTML_CONTENT =
    enrichedData?.userType === "cp"
      ? cp_html_content(enrichedData)
      : cp_glo_response_html_content(enrichedData);
  const SUBJECT =
    enrichedData?.userType === "cp"
      ? CP_SUBJECT
      : SUBJECT_GLO_RESPONSE(enrichedData?.status);

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

    const gloEmail = ["user1@glo.com", "user2@glo.com"];
    const cpEmail = data?.cpEmail;

    const toAddress =
      data?.userType === "cp"
        ? gloEmail // When CP submits, notify Glo team
        : cpEmail; // When Glo responds, notify CP

    const cc = ["sahil.kumar@mfilterit.com"];

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

/* ================================================================== */
/*  EMAIL DESIGN (only this part changed)                              */
/*  simple, table based, inline styles — works in Gmail / Outlook      */
/* ================================================================== */
const FONT = "Arial, Helvetica, sans-serif";
const GREEN = "#047857";
const DASHBOARD_URL = "https://glo-nigeria-dashboard.mfilterit.org/login";
const STATUS_COLOR = {
  Approved: "#047857",
  Resumed: "#047857",
  Suspended: "#b45309",
  Rejected: "#b91c1c",
};

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]),
  );
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : "");

const layout = (title, content) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;font-family:${FONT};color:#374151;font-size:14px;line-height:1.6;">
    <tr><td style="padding:20px 28px;border-bottom:3px solid ${GREEN};font-size:12px;color:#6b7280;">
      <strong style="color:#111827;">mFilterIt</strong> &nbsp;|&nbsp; Glo Nigeria Portal
    </td></tr>
    <tr><td style="padding:28px;">
      <h2 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#111827;font-weight:600;">${esc(
        title,
      )}</h2>
      ${content}
      <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;">Best regards,<br><strong style="color:#111827;">mFilterIt Team</strong></p>
    </td></tr>
    <tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
      Automated message, please do not reply. &copy; ${new Date().getFullYear()} MFILTERIT
    </td></tr>
  </table>
</td></tr></table>`;

/** rows: [[label, safeHtmlValue], ...] */
const table = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-collapse:collapse;">${rows
    .filter(Boolean)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;width:36%;background:#f9fafb;font-size:13px;color:#6b7280;">${esc(
          k,
        )}</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">${v}</td></tr>`,
    )
    .join("")}</table>`;

const button = (href, label) =>
  `<p style="margin:24px 0 0;"><a href="${safeUrl(
    href,
  )}" target="_blank" style="display:inline-block;padding:11px 24px;background:${GREEN};color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${esc(
    label,
  )}</a></p>`;

const link = (url) =>
  `<a href="${safeUrl(
    url,
  )}" target="_blank" style="color:${GREEN};word-break:break-all;">${esc(
    url,
  )}</a>`;

// CP raised a product -> Glo team
const cp_html_content = (data) =>
  layout(
    "New product request",
    `
    <p style="margin:0 0 14px;">Hi Team,</p>
    <p style="margin:0 0 18px;">A Content Partner has created a new product. Please review the details and <strong>approve</strong> or <strong>reject</strong> it.</p>
    ${table([
      ["Content Partner", esc(data.cpName)],
      data.serviceIdName ? ["Service", esc(data.serviceIdName)] : null,
      ["Product", esc(data.subscriptionName)],
      ["Validity", esc(data.subscriptionValidity)],
      ["Price", `<strong>&#8358;${esc(data.price)}</strong>`],
    ])}
    ${button(DASHBOARD_URL, "Go to dashboard")}`,
  );

// Glo decision -> CP
const cp_glo_response_html_content = (data) => {
  const color = STATUS_COLOR[data.status] || "#374151";
  const decision = `<strong style="color:${color};">${esc(
    data.status,
  )}</strong>`;

  const message =
    {
      Approved: "Your product has been approved and will be LIVE shortly.",
      Resumed: "Your service has been restored and is now LIVE.",
      Suspended:
        "Your product has been suspended and the service is temporarily inactive.",
    }[data.status] ||
    "Your product has been rejected. Please make the necessary corrections before resubmitting.";

  let details;
  if (data.status === "Approved") {
    const masterUrl = `http://glo-nigeria-prod.mfilterit.org/sid/${encodeURIComponent(
      data.serviceId || data.serviceID || "",
    )}?trfsrc=`;
    details = table([
      ["Decision", decision],
      ["Master URL", link(masterUrl)],
      ...(data.productDetails || []).map((p) => [
        p.isLatest ? `${p.productName} (new)` : p.productName,
        p.activationUrl && p.activationUrl !== "url" && safeUrl(p.activationUrl)
          ? link(p.activationUrl)
          : '<span style="color:#9ca3af;">Pending activation</span>',
      ]),
    ]);
  } else {
    details = table([
      ["Product", esc(data.subscriptionName)],
      ["Validity", esc(data.subscriptionValidity)],
      ["Decision", decision],
      data.status === "Suspended"
        ? [
            "Suspension reason",
            esc(data.suspendReason || "No reason provided by Glo."),
          ]
        : null,
      data.status === "Rejected"
        ? [
            "Rejection reason",
            esc(data.rejectionReason || "No reason provided by Glo."),
          ]
        : null,
    ]);
  }

  return layout(
    "Product status update",
    `
    <p style="margin:0 0 14px;">Dear <strong>${esc(data.cpName)}</strong>,</p>
    <p style="margin:0 0 18px;">Your product submission for <strong>${esc(
      data.serviceIdName || "your service",
    )}</strong> has been reviewed by Glo Nigeria. ${message}</p>
    ${details}`,
  );
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
      subject: "Your OTP for Glo Nigeria Dashboard",
      text: `Your OTP is: ${otp}\n\nThis code will expire in 2 minutes.\n\nPlease do not share this code with anyone.`,
      html: layout(
        "Your verification code",
        `
        <p style="margin:0 0 16px;">Use this one-time password to sign in to the Glo Nigeria Dashboard:</p>
        <p style="margin:0 0 16px;padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;text-align:center;font-family:Consolas,Menlo,monospace;font-size:30px;letter-spacing:8px;font-weight:700;color:${GREEN};">${esc(
          otp,
        )}</p>
        <p style="margin:0 0 6px;">This code expires in <strong>2 minutes</strong>.</p>
        <p style="margin:0;font-size:12px;color:#6b7280;">Do not share this code with anyone. If you did not request it, ignore this email.</p>`,
      ),
    };

    const info = await smtpTransport.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(
      `[OTP_EMAIL_ERROR] Failed to send OTP email to ${email}:`,
      error,
    );
    throw error;
  }
}

export default sendEmail;
