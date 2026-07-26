import { Download, MonitorPlay } from 'lucide-react';

import logoFull from '@/assets/logo.png';
import {
  APPTV_APK_HREF,
  APPTV_DOWNLOAD_LABEL,
  APPTV_INSTALL_STEPS,
  APPTV_PITCH,
  APPTV_TITLE,
  APPTV_VERSION_LINE,
} from '@/features/apptv/lib/apptv';

/**
 * APPTV-1 — the PUBLIC TV-app download page (/apptv): no auth gate, reachable logged-out AND
 * logged-in (the /verify-email standalone-route idiom — deliberately NOT PublicRoute, which
 * bounces authed users). A TV-browser user may open this ON the television, so everything is
 * large-target and single-column; the button is a plain <a download> onto the nginx-served APK
 * (the binary is not in this repo — the path is the deploy contract).
 */
export default function AppTvDownload() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-6 py-4">
        <img src={logoFull} alt="Toodooh" className="h-10 w-auto object-contain" />
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-primary/15">
            <MonitorPlay className="h-10 w-10 text-brand-deep" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">{APPTV_TITLE}</h1>
          <p className="mt-4 max-w-xl text-lg text-gray-600">{APPTV_PITCH}</p>

          <a
            href={APPTV_APK_HREF}
            download
            className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-brand-primary px-8 py-5 text-xl font-semibold text-brand-deep hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-brand-primary/50"
          >
            <Download className="h-7 w-7" aria-hidden="true" />
            {APPTV_DOWNLOAD_LABEL}
          </a>
          <p className="mt-3 text-sm text-gray-500">{APPTV_VERSION_LINE}</p>
        </div>

        <section className="mt-12 rounded-2xl border border-gray-200 bg-gray-50 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-gray-900">Installation</h2>
          <ol className="mt-4 space-y-4">
            {APPTV_INSTALL_STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-4">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-deep text-base font-semibold text-white">
                  {i + 1}
                </span>
                <span className="pt-1 text-lg text-gray-700">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
