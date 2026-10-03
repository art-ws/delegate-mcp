import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DecisionSetup } from "./config.js";
import { createDecisionClient, type DecisionTransportDependencies } from "./client.js";
import { prepareDecision } from "./request.js";
import { validateResponse } from "./response.js";
import { assess } from "./assessment.js";
import { withDecisionSchemas } from "./registration.js";
import { recordDecision, type DecisionMetricInput, type DecisionMetricsDependencies } from "./metrics.js";
import { validateDecisionArgs, validateDecisionEnvelope, type DecisionEnvelope, type DecisionError, type DecisionMeta } from "./schemas.js";

/** Internal injection only; never accepted through config or tool arguments. */
export interface DecisionToolContext {
  setup?: DecisionSetup;
  transport?: DecisionTransportDependencies;
  /** Monotonic milliseconds, independent of the legacy wall clock. */
  now?: () => number;
  requestId?: () => string;
  metrics?: DecisionMetricsDependencies;
}

export type DecisionHandler = (args: unknown, signal?: AbortSignal) => Promise<CallToolResult>;

/** S7: one persistent S5 client/scheduler for this registration's ready config. */
export function createDecisionHandler(context: DecisionToolContext): DecisionHandler {
  const setup = context.setup ?? { status: "not-configured" };
  const config = setup.status === "ready" ? setup.config : undefined;
  const client = config === undefined ? undefined : createDecisionClient(config, context.transport);
  const now = context.now ?? (() => performance.now());
  const clock = () => {
    try { const value = now(); if (Number.isFinite(value)) return value; } catch { /* fixed local fallback */ }
    return performance.now();
  };
  const requestId = () => {
    try { const value = (context.requestId ?? randomUUID)(); if (typeof value === "string") return value; } catch { /* fixed local fallback */ }
    return randomUUID();
  };

  return async (args, signal) => {
    const start = clock();
    const meta: DecisionMeta = {
      request_id: requestId(),
      requested_model: config?.default_model ?? "~typesafe/jev-latest",
      elapsed_ms: 0, attempts: 0, api_version: "alpha-decisions", warnings: [],
    };
    const errorEnvelope = (error: DecisionError): DecisionEnvelope => ({ kind: "error", error, meta });
    let envelope: DecisionEnvelope;
    try {
      if (config === undefined || client === undefined) {
        envelope = errorEnvelope({
          code: "CONFIG_ERROR", message: "Add an enabled decision block with api_key: env:OPENROUTER_API_KEY to the existing delegate-mcp configuration.",
          retryable: false, billing_uncertain: false,
        });
      } else {
        // On a preparation failure, report only a validated, administrator-allowed
        // requested model; arbitrary malformed argument values stay out of meta.
        const form = validateDecisionArgs(args);
        if (form.success && form.data.model !== undefined && config.allowed_models.includes(form.data.model)) {
          meta.requested_model = form.data.model;
        }
        const prepared = prepareDecision(args, config);
        if (!prepared.success) {
          envelope = errorEnvelope({ ...prepared.error, retryable: false, billing_uncertain: false });
        } else {
          const request = prepared.data;
          meta.requested_model = request.body.model;
          meta.warnings = [...request.warnings];
          if (request.effectiveExecution.dry_run) {
            envelope = { kind: "dry_run", request: request.body, meta };
          } else {
            const transported = await client.request(request, request.effectiveExecution, signal);
            meta.attempts = transported.attempts;
            if (!transported.success) envelope = errorEnvelope(transported.error);
            else {
              const validated = validateResponse(transported.body, request);
              if (!validated.success) envelope = errorEnvelope({
                ...validated.error, retryable: false, billing_uncertain: true,
              });
              else {
                meta.warnings = [...new Set([...meta.warnings, ...validated.data.warnings])];
                envelope = {
                  kind: "decision", result: validated.data.result,
                  assessments: assess(validated.data.result, request.localPolicy), meta,
                };
              }
            }
          }
        }
      }
    } catch {
      // Never reflect thrown values, abort reasons, config, or validator issues.
      envelope = errorEnvelope({
        code: meta.attempts > 0 ? "UPSTREAM_PROTOCOL" : "INVALID_ARGUMENT",
        message: "Decision request could not be processed.", retryable: false,
        billing_uncertain: meta.attempts > 0,
      });
    }
    meta.elapsed_ms = Math.max(0, Math.floor(clock() - start));
    if (!validateDecisionEnvelope(envelope).success) {
      envelope = errorEnvelope({ code: "UPSTREAM_PROTOCOL", message: "Invalid decision result.", retryable: false, billing_uncertain: meta.attempts > 0 });
    }

    // S6 receives only explicit primitives, never the envelope/config/raw result.
    const fields = {
      request_id: meta.request_id, requested_model: meta.requested_model,
      elapsed_ms: meta.elapsed_ms, attempts: meta.attempts,
    };
    let metric: DecisionMetricInput;
    if (envelope.kind === "decision") {
      const usage = envelope.result.usage;
      metric = {
        ...fields, kind: "decision", actual_model: envelope.result.model,
        usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
          ...(usage.cost === undefined ? {} : { cost: usage.cost }) },
      };
    } else if (envelope.kind === "error") metric = { ...fields, kind: "error", error_code: envelope.error.code };
    else metric = { ...fields, kind: "dry_run" };
    await recordDecision(metric, config?.metrics_file, context.metrics);
    return {
      structuredContent: { ...envelope },
      content: [{ type: "text", text: JSON.stringify(envelope) }],
      isError: envelope.kind === "error",
    };
  };
}

/** Register first on the existing server; S3 validates, the bridge publishes S1. */
export function registerDecisionTool(server: McpServer, context: DecisionToolContext): void {
  if (context.setup?.status === "disabled") return;
  const handle = createDecisionHandler(context);
  withDecisionSchemas(server, () => {
    const tool = server.registerTool("decision", {
      description: "Sends the supplied context to an external API and returns Choice/Noul/Score decisions. Does not execute the selected action or generate explanations.",
      inputSchema: z.unknown(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, (args, extra) => handle(args, extra.signal));
    // Installed SDK exposes execution on RegisteredTool, not registerTool config.
    tool.execution = { taskSupport: "forbidden" };
  });
}
