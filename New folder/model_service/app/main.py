from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

try:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
except Exception:  # pragma: no cover - scaffold fallback
    torch = None
    PeftModel = None
    AutoModelForCausalLM = None
    AutoTokenizer = None
    BitsAndBytesConfig = None


SYSTEM_PROMPT = """You are a data monitoring, QA, and remediation assistant.
Return only valid JSON matching the required response schema.
Be evidence-driven. If the context is incomplete, lower confidence and say so.
Never claim tool outputs that are not present in the provided context."""


class AnalysisRequest(BaseModel):
    incident: dict[str, Any]
    question: str | None = None
    context: dict[str, Any]


class ModelRuntime:
    def __init__(self, base_model: str, adapter_path: str):
        self.base_model = base_model
        self.adapter_path = adapter_path
        self.enabled = bool(AutoTokenizer and AutoModelForCausalLM and PeftModel)
        self.quantization_mode = os.getenv("QWEN_QUANTIZATION", "auto").lower()
        self.max_new_tokens = int(os.getenv("QWEN_MAX_NEW_TOKENS", "192"))
        self.active_load_strategy = "uninitialized"
        self.tokenizer = None
        self.model = None
        if self.enabled:
            self._load()

    def _base_model_kwargs(self) -> dict[str, Any]:
        return {
            "trust_remote_code": True,
            "device_map": "auto",
            "low_cpu_mem_usage": True,
        }

    def _strategy_model_kwargs(self, strategy: str) -> dict[str, Any]:
        model_kwargs = self._base_model_kwargs()

        if strategy == "4bit" and BitsAndBytesConfig and torch:
            compute_dtype = torch.float16
            if torch.cuda.is_available() and torch.cuda.is_bf16_supported():
                compute_dtype = torch.bfloat16
            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=compute_dtype,
            )
            return model_kwargs

        if strategy == "8bit-offload" and BitsAndBytesConfig:
            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_8bit=True,
                llm_int8_enable_fp32_cpu_offload=True,
            )
            return model_kwargs

        model_kwargs["torch_dtype"] = (
            torch.float16 if torch and torch.cuda.is_available() else "auto"
        )
        return model_kwargs

    def _load_strategies(self) -> list[str]:
        if self.quantization_mode == "4bit":
            return ["4bit", "8bit-offload", "none"]
        if self.quantization_mode == "8bit":
            return ["8bit-offload", "none"]
        if self.quantization_mode == "none":
            return ["none"]
        return ["4bit", "8bit-offload", "none"]

    def _load(self) -> None:
        self.tokenizer = AutoTokenizer.from_pretrained(self.base_model, trust_remote_code=True)
        errors: list[str] = []

        for strategy in self._load_strategies():
            try:
                base = AutoModelForCausalLM.from_pretrained(
                    self.base_model,
                    **self._strategy_model_kwargs(strategy),
                )
                # The adapter directory is not treated as a standalone checkpoint.
                # We explicitly attach it to the base model at runtime.
                self.model = PeftModel.from_pretrained(base, self.adapter_path)
                self.active_load_strategy = strategy
                return
            except Exception as error:
                errors.append(f"{strategy}: {error}")

        raise RuntimeError(" | ".join(errors))

    def generate(self, payload: AnalysisRequest) -> dict[str, Any]:
        if not self.enabled or self.model is None or self.tokenizer is None:
            return self._fallback(payload)

        prompt = json.dumps(
            {
                "system": SYSTEM_PROMPT,
                "incident": payload.incident,
                "question": payload.question,
                "context": payload.context,
            },
            indent=2,
        )
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        outputs = self.model.generate(
            **inputs,
            max_new_tokens=self.max_new_tokens,
            do_sample=False,
        )
        decoded = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        return self._safe_json(decoded) or self._fallback(payload)

    def _safe_json(self, decoded: str) -> dict[str, Any] | None:
        start = decoded.find("{")
        end = decoded.rfind("}")
        if start == -1 or end == -1:
            return None
        try:
            return json.loads(decoded[start : end + 1])
        except json.JSONDecodeError:
            return None

    def _fallback(self, payload: AnalysisRequest) -> dict[str, Any]:
        metrics = payload.context.get("metrics", [])
        logs = payload.context.get("logs", [])
        schema_checks = payload.context.get("schema_checks", [])
        evidence = [
            *(f"{entry['source']}: {entry['message']}" for entry in logs[:2]),
            *(f"{check['name']}: {check['detail']}" for check in schema_checks[:2]),
        ]
        stale = next((metric for metric in metrics if metric.get("freshness_minutes", 0) > 60), None)
        confidence = "high" if stale or schema_checks else "medium"
        return {
            "summary": f"{payload.incident['title']} appears to be driven by an upstream quality or transform issue.",
            "likely_root_cause": "A failing transform or validation step is blocking healthy downstream refreshes.",
            "supporting_evidence": evidence or ["Context was limited, so this is a low-detail fallback response."],
            "suggested_fix": [
                "Review the failing logs and patch the transform or validation rule that started failing.",
                "Run readonly diagnostics before retrying the job.",
            ],
            "debug_steps": [
                "Inspect the latest error log lines for the incident job.",
                "Compare freshness and row-count metrics for the affected dataset.",
                "Validate schema checks before retrying the pipeline.",
            ],
            "confidence": confidence,
            "recommended_actions": [
                {"action": "run_validation", "label": "Run validation suite", "safe": True},
                {"action": "notify_owner", "label": "Notify owner", "safe": True},
            ],
        }


@lru_cache(maxsize=1)
def get_runtime() -> ModelRuntime:
    base_model = os.getenv("QWEN_BASE_MODEL", "Qwen/Qwen2.5-7B-Instruct")
    adapter_path = os.getenv("QWEN_LORA_ADAPTER_PATH", "./sft_model")
    return ModelRuntime(base_model=base_model, adapter_path=adapter_path)


app = FastAPI(title="Pipeline Ops Model Service", version="0.1.0")


@app.get("/health")
def health():
    return {
        "ok": True,
        "base_model": os.getenv("QWEN_BASE_MODEL", "Qwen/Qwen2.5-7B-Instruct"),
        "adapter_path": os.getenv("QWEN_LORA_ADAPTER_PATH", "./sft_model"),
        "runtime_mode": "transformers+peft" if AutoTokenizer and AutoModelForCausalLM and PeftModel else "fallback",
        "quantization_mode": os.getenv("QWEN_QUANTIZATION", "auto").lower(),
        "max_new_tokens": int(os.getenv("QWEN_MAX_NEW_TOKENS", "192")),
    }


@app.post("/analyze")
def analyze(request: AnalysisRequest):
    return get_runtime().generate(request)
