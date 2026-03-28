// Ambient declarations for GJS-specific module specifiers.
// All GJS/GNOME imports are typed as `any` — we rely on esbuild to
// leave these as external imports that GJS resolves at runtime.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module 'gi://*';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module 'resource://*';
