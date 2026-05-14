import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from './config.service';
import { ApiResultRecord, ApiResultsResponse, PipelineStatusResponse } from '../models/document.models';

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

  async runPipeline(): Promise<{ status: string; message?: string }> {
    return firstValueFrom(this.http.post<{ status: string; message?: string }>(`${this.base}/api/pipeline/run`, {}));
  }

  async getPipelineStatus(): Promise<PipelineStatusResponse> {
    return firstValueFrom(this.http.get<PipelineStatusResponse>(`${this.base}/api/pipeline/status`));
  }
}
