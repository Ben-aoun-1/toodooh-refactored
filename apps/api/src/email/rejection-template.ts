const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif";

// N3 Scenario 1 — the account-rejection notification. `topics` are the deficient document areas
// ('legal' = RNE/CIN, 'bank' = RIB); both the email and the /account-rejected screen label them.
export const REJECTION_TOPIC_LABELS_FR: Record<string, string> = {
  legal: 'Documents légaux (RNE / CIN)',
  bank: 'Coordonnées bancaires (RIB)',
};

const topicLabels = (topics: string[]): string[] =>
  topics.map((t) => REJECTION_TOPIC_LABELS_FR[t] ?? t);

export const rejectionEmailSubject = 'Votre inscription Toodooh a été rejetée';

export const rejectionEmailTemplate = ({
  name,
  notes,
  topics,
}: {
  name: string;
  notes: string;
  topics: string[];
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
      <p>Après examen, votre inscription à Toodooh n'a pas pu être validée pour le moment.</p>
      <p style="margin:24px 0 8px;"><strong>Motif&nbsp;:</strong></p>
      <p style="background:#f5f5f5;border-radius:6px;padding:12px 16px;margin:0 0 24px;">${notes}</p>
      <p style="margin:0 0 8px;"><strong>Documents à corriger&nbsp;:</strong></p>
      <ul style="margin:0 0 24px;padding-left:20px;">
        ${topicLabels(topics)
          .map((label) => `<li>${label}</li>`)
          .join('\n        ')}
      </ul>
      <p>Connectez-vous à votre compte pour consulter le détail&nbsp;; vous pourrez corriger les éléments concernés.</p>
      <p>À très vite,<br>L'équipe Toodooh</p>
    </div>
    <div style="padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;color:#888888;font-size:12px;">
      <p style="margin:0 0 8px;">Toodooh, jump into smarter advertising</p>
      <p style="margin:0;">Pensez à vérifier vos spams si vous ne recevez pas l'email.</p>
    </div>
  </div>
</body>
</html>`;

export const rejectionEmailPlainText = ({
  name,
  notes,
  topics,
}: {
  name: string;
  notes: string;
  topics: string[];
}): string =>
  `Bonjour ${name},

Après examen, votre inscription à Toodooh n'a pas pu être validée pour le moment.

Motif :
${notes}

Documents à corriger :
${topicLabels(topics)
  .map((label) => `- ${label}`)
  .join('\n')}

Connectez-vous à votre compte pour consulter le détail ; vous pourrez corriger les éléments concernés.

À très vite,
L'équipe Toodooh

---
Toodooh, jump into smarter advertising
Pensez à vérifier vos spams si vous ne recevez pas l'email.`;
