"""
NEW FILE — api/safety_routes.py
FastAPI router providing REST endpoints for the Agent Safety module.

⚠️  OPTIONAL INTEGRATION POINT
    Mount this router in the main server.py with:
        from safety_routes import safety_router
        app.include_router(safety_router)

All endpoints are read-only / stateless evaluation endpoints.
They do NOT modify existing API contracts or data.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class PromptInjectionRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)

class PolicyCheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)

class ToolValidationRequest(BaseModel):
    tool_name: str
    params: dict = Field(default_factory=dict)

class TaskAdherenceRequest(BaseModel):
    user_input: str = Field(..., min_length=1, max_length=10000)
    agent_response: str = Field(..., min_length=1, max_length=10000)

class ContextDriftRequest(BaseModel):
    original_task: str = Field(..., min_length=1, max_length=10000)
    current_text: str = Field(..., min_length=1, max_length=10000)
    conversation_history: list[str] = Field(default_factory=list)

class AgentGuardRequest(BaseModel):
    user_input: str = Field(..., min_length=1, max_length=10000)
    tool_calls: list[dict] = Field(default_factory=list)
    original_task: str | None = None

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

safety_router = APIRouter(prefix="/api/safety", tags=["Agent Safety"])


@safety_router.get("/status", summary="Agent safety module status")
def safety_status():
    """Return whether the agent safety module is enabled and its config."""
    from safety.config import (
        ENABLE_AGENT_SAFETY,
        TASK_ADHERENCE_THRESHOLD,
        CONTEXT_DRIFT_THRESHOLD,
    )
    from safety.policy_engine import PolicyEngine
    from safety.tool_validator import ToolValidator

    policy = PolicyEngine()
    tools = ToolValidator()

    return {
        "enabled": ENABLE_AGENT_SAFETY,
        "task_adherence_threshold": TASK_ADHERENCE_THRESHOLD,
        "context_drift_threshold": CONTEXT_DRIFT_THRESHOLD,
        "policy": policy.policy_summary,
        "allowed_tools": tools.list_allowed_tools(),
    }


@safety_router.post("/prompt-injection", summary="Detect prompt injection")
def check_prompt_injection(req: PromptInjectionRequest):
    """Run prompt injection detection on the provided text."""
    from safety.prompt_injection import detect_prompt_injection
    return detect_prompt_injection(req.text)


@safety_router.post("/policy-check", summary="Check text against policy")
def check_policy(req: PolicyCheckRequest):
    """Evaluate text against the global policy (blocked keywords, etc.)."""
    from safety.policy_engine import PolicyEngine
    engine = PolicyEngine()
    return engine.evaluate_text(req.text)


@safety_router.post("/tool-validate", summary="Validate a tool call")
def validate_tool(req: ToolValidationRequest):
    """Validate a tool call against the tool registry."""
    from safety.tool_validator import ToolValidator
    validator = ToolValidator()
    return validator.validate(req.tool_name, req.params)


@safety_router.post("/task-adherence", summary="Score task adherence")
def check_task_adherence(req: TaskAdherenceRequest):
    """Score how well an agent response adheres to the user's task."""
    from safety.task_adherence import score_task_adherence
    return score_task_adherence(req.user_input, req.agent_response)


@safety_router.post("/context-drift", summary="Detect context drift")
def check_context_drift(req: ContextDriftRequest):
    """Detect if text has drifted from the original task."""
    from safety.context_drift import detect_context_drift
    return detect_context_drift(
        req.original_task,
        req.current_text,
        req.conversation_history if req.conversation_history else None,
    )


@safety_router.post("/agent-guard", summary="Full agent safety evaluation")
def run_agent_guard(req: AgentGuardRequest):
    """Run the full agent safety evaluation pipeline.

    Uses a stub agent callable (echo) since the real agent is not
    accessible from this endpoint. This is for demonstration / testing
    of the safety pipeline itself.
    """
    from safety.agent_safety_wrapper import AgentSafetyWrapper
    from safety.policy_engine import PolicyEngine
    from safety.tool_validator import ToolValidator

    def stub_agent(text: str) -> str:
        return f"[stub agent response] Processed: {text[:200]}"

    wrapper = AgentSafetyWrapper(
        policy_engine=PolicyEngine(),
        tool_validator=ToolValidator(),
        original_task=req.original_task or req.user_input,
    )

    result = wrapper.run(
        user_input=req.user_input,
        agent_callable=stub_agent,
        tool_calls=req.tool_calls if req.tool_calls else None,
    )

    return result
