import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ContentSafetyService } from './content-safety.service';
import { ConfigService } from './config.service';

describe('ContentSafetyService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { settings: { apiBaseUrl: 'http://localhost' } } }
      ]
    });
  });

  it('can be created', () => {
    const service = TestBed.inject(ContentSafetyService);
    expect(service).toBeTruthy();
  });
});

