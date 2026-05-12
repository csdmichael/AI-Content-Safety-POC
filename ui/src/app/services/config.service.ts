import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { AppConfig } from '../models/document.models';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private config?: AppConfig;

  async load(): Promise<void> {
    this.config = await firstValueFrom(this.http.get<AppConfig>('/assets/config/app-config.json'));
  }

  get settings(): AppConfig {
    if (!this.config) {
      throw new Error('Config not loaded.');
    }
    return this.config;
  }
}
