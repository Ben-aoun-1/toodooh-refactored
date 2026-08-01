import { beforeEach, describe, expect, it, vi } from 'vitest';

// REV3 — the admin facture wire. The four actions must hit the four routes the api guards; a
// mistyped path here would surface as a 404 the admin cannot act on.
const spies = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { adminFacturesService } from './admin-factures.service';

beforeEach(() => {
  spies.get.mockReset();
  spies.post.mockReset();
  spies.post.mockResolvedValue({ id: 'f1', status: 'payee' });
});

describe('adminFacturesService', () => {
  it('list → GET /admin/screenhost-factures, and the statut filter rides the query', async () => {
    spies.get.mockResolvedValue([]);
    await adminFacturesService.list();
    expect(spies.get).toHaveBeenCalledWith('/admin/screenhost-factures');

    await adminFacturesService.list('en_verification');
    expect(spies.get).toHaveBeenLastCalledWith('/admin/screenhost-factures?statut=en_verification');

    // « all » is the UI's word for no filter — it must not reach the api, which would 400 on it.
    await adminFacturesService.list('all');
    expect(spies.get).toHaveBeenLastCalledWith('/admin/screenhost-factures');
  });

  it('« Voir » asks for the SIGNED document’s presigned url', async () => {
    spies.get.mockResolvedValue({ url: 'https://minio.local/signed' });
    await adminFacturesService.signedUrl('f1');
    expect(spies.get).toHaveBeenCalledWith('/admin/screenhost-factures/f1/signed-url');
  });

  it('the four actions POST to the four guarded routes', async () => {
    await adminFacturesService.valider('f1');
    expect(spies.post).toHaveBeenLastCalledWith('/admin/screenhost-factures/f1/valider', {});

    await adminFacturesService.marquerPayee('f1');
    expect(spies.post).toHaveBeenLastCalledWith('/admin/screenhost-factures/f1/marquer-payee', {});

    await adminFacturesService.paper('f1');
    expect(spies.post).toHaveBeenLastCalledWith('/admin/screenhost-factures/f1/paper', {});
  });

  it('refuser carries the motif in the body — the owner reads it in their notification', async () => {
    await adminFacturesService.refuser('f1', 'Cachet manquant.');
    expect(spies.post).toHaveBeenLastCalledWith('/admin/screenhost-factures/f1/refuser', {
      motif: 'Cachet manquant.',
    });
  });
});
