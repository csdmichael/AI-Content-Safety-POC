import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonBadge,
  IonButton,
  IonContent,
  IonProgressBar,
  IonSpinner,
  IonText
} from '@ionic/angular/standalone';

import { ContentDocument, DocumentManifest } from '../models/document.models';
import { ContentSafetyService } from '../services/content-safety.service';
import { DocumentStoreService } from '../services/document-store.service';
import { ApiClientService } from '../services/api-client.service';
import { SafeResourceUrlPipe } from '../pipes/safe-resource-url.pipe';

@Component({
  selector: 'app-documents-page',
  standalone: true,
  imports: [
    CommonModule,
    SafeResourceUrlPipe,
    IonBadge,
    IonButton,
    IonContent,
    IonProgressBar,
    IonSpinner,
    IonText
  ],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.scss'
})
export class DocumentsPageComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(DocumentStoreService);
  private readonly contentSafety = inject(ContentSafetyService);
  private readonly api = inject(ApiClientService);

  readonly currentPage = signal(1);
  readonly pageSize = 10;
  readonly selectedDocument = signal<ContentDocument | null>(null);
  readonly loading = signal(false);
  readonly processingProgress = signal<{ current: number; total: number } | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly documents = this.store.documents;
  readonly pageCount = computed(() => Math.max(Math.ceil(this.documents().length / this.pageSize), 1));
  readonly currentPageDocs = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize;
    return this.documents().slice(start, start + this.pageSize);
  });

  constructor() {
    void this.loadDocuments();
  }

  async loadDocuments(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const manifest = await firstValueFrom(this.http.get<DocumentManifest>('/assets/data/manifest.json'));
      this.store.setDocuments(manifest.documents);
      this.selectedDocument.set(manifest.documents[0] ?? null);
      if (manifest.documents[0]) {
        void this.loadBlobPreview(manifest.documents[0]);
      }

      try {
        const results = await this.contentSafety.fetchAllResults();
        results.forEach((value, id) => this.store.setResult(id, value));
      } catch (err) {
        console.error('Failed to hydrate processed results from API.', err);
      }
    } catch (err: any) {
      console.error('Failed to load documents.', err);
      this.errorMessage.set('Failed to load document manifest.');
    } finally {
      this.loading.set(false);
    }
  }

  previousPage(): void {
    this.currentPage.update((page) => Math.max(page - 1, 1));
  }

  nextPage(): void {
    this.currentPage.update((page) => Math.min(page + 1, this.pageCount()));
  }

  selectDocument(document: ContentDocument): void {
    this.selectedDocument.set(document);
    void this.loadBlobPreview(document);
  }

  async loadBlobPreview(doc: ContentDocument): Promise<void> {
    if (doc.blobPreviewUrl) return;
    try {
      const url = await this.api.getDownloadUrl(doc.fileName);
      this.store.setBlobPreviewUrl(doc.id, url);
      const updated = this.documents().find((d) => d.id === doc.id);
      if (updated) this.selectedDocument.set(updated);
    } catch {
      // Fallback to local path silently
    }
  }

  async processSelected(): Promise<void> {
    const document = this.selectedDocument();
    if (!document) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const result = await this.contentSafety.fetchResult(document.id);
      if (result) {
        this.store.setResult(document.id, result);
        const updated = this.documents().find((d) => d.id === document.id);
        if (updated) this.selectedDocument.set(updated);
      }
    } catch (err: any) {
      this.errorMessage.set(`Failed to process ${document.fileName}: ${err.message || 'API error'}`);
    } finally {
      this.loading.set(false);
    }
  }

  async processCurrentPage(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const docs = this.currentPageDocs();
    this.processingProgress.set({ current: 0, total: docs.length });
    try {
      for (let i = 0; i < docs.length; i++) {
        const result = await this.contentSafety.fetchResult(docs[i].id);
        if (result) this.store.setResult(docs[i].id, result);
        this.processingProgress.set({ current: i + 1, total: docs.length });
      }
    } catch (err: any) {
      this.errorMessage.set(`Processing error: ${err.message || 'API error'}`);
    } finally {
      this.loading.set(false);
      this.processingProgress.set(null);
    }
  }

  async processAll(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const docs = this.documents();
    this.processingProgress.set({ current: 0, total: docs.length });
    try {
      for (let i = 0; i < docs.length; i++) {
        const result = await this.contentSafety.fetchResult(docs[i].id);
        if (result) this.store.setResult(docs[i].id, result);
        this.processingProgress.set({ current: i + 1, total: docs.length });
      }
    } catch (err: any) {
      this.errorMessage.set(`Processing error: ${err.message || 'API error'}`);
    } finally {
      this.loading.set(false);
      this.processingProgress.set(null);
    }
  }

  previewUrl(document: ContentDocument): string {
    return document.blobPreviewUrl || `/${document.relativePath}`;
  }

  docViewerUrl(doc: ContentDocument): string {
    return `https://docs.google.com/gview?url=${encodeURIComponent(doc.blobPreviewUrl!)}&embedded=true`;
  }

  isImage(document: ContentDocument): boolean {
    return document.format === 'png' || document.format === 'jpg';
  }

  onImageError(event: Event, doc: ContentDocument): void {
    const img = event.target as HTMLImageElement;
    const localPath = `/${doc.relativePath}`;
    if (!img.src.endsWith(doc.relativePath)) {
      img.src = localPath;
    }
  }

  formatColor(format: string): string {
    switch (format) {
      case 'png': case 'jpg': return 'primary';
      case 'pdf': return 'tertiary';
      case 'docx': return 'secondary';
      case 'pptx': return 'dark';
      default: return 'medium';
    }
  }

  categoryColor(doc: ContentDocument): string {
    if (!doc.processed) return 'medium';
    switch (doc.processed.category) {
      case 'safe': return 'success';
      case 'review': return 'warning';
      case 'blocked': return 'danger';
      default: return 'medium';
    }
  }
}
