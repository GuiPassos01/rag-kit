import type { ChatPrompt, RetrievedChunk } from '../types';

export interface Source {
  index: number;
  documentId: string;
  label: string;
  score: number;
  similarity: number | null;
  excerpt: string;
}

const SYSTEM_PROMPT = `Você é um assistente que responde perguntas usando apenas os trechos de documentos fornecidos.

Regras:
- Use somente as informações dos trechos. Não use conhecimento próprio.
- Se os trechos não trazem a resposta, diga que não encontrou essa informação na base.
- Cite a fonte de cada afirmação com o número do trecho entre colchetes, ex.: [1] ou [2][3].
- Responda em português, de forma direta.`;

export function sourceLabel({ metadata }: Pick<RetrievedChunk, 'metadata'>): string {
  const parts = [String(metadata.source ?? metadata.title ?? 'desconhecida')];
  if (typeof metadata.page === 'number') parts.push(`p. ${metadata.page}`);
  if (typeof metadata.section === 'string') parts.push(metadata.section);
  return parts.join(' · ');
}

export function excerpt(text: string, max = 280): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function toSources(chunks: RetrievedChunk[]): Source[] {
  return chunks.map((chunk, i) => ({
    index: i + 1,
    documentId: chunk.documentId,
    label: sourceLabel(chunk),
    score: chunk.score,
    similarity: chunk.similarity,
    excerpt: excerpt(chunk.text),
  }));
}

export function buildPrompt(question: string, chunks: RetrievedChunk[]): ChatPrompt {
  const context = chunks
    .map((chunk, i) => `[${i + 1}] (fonte: ${sourceLabel(chunk)})\n${chunk.text}`)
    .join('\n\n---\n\n');
  return {
    system: SYSTEM_PROMPT,
    user: `Trechos:\n\n${context}\n\nPergunta: ${question}`,
  };
}
