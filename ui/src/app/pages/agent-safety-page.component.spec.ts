import { TestBed } from '@angular/core/testing';

import { AgentSafetyPageComponent } from './agent-safety-page.component';
import { SafetyApiClientService } from '../services/safety-api-client.service';

describe('AgentSafetyPageComponent', () => {
  const safetyApiMock = {
    getStatus: jasmine.createSpy('getStatus').and.resolveTo({
      enabled: false,
      task_adherence_threshold: 0.3,
      context_drift_threshold: 0.5,
      policy: {
        blocked_keywords_count: 0,
        restricted_tools: [],
        max_severity: 0,
        enforcement_mode: 'warn',
      },
      allowed_tools: {},
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentSafetyPageComponent],
      providers: [{ provide: SafetyApiClientService, useValue: safetyApiMock }],
    }).compileComponents();
  });

  it('applies a tool sample to both tool inputs', () => {
    const fixture = TestBed.createComponent(AgentSafetyPageComponent);
    const component = fixture.componentInstance;
    const preset = component.toolPresets[1];

    component.applyToolPreset(preset);

    expect(component.toolName).toBe(preset.toolName);
    expect(component.toolParamsJson).toBe(preset.toolParamsJson);
  });

  it('applies an adherence sample to both textareas', () => {
    const fixture = TestBed.createComponent(AgentSafetyPageComponent);
    const component = fixture.componentInstance;
    const preset = component.adherencePresets[1];

    component.applyAdherencePreset(preset);

    expect(component.adherenceUserInput).toBe(preset.userInput);
    expect(component.adherenceAgentResponse).toBe(preset.agentResponse);
  });

  it('applies a drift sample to every drift field', () => {
    const fixture = TestBed.createComponent(AgentSafetyPageComponent);
    const component = fixture.componentInstance;
    const preset = component.driftPresets[1];

    component.applyDriftPreset(preset);

    expect(component.driftOriginalTask).toBe(preset.originalTask);
    expect(component.driftCurrentText).toBe(preset.currentText);
    expect(component.driftHistory).toBe(preset.history);
  });

  it('applies a guard sample to every guard field', () => {
    const fixture = TestBed.createComponent(AgentSafetyPageComponent);
    const component = fixture.componentInstance;
    const preset = component.guardPresets[1];

    component.applyGuardPreset(preset);

    expect(component.guardInput).toBe(preset.userInput);
    expect(component.guardOriginalTask).toBe(preset.originalTask);
    expect(component.guardToolCallsJson).toBe(preset.toolCallsJson);
  });
});
