import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from './config.service';
import { ApiResultRecord, ApiResultsResponse } from '../models/document.models';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private get base(): string {
    const url = this.config.settings.apiBaseUrl;
    if (!url) {
      throw new Error('apiBaseUrl is not configured.');
    }
    return url.replace(/\/$/, '');
  }

  async listResults(): Promise<ApiResultRecord[]> {
    const response = await firstValueFrom(this.http.get<ApiResultsResponse>(`${this.base}/api/results`));
    return response.results ?? [];
  }

  async getResult(id: string): Promise<ApiResultRecord> {
    return firstValueFrom(this.http.get<ApiResultRecord>(`${this.base}/api/results/${encodeURIComponent(id)}`));
  }

  async getDownloadUrl(fileName: string): Promise<string> {
    const response = await firstValueFrom(
      this.http.get<{ url: string }>(`${this.base}/api/documents/${encodeURIComponent(fileName)}/download-url`)
    );
    return response.url;
  }

  async health(): Promise<unknown> {
    return firstValueFrom(this.http.get(`${this.base}/api/health`));
  }
}
