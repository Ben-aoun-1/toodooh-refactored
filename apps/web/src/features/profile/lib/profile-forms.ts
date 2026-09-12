/**
 * The Paramètres form shapes, and the ONE mapping from saved values into each of them
 * (CANCEL-NOOP1, Mejri 07/09).
 *
 * « Annuler » must put a form back exactly where hydration first put it. That only holds if
 * hydration and cancel share a single mapping — five hand-written copies would drift the moment a
 * field is added, and the first symptom would be a cancel that silently keeps an edit. So the
 * hydration effect and every cancel handler in ProfileSettings both call the builders below.
 *
 * These live in a pure module because apps/web has no render harness: a rule that stays inside the
 * .tsx is a rule nobody can pin.
 */

/** The saved profile, as the wrapper page hands it to ProfileSettings. */
export interface ProfileFormInitialValues {
  last_name: string;
  first_name: string;
  fonction: string;
  contact_phone: string;
  business_name: string;
  tax_number: string;
  business_sector_id: string;
  company_size: string;
  number_of_screens: string;
  number_of_rooms: string;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  zone: string;
  notify_news_updates: boolean;
  notify_reminders_events: boolean;
  notify_promotions_offers: boolean;
}

export interface ResponsableForm {
  last_name: string;
  first_name: string;
  fonction: string;
  contact_phone: string;
}
export interface EntrepriseForm {
  business_name: string;
  tax_number: string;
  business_sector_id: string;
  company_size: string;
  number_of_screens: string;
  number_of_rooms: string;
}
export interface AdresseForm {
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  zone: string;
}
export interface NotificationsForm {
  notify_news_updates: boolean;
  notify_reminders_events: boolean;
  notify_promotions_offers: boolean;
}
export interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const responsableFormFrom = (v: ProfileFormInitialValues): ResponsableForm => ({
  last_name: v.last_name,
  first_name: v.first_name,
  fonction: v.fonction,
  contact_phone: v.contact_phone,
});

export const entrepriseFormFrom = (v: ProfileFormInitialValues): EntrepriseForm => ({
  business_name: v.business_name,
  tax_number: v.tax_number,
  business_sector_id: v.business_sector_id,
  company_size: v.company_size,
  number_of_screens: v.number_of_screens,
  number_of_rooms: v.number_of_rooms,
});

export const adresseFormFrom = (v: ProfileFormInitialValues): AdresseForm => ({
  street_address: v.street_address,
  city: v.city,
  postal_code: v.postal_code,
  governorate_id: v.governorate_id,
  zone: v.zone,
});

export const notificationsFormFrom = (v: ProfileFormInitialValues): NotificationsForm => ({
  notify_news_updates: v.notify_news_updates,
  notify_reminders_events: v.notify_reminders_events,
  notify_promotions_offers: v.notify_promotions_offers,
});

/**
 * The password sub-form has nothing saved to return to, so cancelling clears it. The validity
 * ticks under « Nouveau mot de passe » derive from newPassword, so they clear with it.
 */
export const emptyPasswordForm = (): PasswordForm => ({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
