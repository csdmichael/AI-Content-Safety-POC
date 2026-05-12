import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCol,
  IonContent,
  IonGrid,
  IonItem,
  IonLabel,
  IonList,
  IonRow,
  IonText
} from '@ionic/angular/standalone';

import { ContentDocument, DocumentManifest } from '../models/document.models';
import { ContentSafetyService } from '../services/content-safety.service';
import { DocumentStoreService } from '../services/document-store.service';

@Component({
  selector: 'app-documents-page',
  standalone: true,
  imports: [
    CommonModule,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonCol,
    IonContent,
    IonGrid,
    IonItem,
    IonLabel,
    IonList,
    IonRow,
    IonText
  ],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.scss'
})
export class DocumentsPageComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(DocumentStoreService);
  private readonly contentSafety = inject(ContentSafetyService);

  readonly currentPage = signal(1);
  readonly pageSize = 10;
  readonly selectedDocument = signal<ContentDocument | null>(null);

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
    const manifest = await firstValueFrom(this.http.get<DocumentManifest>('/assets/data/manifest.json'));
    this.store.setDocuments(manifest.documents);
    this.selectedDocument.set(manifest.documents[0] ?? null);
  }

  previousPage(): void {
    this.currentPage.update((page) => Math.max(page - 1, 1));
  }

  nextPage(): void {
    this.currentPage.update((page) => Math.min(page + 1, this.pageCount()));
  }

  selectDocument(document: ContentDocument): void {
    this.selectedDocument.set(document);
  }

  processSelected(): void {
    const document = this.selectedDocument();
    if (!document) {
      return;
    }
    this.store.setResult(document.id, this.contentSafety.evaluate(document));
  }

  processCurrentPage(): void {
    this.currentPageDocs().forEach((document) => this.store.setResult(document.id, this.contentSafety.evaluate(document)));
  }

  previewUrl(document: ContentDocument): string {
    return `/${document.relativePath}`;
  }

  isImage(document: ContentDocument): boolean {
    return document.format === 'png' || document.format === 'jpg';
  }
}
