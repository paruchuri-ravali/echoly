// Static catalog data shared by the channel and template endpoints.
// Mirrors the data used by the dashboard's demo mock (web/src/mock/server.ts).
export const catalog = {
  email: [{ key: "resend", name: "Resend", notes: "Supports idempotency keys. Verify sending domain (DKIM/SPF)." }, { key: "aws_ses", name: "AWS SES", notes: "Sandbox until production access is granted. Bounce/complaint webhooks via SNS." }, { key: "brevo", name: "Brevo", notes: "No idempotency key; duplicate window on crash." }],
  whatsapp: [{ key: "meta_cloud_api", name: "Meta WhatsApp Cloud API", notes: "Approved templates required outside 24h window. Business verification needed." }, { key: "twilio_whatsapp", name: "Twilio WhatsApp", notes: "Fallback BSP; adds per-message markup." }],
  sms: [], push: [], in_app: [],
};

export const RESET_EMAIL = `<h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
<p>Hi {{name}},</p>
<p>We received a request to reset the password for your {{app_name}} account. Click the button below to choose a new one. This link expires in {{expires_in}}.</p>
<p style="margin:24px 0"><a href="{{link}}" style="display:inline-block;padding:11px 22px;background:#4f46e5;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>
<p style="color:#6b7280;font-size:13px">If the button doesn't work, copy and paste this link into your browser:<br>{{link}}</p>
<p style="color:#6b7280;font-size:13px">Didn't request this? You can safely ignore this email. Your password will not change.</p>`;
const contentFor = (k, v, i) =>
  i === 0
    ? { email: { subject: "Reset your {{app_name}} password", body: RESET_EMAIL }, whatsapp: { body: "{{app_name}}: use this link to reset your password (valid for {{expires_in}}): {{link}}\nIf you did not request this, ignore this message." } }
    : { email: { subject: `${k} v${v + 1} for {{name}}`, body: `<p>Hi {{name}},</p><p>Your link: <a href="{{link}}">{{link}}</a></p><p>Order {{order_id}}</p>` }, ...(i % 2 ? { whatsapp: { body: "Hi {{name}}, your order {{order_id}} is confirmed." } } : {}) };

const btn = (href, label) => `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:11px 22px;background:#4f46e5;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
export const gallery = [
  { id: "g_reset", key: "password-reset", name: "Password reset", category: "Security", description: "Reset link with expiry and a safety note.", channels: ["email", "whatsapp"], content: contentFor("password-reset", 0, 0), sample_data: { name: "Alex", app_name: "Your App", link: "https://example.com/reset/abc123", expires_in: "30 minutes" } },
  { id: "g_otp", key: "otp-code", name: "One-time passcode (OTP)", category: "Security", description: "Short verification code that expires quickly.", channels: ["email", "whatsapp"], sample_data: { name: "Alex", app_name: "Your App", code: "482913", expires_in: "10 minutes" },
    content: { email: { subject: "Your {{app_name}} verification code", body: "<h2 style=\"margin:0 0 12px\">Your verification code</h2><p>Hi {{name}}, use this code to continue:</p><p style=\"font-size:32px;letter-spacing:8px;font-weight:700;margin:20px 0\">{{code}}</p><p style=\"color:#6b7280;font-size:13px\">It expires in {{expires_in}}. Never share this code with anyone.</p>" }, whatsapp: { body: "{{code}} is your {{app_name}} verification code. It expires in {{expires_in}}. Do not share it with anyone." } } },
  { id: "g_welcome", key: "welcome", name: "Welcome email", category: "Onboarding", description: "Greets a new user with a call to action.", channels: ["email"], sample_data: { name: "Alex", app_name: "Your App", link: "https://example.com/start" },
    content: { email: { subject: "Welcome to {{app_name}}, {{name}}!", body: `<h2 style="margin:0 0 12px">Welcome aboard \u{1F44B}</h2><p>Hi {{name}}, we are glad you joined {{app_name}}. Here is where to start:</p>${btn("{{link}}", "Get started")}<p style="color:#6b7280;font-size:13px">Questions? Just reply to this email.</p>` } } },
  { id: "g_order", key: "order-confirmation", name: "Order confirmation", category: "Transactional", description: "Confirms an order with its number and total.", channels: ["email", "whatsapp"], sample_data: { name: "Alex", order_id: "A-1042", total: "$48.00", link: "https://example.com/orders/A-1042" },
    content: { email: { subject: "Order {{order_id}} confirmed", body: `<h2 style="margin:0 0 12px">Thanks for your order</h2><p>Hi {{name}}, your order <strong>{{order_id}}</strong> totalling <strong>{{total}}</strong> is confirmed.</p>${btn("{{link}}", "View order")}` }, whatsapp: { body: "Hi {{name}}, your order {{order_id}} ({{total}}) is confirmed. Track it here: {{link}}" } } },
  { id: "g_appt", key: "appointment-reminder", name: "Appointment reminder", category: "Reminders", description: "Reminds a customer of an upcoming appointment.", channels: ["email", "whatsapp"], sample_data: { name: "Alex", date: "Fri 14 Nov", time: "10:30 AM", place: "Main Street Clinic" },
    content: { email: { subject: "Reminder: your appointment on {{date}}", body: "<h2 style=\"margin:0 0 12px\">Appointment reminder</h2><p>Hi {{name}}, this is a reminder of your appointment on <strong>{{date}}</strong> at <strong>{{time}}</strong>, {{place}}.</p>" }, whatsapp: { body: "Hi {{name}}, reminder: your appointment is on {{date}} at {{time}}, {{place}}. Reply 1 to confirm." } } },
];

export const defaultBranding = {
  logo_url: "", brand_color: "#4f46e5", accent_color: "#0e9f8e", sender_name: "", font: "system", preset: "classic",
  header_style: "bar", header_bg: "", tagline: "", show_stripe: true,
  width: 600, page_bg: "#f4f5f7", card_bg: "#ffffff", text_color: "#222222", link_color: "", radius: 0, font_size: 15,
  button_style: "solid", button_radius: 8, pre_footer_text: "",
  footer_text: "You are receiving this email because you have an account with us.", postal_address: "", footer_bg: "#ffffff", footer_text_color: "#6b7280",
  social_links: [], show_unsubscribe: true, unsubscribe_text: "Unsubscribe",
};

/** Required credential fields per provider (secret fields are write-only). */
export const PROVIDER_FIELDS = {
  brevo: [{ key: "api_key", label: "API key", secret: true }],
  resend: [{ key: "api_key", label: "API key", secret: true }],
  aws_ses: [{ key: "access_key_id", label: "Access key ID" }, { key: "secret_access_key", label: "Secret access key", secret: true }, { key: "region", label: "Region" }],
  meta_cloud_api: [{ key: "phone_number_id", label: "Phone number ID" }, { key: "waba_id", label: "WhatsApp business account ID" }, { key: "access_token", label: "Access token", secret: true }, { key: "app_secret", label: "App secret", secret: true }],
  twilio_whatsapp: [{ key: "account_sid", label: "Account SID" }, { key: "auth_token", label: "Auth token", secret: true }, { key: "from", label: "From number" }],
};
export const PROVIDER_NAMES = { brevo: "Brevo", resend: "Resend", aws_ses: "AWS SES", meta_cloud_api: "Meta WhatsApp Cloud API", twilio_whatsapp: "Twilio WhatsApp" };
