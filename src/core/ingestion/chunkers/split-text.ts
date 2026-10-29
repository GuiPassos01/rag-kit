export interface SplitOptions {
  size: number;
  overlap: number;
}

const BREAKPOINTS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Procura o melhor ponto de corte na segunda metade da janela, para não partir
 * frases no meio. Sem nenhum separador, corta no limite mesmo.
 */
function findCut(text: string, start: number, end: number): number {
  const minCut = start + Math.floor((end - start) / 2);
  for (const breakpoint of BREAKPOINTS) {
    const position = text.lastIndexOf(breakpoint, end - breakpoint.length);
    if (position >= minCut) return position + breakpoint.length;
  }
  return end;
}

/** Recua o início da sobreposição até o começo de uma palavra. */
function overlapStart(
  text: string,
  cut: number,
  overlap: number,
  previousStart: number,
): number {
  const target = Math.max(cut - overlap, previousStart + 1);
  const space = text.indexOf(" ", target);
  return space !== -1 && space < cut ? space + 1 : cut;
}

export function splitText(
  text: string,
  { size, overlap }: SplitOptions,
): string[] {
  if (size <= 0) throw new RangeError("size precisa ser maior que zero.");
  if (overlap < 0 || overlap >= size) {
    throw new RangeError("overlap precisa estar entre 0 e size - 1.");
  }

  const normalized = normalizeWhitespace(text);
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [normalized];

  const pieces: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    const cut =
      end === normalized.length ? end : findCut(normalized, start, end);
    const piece = normalized.slice(start, cut).trim();
    if (piece) pieces.push(piece);
    if (cut >= normalized.length) break;
    start = overlap > 0 ? overlapStart(normalized, cut, overlap, start) : cut;
  }
  return pieces;
}
