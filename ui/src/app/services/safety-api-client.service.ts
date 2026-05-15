/**
 * NEW FILE — safety-api-client.service.ts
 * Angular service wrapping the /api/safety/* REST endpoints.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

import { ConfigService } from './config.service';
import {
  AgentGuardResult,
  ContextDriftResult,
  PolicyCheckResult,
  PromptInjectionResult,
  SafetyStatusResponse,
  TaskAdherenceResult,
  ToolValidationResult,
} from '../models/safety.models';

@Injectable({ providedIn: 'root' })
export class SafetyApiClientService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);
  private readonly TIMEOUT_MS = 30_000;

  private get base(): string {
    const url = this.config.settings.apiBaseUrl;
    if (!url) {
      throw new Error('apiBaseUrl is not configured.');
    }
    return url.replace(/\/$/, '');
  }

  async getStatus(): Promise<SafetyStatusResponse> {
    return firstValueFrom(
      this.http.get<SafetyStatusResponse>(`${this.base}/api/safety/status`)
        .pipe(timeout(this.TIMEOUT_MS))
    );
  }

  async checkPromptInjection(text: string): Promise<PromptInjectionResult> {
    return firstValueFrom(
      this.http.post<PromptInjectionResult>(`${this.base}/api/safety/prompt-injection`, { text })
        .pipe(timeout(this.TIMEOUT_MS))
    );
  }

  async checkPolicy(text: string): Promise<PolicyCheckResult> {
    return firstValueFrom(
      this.http.post<PolicyCheckResult>(`${this.base}/api/safety/policy-check`, { text })
        .pipe(timeout(this.TIMEOUT_MS))
    );
  }

  async validateTool(toolName: string, params: Record<string, unknown>): Promise<ToolValidationResult> {
    return firstValueFrom(
      this.http.post<ToolValidationResult>(`${this.base}/api/safety/tool-validate`, {
        tool_name: toolName,
        params,
      }).pipe(timeout(this.TIMEOUT_MS))
    );
  }

  async checkTaskAdherence(userInput: string, agentResponse: string): Promise<TaskAdherenceResult> {
    return firstValueFrom(
      this.http.post<TaskAdherenceResult>(`${this.base}/api/safety/task-adherence`, {
        user_input: userInput,
        agent_response: agentResponse,
      }).pipe(timeout(this.TIMEOUT_MS))
    );
  }

  async checkContextDrift(
    originalTask: string,
    currentText: string,
    conversationHistory: string[] = []
  ): Promise<ContextDriftResult> {
    return firstValueFrom(
      this.http.post<ContextDriftResult>(`${this.base}/api/safety/context-drift`, {
        original_task: originalTask,
        current_text: currentText,
        conversation_history: conversationHistory,
      }).pipe(timeout(this.TIMEOUT_MS))
    );
  }

  async runAgentGuard(
    userInput: string,
    toolCalls: { name: string; params: Record<string, unknown> }[] = [],
    originalTask?: string
  ): Promise<AgentGuardResult> {
    return firstValueFrom(
      this.http.post<AgentGuardResult>(`${this.base}/api/safety/agent-guard`, {
        user_input: userInput,
        tool_calls: toolCalls,
        original_task: originalTask,
      }).pipe(timeout(this.TIMEOUT_MS))
    );
  }
}
