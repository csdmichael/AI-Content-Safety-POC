import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  IonBadge,
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
  IonRow
} from '@ionic/angular/standalone';

import { ContentDocument } from '../models/document.models';
import { DocumentStoreService } from '../services/document-store.service';

@Component({
  selector: 'app-results-page',
  standalone: true,
  imports: [
    CommonModule,
    IonBadge,
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
    IonRow
  ],
  templateUrl: './results-page.component.html',
  styleUrl: './results-page.component.scss'
})
export class ResultsPageComponent {
  private readonly store = inject(DocumentStoreService);

  readonly selectedDocument = signal<ContentDocument | null>(null);
  readonly processed = this.store.processedDocuments;

  readonly kpis = computed(() => {
    const docs = this.processed();
    const safe = docs.filter((doc) => doc.processed?.category === 'safe').length;
    const review = docs.filter((doc) => doc.processed?.category === 'review').length;
    const blocked = docs.filter((doc) => doc.processed?.category === 'blocked').length;
    return { total: docs.length, safe, review, blocked };
  });

  readonly grouped = computed(() => {
    const docs = this.processed();
    return {
      safe: docs.filter((doc) => doc.processed?.category === 'safe'),
      review: docs.filter((doc) => doc.processed?.category === 'review'),
      blocked: docs.filter((doc) => doc.processed?.category === 'blocked')
    };
  });

  selectDocument(document: ContentDocument): void {
    this.selectedDocument.set(document);
  }

  previewUrl(document: ContentDocument): string {
    return `/${document.relativePath}`;
  }

  isImage(document: ContentDocument): boolean {
    return document.format === 'png' || document.format === 'jpg';
  }
}
