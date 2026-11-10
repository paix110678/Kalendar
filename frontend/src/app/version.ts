declare const __KALENDAR_VERSION__: string;

export const KALENDAR_VERSION =
  typeof __KALENDAR_VERSION__ === 'undefined' ? 'dev' : __KALENDAR_VERSION__;
