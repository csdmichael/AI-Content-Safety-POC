import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ConfigService } from './config.service';
import { LargeContextApiService, TextLargeContextResponse } from './large-context-api.service';

describe('LargeContextApiService', () => {
  let http: HttpTestingController;
  let service: LargeContextApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { settings: { apiBaseUrl: 'http://localhost' } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(LargeContextApiService);
  });

  afterEach(() => http.verify());

  it('sends content source and Prompt Shields fields', async () => {
    const response: TextLargeContextResponse = {
      original_length: 12,
      chunk_size: 8_000,
      overlap: 1_000,
      num_chunks: 1,
      chunks: [],
      aggregated_decision: 'safe',
      max_severity: 0,
      flagged_categories: [],
      content_source: 'retrieved_document',
      prompt_shield_enabled: true,
      prompt_attack_detected: false,
      parallelism: 1,
      moderation_duration_ms: 12,
      processed_at_utc: '2026-09-20T00:00:00Z',
      trace: [],
    };

    const resultPromise = service.analyzeText(
      'document text',
      8_000,
      1_000,
      'retrieved_document',
      true,
      'Summarize this document.',
    );
    const request = http.expectOne('http://localhost/api/large-context/analyze-text');
    const body = request.request.body as FormData;

    expect(request.request.method).toBe('POST');
    expect(body.get('content_source')).toBe('retrieved_document');
    expect(body.get('prompt_shield')).toBe('true');
    expect(body.get('user_prompt')).toBe('Summarize this document.');
    request.flush(response);

    await expectAsync(resultPromise).toBeResolvedTo(response);
  });

  it('requests the compressed image as a blob', async () => {
    const file = new File(['source'], 'sample.png', { type: 'image/png' });
    const response = new Blob(['jpeg'], { type: 'image/jpeg' });

    const resultPromise = service.downloadCompressedImage(file, 2_048, 80);
    const request = http.expectOne('http://localhost/api/large-context/compress-image/download');
    const body = request.request.body as FormData;

    expect(request.request.method).toBe('POST');
    expect(request.request.responseType).toBe('blob');
    expect(body.get('file')).toBe(file);
    expect(body.get('max_dimension')).toBe('2048');
    expect(body.get('compression_quality')).toBe('80');
    request.flush(response);

    await expectAsync(resultPromise).toBeResolvedTo(response);
  });
});