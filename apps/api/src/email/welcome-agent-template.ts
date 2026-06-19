const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif";

export const agentWelcomeEmailSubject = 'Bienvenue chez Toodooh — vos accès agent';

interface AgentWelcomeFields {
  name: string;
  agentCode: string;
  loginEmail: string;
  tempPassword: string;
  resetUrl: string;
}

export const agentWelcomeEmailTemplate = ({
  name,
  agentCode,
  loginEmail,
  tempPassword,
  resetUrl,
}: AgentWelcomeFields): string =>
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
      <p>Bonjour <strong>${name}</strong>,</p>
      <p>Votre compte agent Toodooh a été créé. Voici vos accès&nbsp;:</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
        <tr>
          <td style="padding:10px 12px;background:#f5f5f5;border-radius:6px 6px 0 0;color:#666666;">Code agent (connexion au hub)</td>
          <td style="padding:10px 12px;background:#f5f5f5;border-radius:0 6px 0 0;font-family:monospace;font-weight:bold;letter-spacing:2px;">${agentCode}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;color:#666666;">Email (connexion à Toodooh)</td>
          <td style="padding:10px 12px;font-weight:bold;">${loginEmail}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f5f5f5;border-radius:0 0 0 6px;color:#666666;">Mot de passe temporaire</td>
          <td style="padding:10px 12px;background:#f5f5f5;border-radius:0 0 6px 0;font-family:monospace;font-weight:bold;">${tempPassword}</td>
        </tr>
      </table>
      <p>Pour votre sécurité, choisissez votre propre mot de passe dès votre première connexion&nbsp;:</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${resetUrl}" style="background:#76E6AB;color:#204B43;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">Définir mon mot de passe</a>
      </p>
      <p>À très vite,<br>L'équipe Toodooh</p>
    </div>
    <div style="padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;color:#888888;font-size:12px;">
      <p style="margin:0 0 8px;">Toodooh, jump into smarter advertising</p>
      <p style="margin:0;">Pensez à vérifier vos spams si vous ne recevez pas l'email.</p>
    </div>
  </div>
</body>
</html>`;

export const agentWelcomeEmailPlainText = ({
  name,
  agentCode,
  loginEmail,
  tempPassword,
  resetUrl,
}: AgentWelcomeFields): string =>
  `Bonjour ${name},

Votre compte agent Toodooh a été créé. Voici vos accès :

- Code agent (connexion au hub) : ${agentCode}
- Email (connexion à Toodooh)    : ${loginEmail}
- Mot de passe temporaire        : ${tempPassword}

Pour votre sécurité, choisissez votre propre mot de passe dès votre première connexion :
${resetUrl}

À très vite,
L'équipe Toodooh

---
Toodooh, jump into smarter advertising
Pensez à vérifier vos spams si vous ne recevez pas l'email.`;
