interface VerificationEmailParams {
  name: string;
  verificationUrl: string;
  // better-auth types the `role` additionalField as string, so we accept string
  // and map known roles with a defensive fallback (no cast needed).
  role: string;
}

export const verificationEmailSubject = 'Vérifiez votre adresse email Toodooh';

// "annonceur" (advertiser) / "diffuseur" (screen owner) / "Toodooh" (fallback).
const accountSuffix = (role: string): string => {
  if (role === 'advertiser') return 'annonceur';
  if (role === 'individual_owner' || role === 'fleet_owner') return 'diffuseur';
  return 'Toodooh';
};

// Role-aware "Et maintenant ?" bullets. Empty array → fallback single sentence.
const nextStepsBullets = (role: string): string[] => {
  if (role === 'advertiser') {
    return [
      "Vous présenter notre catalogue d'écrans disponibles en Tunisie",
      'Vous accompagner dans la création de votre première campagne publicitaire',
    ];
  }
  if (role === 'individual_owner' || role === 'fleet_owner') {
    return [
      "Effectuer les mesures d'affluence sur votre site",
      "Installer l'application Toodooh sur votre écran afin de le connecter au réseau",
    ];
  }
  return [];
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif";

export const verificationEmailTemplate = ({
  name,
  verificationUrl,
  role,
}: VerificationEmailParams): string => {
  const suffix = accountSuffix(role);
  const bullets = nextStepsBullets(role);
  const nextSteps =
    bullets.length > 0
      ? `<p style="margin:24px 0 8px;">🚀 <strong>Et maintenant ?</strong><br>Notre équipe prendra contact avec vous dans les tout prochains jours pour&nbsp;:</p>
      <ul style="margin:0 0 16px;padding-left:20px;">
        ${bullets.map((b) => `<li>${b}</li>`).join('\n        ')}
      </ul>`
      : `<p style="margin:24px 0 16px;">🚀 <strong>Et maintenant ?</strong><br>Notre équipe prendra contact avec vous dans les tout prochains jours pour finaliser votre inscription.</p>`;

  return `<!doctype html>
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
      <p>Merci de vous être inscrit sur Toodooh.</p>
      <p>Avant d'activer votre compte ${suffix}, nous devons vérifier que cette adresse e-mail vous appartient.</p>
      <p>Cliquez sur le bouton ci-dessous pour confirmer votre e-mail et finaliser votre inscription&nbsp;:</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${verificationUrl}" style="background:#76E6AB;color:#204B43;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">Valider mon inscription</a>
      </p>
      ${nextSteps}
      <p style="margin:24px 0 16px;">💡 <strong>Vous êtes plus qu'un partenaire</strong><br>En rejoignant Toodooh à ce stade, vous contribuez à bâtir un nouveau modèle de publicité locale intelligente, 100&nbsp;% digital, mesurable et équitable.</p>
      <p>Votre confiance nous inspire et nous motive à repousser les limites de ce que peut être la communication dans le monde réel.</p>
      <p>Nous vous remercions sincèrement pour votre engagement et votre enthousiasme. L'aventure ne fait que commencer, et nous sommes ravis de vous compter parmi les pionniers de Toodooh.</p>
      <p>À très vite,<br>L'équipe Toodooh</p>
    </div>
    <div style="padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;color:#888888;font-size:12px;">
      <p style="margin:0 0 8px;">Toodooh, jump into smarter advertising</p>
      <p style="margin:0;">6, Rue du lac Biwa<br>Tunis</p>
    </div>
  </div>
</body>
</html>`;
};

export const verificationEmailPlainText = ({
  name,
  verificationUrl,
  role,
}: VerificationEmailParams): string => {
  const suffix = accountSuffix(role);
  const bullets = nextStepsBullets(role);
  const nextSteps =
    bullets.length > 0
      ? `Et maintenant ?
Notre équipe prendra contact avec vous dans les tout prochains jours pour :
 - ${bullets.join('\n - ')}`
      : `Et maintenant ?
Notre équipe prendra contact avec vous dans les tout prochains jours pour finaliser votre inscription.`;

  return `Bonjour ${name},

Merci de vous être inscrit sur Toodooh.

Avant d'activer votre compte ${suffix}, nous devons vérifier que cette adresse e-mail vous appartient.

Pour confirmer votre e-mail, ouvrez ce lien :
${verificationUrl}

${nextSteps}

Vous êtes plus qu'un partenaire
En rejoignant Toodooh à ce stade, vous contribuez à bâtir un nouveau modèle de publicité locale intelligente, 100 % digital, mesurable et équitable.

Votre confiance nous inspire et nous motive à repousser les limites de ce que peut être la communication dans le monde réel.

Nous vous remercions sincèrement pour votre engagement et votre enthousiasme. L'aventure ne fait que commencer, et nous sommes ravis de vous compter parmi les pionniers de Toodooh.

À très vite,
L'équipe Toodooh

---
Toodooh, jump into smarter advertising
6, Rue du lac Biwa, Tunis`;
};
