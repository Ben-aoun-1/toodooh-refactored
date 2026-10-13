const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif";

// AGT-6 (agent specs v1.0 §8) — the email double of an agent notification, on the Toodooh
// email charter (reset-template.ts): the notification's title and body, and a button to the
// page « Consulter » opens.

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const agentNoticeEmailTemplate = ({
  name,
  title,
  body,
  url,
}: {
  name: string;
  title: string;
  body: string;
  url: string;
}): string =>
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:24px 0;background:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;font-family:${FONT};color:#333333;">
    <div style="padding:30px;text-align:center;border-bottom:1px solid #e0e0e0;">
      <span style="font-size:28px;font-weight:bold;color:#204B43;letter-spacing:-0.5px;">toodooh</span>
    </div>
    <div style="padding:30px;font-size:14px;line-height:1.5;">
      <p>Bonjour <strong>${escape(name)}</strong>,</p>
      <p style="font-size:16px;font-weight:bold;color:#204B43;">${escape(title)}</p>
      <p>${escape(body)}</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${url}" style="background:#76E6AB;color:#204B43;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">Consulter</a>
      </p>
      <p>À très vite,<br>L'équipe Toodooh</p>
    </div>
    <div style="padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;color:#888888;font-size:12px;">
      <p style="margin:0 0 8px;">Toodooh, jump into smarter advertising</p>
      <p style="margin:0;">Gérez vos préférences dans Paramètres, onglet Notifications.</p>
    </div>
  </div>
</body>
</html>`;

export const agentNoticeEmailPlainText = ({
  name,
  title,
  body,
  url,
}: {
  name: string;
  title: string;
  body: string;
  url: string;
}): string =>
  `Bonjour ${name},

${title}

${body}

Consulter : ${url}

À très vite,
L'équipe Toodooh
`;
