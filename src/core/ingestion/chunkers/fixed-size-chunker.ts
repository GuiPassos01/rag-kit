import type { Chunk, Chunker, Document } from '../../types';
import { splitText, type SplitOptions } from './split-text';

export class FixedSizeChunker implements Chunker {
  constructor(private readonly options: SplitOptions) {}

  chunk(document: Document): Chunk[] {
    return splitText(document.text, this.options).map((text, index) => ({
      documentId: document.id,
      index,
      text,
      metadata: document.metadata,
    }));
  }
}
