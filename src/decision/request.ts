import type { DecisionConfig } from "./config.js";
import {
  validateDecisionArgs,
  type DecisionExecution, type DecisionPolicy, type DecisionsRequest,
} from "./schemas.js";

export interface PreparedDecision {
  body: DecisionsRequest;
  /** The exact serialization measured by requestBytes; transport should send this. */
  bodyJson: string;
  requestBytes: number;
  effectiveExecution: Required<DecisionExecution>;
  localPolicy: DecisionPolicy | undefined;
  warnings: string[];
}

export type PrepareDecisionResult =
  | { success: true; data: PreparedDecision }
  | { success: false; error: {
    code: "INVALID_ARGUMENT" | "POLICY_CONFLICT" | "INPUT_TOO_LARGE";
    message: string;
  } };

/** S3. Config must be S2 ready; returned snapshots are immutable to consumers. */
export function prepareDecision(args: unknown, readyConfig: DecisionConfig): PrepareDecisionResult {
  const checked = validateDecisionArgs(args);
  if (!checked.success) return invalid();
  const input = checked.data;
  const model = input.model ?? readyConfig.default_model;
  if (!readyConfig.allowed_models.includes(model)) return invalid();

  for (const [id, rule] of Object.entries(input.policy ?? {})) {
    if (!Object.hasOwn(input.questions, id) || input.questions[id].type !== rule.type ||
        rule.type === "noul" && rule.false_max >= rule.true_min) return invalid();
  }

  // Each top-level preference is replaced in full, including arrays and objects.
  // A null request provider supplies no overrides; nullable defaults remain valid.
  const provider = input.provider == null ? readyConfig.provider_defaults : {
    ...readyConfig.provider_defaults, ...input.provider,
  };
  const required = readyConfig.required_provider;
  const effectiveProvider = Object.keys(required).length === 0 ? provider : { ...provider };
  if (effectiveProvider !== null) {
    for (const key of ["data_collection", "zdr", "allow_fallbacks", "require_parameters"] as const) {
      const constraint = required[key];
      if (constraint === undefined) continue;
      const value = effectiveProvider[key];
      if (value != null && value !== constraint) return conflict();
      // Assignment through a computed union key would intersect the field types.
      Object.defineProperty(effectiveProvider, key, {
        value: constraint, enumerable: true, configurable: true, writable: true,
      });
    }
    if (required.only !== undefined) {
      const only = effectiveProvider.only;
      if (only != null && (only.length === 0 || !only.every((slug) => required.only!.includes(slug)))) {
        return conflict();
      }
      effectiveProvider.only = only ?? required.only;
    }
  }

  const body: DecisionsRequest = {
    model, state: input.state, questions: input.questions, provider: effectiveProvider,
  };
  if (input.session_id !== undefined) body.session_id = input.session_id;
  if (input.trace !== undefined) body.trace = input.trace;
  if (input.user !== undefined) body.user = input.user;
  const bodyJson = JSON.stringify(body);
  const requestBytes = Buffer.byteLength(bodyJson, "utf8");
  if (requestBytes > readyConfig.max_request_bytes) {
    return { success: false, error: { code: "INPUT_TOO_LARGE", message: "Decision request exceeds the byte limit." } };
  }
  const warnings: string[] = [];
  for (const question of Object.values(input.questions)) {
    if (question.type === "choice" && Object.keys(question.criteria).length === 1 && !warnings.includes("single_option")) {
      warnings.push("single_option");
    }
    if (question.type === "score" && question.criteria.length === 1 && !warnings.includes("degenerate_scale")) {
      warnings.push("degenerate_scale");
    }
  }
  return { success: true, data: {
    body: JSON.parse(bodyJson) as DecisionsRequest,
    bodyJson, requestBytes,
    effectiveExecution: {
      timeout_ms: input.execution?.timeout_ms ?? readyConfig.timeout_ms,
      max_retries: input.execution?.max_retries ?? readyConfig.max_retries,
      dry_run: input.execution?.dry_run ?? false,
    },
    localPolicy: input.policy === undefined ? undefined : JSON.parse(JSON.stringify(input.policy)) as DecisionPolicy,
    warnings,
  } };
}

function invalid(): PrepareDecisionResult {
  return { success: false, error: { code: "INVALID_ARGUMENT", message: "Invalid decision arguments." } };
}

function conflict(): PrepareDecisionResult {
  return { success: false, error: { code: "POLICY_CONFLICT", message: "Decision provider conflicts with required policy." } };
}
