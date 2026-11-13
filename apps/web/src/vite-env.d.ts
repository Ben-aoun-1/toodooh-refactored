/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The hub's origin the admin links to (staging builds); unset = production's hub. */
  readonly VITE_HUB_URL?: string;
  /** RELEASE-1 — the commit sha this build was made from (deploy.yml); unset on a local build. */
  readonly VITE_APP_VERSION?: string;
  /** RELEASE-1 — when this build was made (ISO instant, deploy.yml). */
  readonly VITE_APP_BUILT_AT?: string;
}

declare module 'react-leaflet' {
  export * from 'react-leaflet';
}
