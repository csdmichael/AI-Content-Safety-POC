import { ContentSafetyService } from './content-safety.service';

describe('ContentSafetyService', () => {
  let service: ContentSafetyService;

  beforeEach(() => {
    service = new ContentSafetyService();
  });

  it('returns safe category for pass documents', () => {
    const result = service.evaluate({
      id: 'doc-051',
      fileName: 'doc_051.pdf',
      format: 'pdf',
      relativePath: 'data/pdf/doc_051.pdf',
      expectedContentSafetyOutcome: 'pass',
      seedText: 'safe content'
    });

    expect(result.category).toBe('safe');
  });

  it('returns review or blocked for fail documents', () => {
    const review = service.evaluate({
      id: 'doc-002',
      fileName: 'doc_002.pdf',
      format: 'pdf',
      relativePath: 'data/pdf/doc_002.pdf',
      expectedContentSafetyOutcome: 'fail',
      seedText: 'unsafe content'
    });

    const blocked = service.evaluate({
      id: 'doc-003',
      fileName: 'doc_003.pdf',
      format: 'pdf',
      relativePath: 'data/pdf/doc_003.pdf',
      expectedContentSafetyOutcome: 'fail',
      seedText: 'unsafe content'
    });

    expect(review.category).toBe('review');
    expect(blocked.category).toBe('blocked');
  });
});
