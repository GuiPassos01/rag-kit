import type { Chunk, Chunker, Document, MediaType } from '../../types';

/** Escolhe o chunker pelo tipo do documento: markdown por seção, o resto por tamanho. */
export class MediaTypeChunker implements Chunker {
  constructor(
    private readonly byMediaType: Partial<Record<MediaType, Chunker>>,
    private readonly fallback: Chunker,
  ) {}

  chunk(document: Document): Chunk[] {
    return (this.byMediaType[document.mediaType] ?? this.fallback).chunk(document);
  }
}
