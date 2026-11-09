/** Canvas textures must not be drawn before the self-hosted fonts are ready. */
let ready: Promise<void> | null = null;

export function ensureFonts(): Promise<void> {
  if (ready) return ready;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return (ready = Promise.resolve());
  ready = Promise.race([
    Promise.all([
      fonts.load("700 64px 'Cinzel Variable'"),
      fonts.load("800 64px 'Cinzel Variable'"),
      fonts.load("700 64px 'Montserrat Variable'"),
      fonts.load("800 64px 'Montserrat Variable'"),
    ]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, 2500)),
  ]).catch(() => undefined);
  return ready;
}

export const DISPLAY = "'Cinzel Variable', Georgia, serif";
export const UI = "'Montserrat Variable', 'Helvetica Neue', Arial, sans-serif";
