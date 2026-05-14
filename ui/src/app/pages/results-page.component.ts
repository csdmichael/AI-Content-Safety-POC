import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import {
  IonBadge,
  IonContent
} from '@ionic/angular/standalone';

import { ContentDocument } from '../models/document.models';
import { DocumentStoreService } from '../services/document-store.service';
import { ApiClientService } from '../services/api-client.service';
import { SafeResourceUrlPipe } from '../pipes/safe-resource-url.pipe';

@Component({
  selector: 'app-results-page',
  standalone: true,
  imports: [
    CommonModule,
    SafeResourceUrlPipe,
    IonBadge,
    IonContent
  ],
  templateUrl: './results-page.component.html',
  styleUrl: './results-page.component.scss'
})
export class ResultsPageComponent implements AfterViewInit {
  private readonly store = inject(DocumentStoreService);
  private readonly api = inject(ApiClientService);

  @ViewChild('chartCanvas', { static: false }) chartCanvas!: ElementRef<HTMLCanvasElement>;

  readonly selectedDocument = signal<ContentDocument | null>(null);
  readonly processed = this.store.processedDocuments;

  readonly kpis = computed(() => {
    const docs = this.processed();
    const safe = docs.filter((doc) => doc.processed?.category === 'safe').length;
    const review = docs.filter((doc) => doc.processed?.category === 'review').length;
    const blocked = docs.filter((doc) => doc.processed?.category === 'blocked').length;
    return { total: docs.length, safe, review, blocked };
  });

  readonly accuracy = computed(() => {
    const docs = this.processed();
    if (docs.length === 0) return 0;
    const correct = docs.filter((doc) => {
      const expected = doc.expectedContentSafetyOutcome;
      const actual = doc.processed?.category;
      return (expected === 'pass' && actual === 'safe') || (expected === 'fail' && (actual === 'blocked' || actual === 'review'));
    }).length;
    return correct / docs.length;
  });

  readonly formatBreakdown = computed(() => {
    const docs = this.processed();
    const map: Record<string, number> = {};
    for (const doc of docs) {
      map[doc.format] = (map[doc.format] || 0) + 1;
    }
    return Object.entries(map).map(([format, count]) => ({ format, count }));
  });

  readonly grouped = computed(() => {
    const docs = this.processed();
    return {
      safe: docs.filter((doc) => doc.processed?.category === 'safe'),
      review: docs.filter((doc) => doc.processed?.category === 'review'),
      blocked: docs.filter((doc) => doc.processed?.category === 'blocked')
    };
  });

  ngAfterViewInit(): void {
    this.drawChart();
  }

  private drawChart(): void {
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { safe, review, blocked, total } = this.kpis();
    if (total === 0) {
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.fillText('No results yet', canvas.width / 2, canvas.height / 2);
      return;
    }

    const data = [
      { label: 'Safe', value: safe, color: '#2dd36f' },
      { label: 'Review', value: review, color: '#ffc409' },
      { label: 'Blocked', value: blocked, color: '#eb445a' }
    ].filter((d) => d.value > 0);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 20;
    let startAngle = -Math.PI / 2;

    for (const d of data) {
      const sliceAngle = (d.value / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();

      // Label
      const midAngle = startAngle + sliceAngle / 2;
      const lx = cx + (radius * 0.65) * Math.cos(midAngle);
      const ly = cy + (radius * 0.65) * Math.sin(midAngle);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${d.label} (${d.value})`, lx, ly);

      startAngle += sliceAngle;
    }
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
      const updated = this.store.documents().find((d) => d.id === doc.id);
      if (updated) this.selectedDocument.set(updated);
    } catch { /* fallback to local */ }
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

  categoryColor(key: string): string {
    switch (key) {
      case 'safe': return 'success';
      case 'review': return 'warning';
      case 'blocked': return 'danger';
      default: return 'medium';
    }
  }
}
