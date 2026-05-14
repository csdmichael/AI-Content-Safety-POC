import { Injectable, inject } from '@angular/core';

import { ApiResultRecord, SafetyCategoryResult } from '../models/document.models';
import { ApiClientService } from './api-client.service';

@Injectable({ providedIn: 'root' })
export class ContentSafetyService {
  private readonly api = inject(ApiClientService);

  async fetchAllResults(): Promise<Map<string, SafetyCategoryResult>> {
    const records = await this.api.listResults();
    const map = new Map<string, SafetyCategoryResult>();
    for (const record of records) {
      map.set(record.id, this.toCategoryResult(record));
    }
    return map;
  }

  async fetchResult(id: string): Promise<SafetyCategoryResult | null> {
    try {
      const record = await this.api.getResult(id);
      return this.toCategoryResult(record);
    } catch {
      return null;
    }
  }

  private toCategoryResult(record: ApiResultRecord): SafetyCategoryResult {
    const textSeverity = record.textMaxSeverity ?? 0;
    const imageSeverity = record.imageMaxSeverity ?? 0;
    const maxSeverity = Math.max(textSeverity, imageSeverity);

    const blocked =
      record.textAnalysisDecision === 'blocked' || record.imageAnalysisDecision === 'blocked';
    const reviewable = !blocked && maxSeverity >= 2;

    const category: SafetyCategoryResult['category'] = blocked
      ? 'blocked'
      : reviewable
        ? 'review'
        : 'safe';

    const confidence = Math.min(0.5 + maxSeverity / 14, 0.99);

    const flagged = [
      ...(record.textAnalysis?.categoriesAnalysis ?? []),
      ...(record.imageAnalysis?.categoriesAnalysis ?? [])
    ].filter((c) => (c.severity ?? 0) > 0);
    const detail = flagged.length
      ? flagged.map((c) => `${c.category}=${c.severity}`).join(', ')
      : 'No category exceeded severity threshold.';

    const allCategories = [
      ...(record.textAnalysis?.categoriesAnalysis ?? []),
      ...(record.imageAnalysis?.categoriesAnalysis ?? [])
    ];

    return {
      category,
      confidence,
      reason: `Max severity ${maxSeverity}. ${detail}`,
      categories: allCategories.map((c) => ({ category: c.category, severity: c.severity ?? 0 }))
    };
  }
}

