const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif";

export const resetEmailSubject = 'Réinitialisation de votre mot de passe Toodooh';

export const resetEmailTemplate = ({
  name,
  resetUrl,
}: {
  name: string;
  resetUrl: string;
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
      <p>Bonjour <strong>${name}</strong>,</p>
      <p>Nous avons reçu une demande de réinitialisation du mot de passe de votre compte Toodooh.</p>
      <p>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe&nbsp;:</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${resetUrl}" style="background:#76E6AB;color:#204B43;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">Réinitialiser mon mot de passe</a>
      </p>
      <p>Ce lien expire dans une heure.</p>
      <p style="margin:24px 0 16px;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe restera inchangé.</p>
      <p>À très vite,<br>L'équipe Toodooh</p>
    </div>
    <div style="padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;color:#888888;font-size:12px;">
      <p style="margin:0 0 8px;">Toodooh, jump into smarter advertising</p>
      <p style="margin:0;">Pensez à vérifier vos spams si vous ne recevez pas l'email.</p>
    </div>
  </div>
</body>
</html>`;

export const resetEmailPlainText = ({
  name,
  resetUrl,
}: {
  name: string;
  resetUrl: string;
}): string =>
  `Bonjour ${name},

Nous avons reçu une demande de réinitialisation du mot de passe de votre compte Toodooh.

Pour choisir un nouveau mot de passe, ouvrez ce lien (il expire dans une heure) :
${resetUrl}

Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe restera inchangé.

À très vite,
L'équipe Toodooh

---
Toodooh, jump into smarter advertising
Pensez à vérifier vos spams si vous ne recevez pas l'email.`;
