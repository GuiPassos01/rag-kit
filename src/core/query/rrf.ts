import type { SearchHit } from '../types';

export interface FusedHit {
  hit: SearchHit;
  score: number;
}

/**
 * Reciprocal Rank Fusion: cada lista contribui 1 / (k + posição) para o item.
 * Usa só a posição, não o score, porque os scores das buscas vetorial (cosseno)
 * e textual (ts_rank) não estão na mesma escala. O k = 60 vem do artigo original
 * e suaviza a diferença entre o 1º e o 2º lugar.
 */
export function reciprocalRankFusion(lists: Array<SearchHit[]>, k = 60): FusedHit[] {
  const fused = new Map<string, { hit: SearchHit; score: number }>();
  for (const list of lists) {
    list.forEach((hit, position) => {
      const entry = fused.get(hit.id) ?? { hit, score: 0 };
      fused.set(hit.id, { hit: entry.hit, score: entry.score + 1 / (k + position + 1) });
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
