import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { userDocuments, users } from '../db/schema.js';
import { toProfileType } from '../lib/profile-type.js';
import { documentPresence } from '../lib/user-documents.js';
import { requireAuth } from '../middleware/require-auth.js';

// GET /api/me — the cookie-authenticated self-view the FE store rehydrates from on reload
// (the httpOnly cookie carries the session; JS can't read it, so identity comes from here).
// Routing fields (signin parity) + the full business profile + document presence + notifications:
// the store derives identity and the profile pages render from one round-trip (D2).
export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/me', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      // requireAuth guarantees request.user; this narrows the type + defends in depth.
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
        role: users.role,
        status: users.status,
        validationNotes: users.validationNotes,
        rejectionTopics: users.rejectionTopics,
        onboardingCompleted: users.onboardingCompleted,
        contactName: users.contactName,
        businessName: users.businessName,
        taxNumber: users.taxNumber,
        contactPhone: users.contactPhone,
        fonction: users.fonction,
        businessSectorId: users.businessSectorId,
        businessType: users.businessType,
        streetAddress: users.streetAddress,
        city: users.city,
        postalCode: users.postalCode,
        governorateId: users.governorateId,
        zone: users.zone,
        bankAccountHolder: users.bankAccountHolder,
        bankRib: users.bankRib,
        bankIban: users.bankIban,
        notifyNewsUpdates: users.notifyNewsUpdates,
        notifyRemindersEvents: users.notifyRemindersEvents,
        notifyPromotionsOffers: users.notifyPromotionsOffers,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) {
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Account lookup failed.' });
    }
    // Document presence now reads user_documents (F-docs Commit 1) — the users.*_doc_url
    // columns are frozen. The wire shape stays the legacy booleans (the FE store consumes
    // them); the full grouped listing lives at GET /api/profile/documents. CIN counts present
    // only when BOTH faces are on file (recto + verso) — see documentPresence (Kais N5).
    const docRows = await db
      .select({ category: userDocuments.category, position: userDocuments.position })
      .from(userDocuments)
      .where(eq(userDocuments.userId, userId));
    return reply.status(200).send({
      user: {
        id: row.id,
        email: row.email,
        email_verified: row.emailVerified,
        role: row.role,
        status: row.status,
        // N3: the rejection reason + deficient document topics so the FE status screen renders them
        // after a reload (rehydrate).
        validation_notes: row.validationNotes,
        rejection_topics: row.rejectionTopics,
        onboarding_completed: row.onboardingCompleted,
        profile_type: toProfileType(row.role, row.businessType),
        contact_name: row.contactName,
        business_name: row.businessName,
        tax_number: row.taxNumber,
        contact_phone: row.contactPhone,
        fonction: row.fonction,
        business_sector_id: row.businessSectorId,
        business_type: row.businessType,
        street_address: row.streetAddress,
        city: row.city,
        postal_code: row.postalCode,
        governorate_id: row.governorateId,
        zone: row.zone,
        bank_account_holder: row.bankAccountHolder,
        bank_rib: row.bankRib,
        bank_iban: row.bankIban,
        documents: documentPresence(docRows),
        notifications: {
          news_updates: row.notifyNewsUpdates,
          reminders_events: row.notifyRemindersEvents,
          promotions_offers: row.notifyPromotionsOffers,
        },
      },
    });
  });
};
