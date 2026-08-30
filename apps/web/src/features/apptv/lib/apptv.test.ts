import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APPTV_APK_HREF,
  APPTV_DOWNLOAD_LABEL,
  APPTV_INSTALL_STEPS,
  APPTV_PITCH,
  APPTV_TITLE,
  APPTV_VERSION_LINE,
} from './apptv';

// APPTV-1 — the public download page's pinned contract: the APK path is a DEPLOY contract
// (nginx serves it; the architect places the file), the French copy is chartered verbatim.

describe('the APK path contract', () => {
  it('pins /downloads/toodooh-tv.apk (nginx-served; never invent another path)', () => {
    expect(APPTV_APK_HREF).toBe('/downloads/toodooh-tv.apk');
  });
});

describe('the chartered French copy', () => {
  it('pins the title, pitch, button label and version line', () => {
    expect(APPTV_TITLE).toBe("L'application TV Toodooh");
    expect(APPTV_PITCH).toBe('Diffusez les campagnes de votre établissement sur votre téléviseur.');
    expect(APPTV_DOWNLOAD_LABEL).toBe("Télécharger l'APK (Android TV)");
    expect(APPTV_VERSION_LINE).toBe('Version 1.4.1');
  });

  it('pins the four install steps in order', () => {
    expect(APPTV_INSTALL_STEPS).toEqual([
      'Autoriser les sources inconnues dans les paramètres de la TV.',
      'Transférer le fichier APK sur la TV (clé USB ou lien direct depuis le navigateur de la TV).',
      "Ouvrir le fichier et installer l'application.",
      "Lancer Toodooh TV et associer l'écran à votre établissement.",
    ]);
  });
});

describe('the route is PUBLIC (pinned against the router source)', () => {
  const appSource = readFileSync(
    fileURLToPath(new URL('../../../App.tsx', import.meta.url)),
    'utf8',
  );

  it('declares /apptv', () => {
    expect(appSource).toContain('path="/apptv"');
  });

  it('declares it STANDALONE — no guard wrapper (the /verify-email idiom, reachable in AND out)', () => {
    // The route's element block, from its path attribute to the closing tag.
    const start = appSource.indexOf('path="/apptv"');
    expect(start).toBeGreaterThan(-1);
    const block = appSource.slice(start, appSource.indexOf('/>', start) + 2);
    for (const guard of ['PublicRoute', 'ProtectedRoute', 'AdminRoute', 'AgentRoute']) {
      expect(block).not.toContain(guard);
    }
    expect(block).toContain('<AppTvDownload />');
  });
});
