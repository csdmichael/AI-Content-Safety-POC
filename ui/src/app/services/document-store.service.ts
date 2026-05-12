import { Injectable, computed, signal } from '@angular/core';

import { ContentDocument, SafetyCategoryResult } from '../models/document.models';

@Injectable({ providedIn: 'root' })
export class DocumentStoreService {
  private readonly docs = signal<ContentDocument[]>([]);

  readonly documents = this.docs.asReadonly();
  readonly processedDocuments = computed(() => this.docs().filter((doc) => !!doc.processed));

  setDocuments(documents: ContentDocument[]): void {
    this.docs.set(documents);
  }

  setResult(id: string, result: SafetyCategoryResult): void {
    this.docs.update((documents) => documents.map((doc) => (doc.id === id ? { ...doc, processed: result } : doc)));
  }
}
