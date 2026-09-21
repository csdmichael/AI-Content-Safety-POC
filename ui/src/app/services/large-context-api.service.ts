/**
 * Angular service wrapping the /api/large-context/* REST endpoints.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

import { ConfigService } from './config.service';

export interface ChunkResult {
  index: number;
  text_preview: string;
  start_char: number;
  end_char: number;
  severity: number;
  decision: 'safe' | 'blocked';
  flagged_categories: string[];
  blocklist_matches: string[];
  prompt_shield_applied: boolean;
  prompt_attack_detected: boolean;
  scan_duration_ms: number;
}

export interface ExecutionTraceStep {
  timestamp_utc: string;
  elapsed_ms: number;
  stage: string;
  message: string;
  outcome: 'info' | 'safe' | 'blocked';
}

export interface TextLargeContextResponse {
  original_length: number;
  chunk_size: number;
  overlap: number;
  num_chunks: number;
  chunks: ChunkResult[];
  aggregated_decision: 'safe' | 'blocked';
  max_severity: number;
  flagged_categories: string[];
  content_source: 'user_prompt' | 'retrieved_document' | 'model_completion';
  prompt_shield_enabled: boolean;
  prompt_attack_detected: boolean;
  parallelism: number;
  moderation_duration_ms: number;
  processed_at_utc: string;
  trace: ExecutionTraceStep[];
}

export interface ImageCompressionMetrics {
  original_size_bytes: number;
  original_dimensions: string;
  original_format: string;
  compressed_size_bytes: number;
  compressed_dimensions: string;
  compressed_format: string;
  resized: boolean;
  final_quality: number;
  reduction_percentage: number;
}

export interface ImageLargeContextResponse {
  metrics: ImageCompressionMetrics;
  max_severity: number;
  decision: 'safe' | 'blocked';
  flagged_categories: string[];
  ocr_enabled: boolean;
  ocr_character_limit: number;
  moderation_duration_ms: number;
  processed_at_utc: string;
}

export interface APIMRecommendation {
  concern: string;
  mitigation: string;
  policy_name: string;
  policy_key: string;
}

export interface APIMConfigResponse {
  recommendations: APIMRecommendation[];
  xml_policies: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class LargeContextApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);
  private readonly REQUEST_TIMEOUT_MS = 60_000; // 60 seconds since image compression/safety can take a while

  private get base(): string {
    const url = this.config.settings.apiBaseUrl;
    if (!url) {
      throw new Error('apiBaseUrl is not configured.');
    }
    return url.replace(/\/$/, '');
  }

  async analyzeText(
    text: string,
    chunkSize: number,
    overlap: number,
    contentSource: 'user_prompt' | 'retrieved_document' | 'model_completion',
    promptShield: boolean,
    userPrompt?: string,
  ): Promise<TextLargeContextResponse> {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('chunk_size', chunkSize.toString());
    formData.append('overlap', overlap.toString());
    formData.append('content_source', contentSource);
    formData.append('prompt_shield', promptShield.toString());
    if (userPrompt) formData.append('user_prompt', userPrompt);

    return firstValueFrom(
      this.http.post<TextLargeContextResponse>(`${this.base}/api/large-context/analyze-text`, formData)
        .pipe(timeout(this.REQUEST_TIMEOUT_MS))
    );
  }

  async compressImage(file: File, maxDimension: number, compressionQuality: number): Promise<ImageLargeContextResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('max_dimension', maxDimension.toString());
    formData.append('compression_quality', compressionQuality.toString());

    return firstValueFrom(
      this.http.post<ImageLargeContextResponse>(`${this.base}/api/large-context/compress-image`, formData)
        .pipe(timeout(this.REQUEST_TIMEOUT_MS))
    );
  }

  async downloadCompressedImage(file: File, maxDimension: number, compressionQuality: number): Promise<Blob> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('max_dimension', maxDimension.toString());
    formData.append('compression_quality', compressionQuality.toString());

    return firstValueFrom(
      this.http.post(`${this.base}/api/large-context/compress-image/download`, formData, {
        responseType: 'blob',
      }).pipe(timeout(this.REQUEST_TIMEOUT_MS))
    );
  }

  async getApimConfig(): Promise<APIMConfigResponse> {
    return firstValueFrom(
      this.http.get<APIMConfigResponse>(`${this.base}/api/large-context/apim-config`)
        .pipe(timeout(this.REQUEST_TIMEOUT_MS))
    );
  }
}
