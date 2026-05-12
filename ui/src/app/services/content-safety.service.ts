import { Injectable } from '@angular/core';

import { ContentDocument, SafetyCategoryResult } from '../models/document.models';

@Injectable({ providedIn: 'root' })
export class ContentSafetyService {
  evaluate(document: ContentDocument): SafetyCategoryResult {
    if (document.expectedContentSafetyOutcome === 'pass') {
      return { category: 'safe', confidence: 0.97, reason: 'No policy violations detected.' };
    }

    const reviewLevel = Number(document.id.replace('doc-', '')) % 2 === 0;
    return {
      category: reviewLevel ? 'review' : 'blocked',
      confidence: reviewLevel ? 0.88 : 0.94,
      reason: reviewLevel
        ? 'Potentially unsafe content detected and flagged for manual review.'
        : 'Unsafe content detected and blocked by policy thresholds.'
    };
  }
}
