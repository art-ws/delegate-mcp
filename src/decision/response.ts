import type { PreparedDecision } from "./request.js";
import {
  validateDecisionsResponse,
  type DecisionAnswer, type DecisionsResponse, type JsonValue,
} from "./schemas.js";

export interface ValidatedDecisionResponse {
  result: DecisionsResponse;
  /** Response warnings only; combine with S3 warnings when constructing meta. */
  warnings: string[];
}

export type ValidateResponseResult =
  | { success: true; data: ValidatedDecisionResponse }
  | { success: false; error: { code: "UPSTREAM_PROTOCOL"; message: string } };

/** S4. Validate the entire decoded response before returning any answer. No IO. */
export function validateResponse(
  body: unknown, preparedRequest: Pick<PreparedDecision, "body">,
): ValidateResponseResult {
  const checked = validateDecisionsResponse(body);
  if (!checked.success) return protocol();
  const upstream = checked.data;
  const questions = preparedRequest.body.questions;
  if (!sameKeys(upstream.answers, Object.keys(questions)) ||
      upstream.usage.input_tokens < 0 || upstream.usage.output_tokens < 0 ||
      upstream.usage.cost !== undefined && upstream.usage.cost < 0) return protocol();

  const entries: [string, DecisionAnswer][] = [];
  let missingMetrics = false;
  for (const [id, question] of Object.entries(questions)) {
    const answer = upstream.answers[id];
    if (answer.type !== question.type) return protocol();
    if (answer.type === "noul") {
      if (!unit(answer.noul)) return protocol();
      entries.push([id, { type: "noul", noul: answer.noul }]);
      continue;
    }
    if (answer.confidence !== undefined && !unit(answer.confidence)) return protocol();
    if (answer.confidence === undefined || answer.probabilities === undefined) missingMetrics = true;

    let clean: DecisionAnswer;
    if (answer.type === "choice" && question.type === "choice") {
      if (!Object.hasOwn(question.criteria, answer.choice)) return protocol();
      if (answer.probabilities !== undefined && (
        !distribution(answer.probabilities, Object.keys(question.criteria)) ||
        Object.values(answer.probabilities).some((p) => p > answer.probabilities![answer.choice])
      )) return protocol();
      clean = { type: "choice", choice: answer.choice };
    } else if (answer.type === "score" && question.type === "score") {
      const max = question.criteria.length - 1;
      const indices = question.criteria.map((_, i) => String(i));
      if (answer.score < 0 || answer.score > max) return protocol();
      if (answer.probabilities !== undefined) {
        if (!distribution(answer.probabilities, indices)) return protocol();
        const expectation = indices.reduce((sum, key) => sum + Number(key) * answer.probabilities![key], 0);
        if (!within(answer.score, expectation, 0.02 * max + 0.02)) return protocol();
      }
      if (answer.legend !== undefined && (
        !sameKeys(answer.legend, indices) ||
        indices.some((key) => !jsonEqual(answer.legend![key], question.criteria[Number(key)]))
      )) return protocol();
      clean = { type: "score", score: answer.score };
      if (answer.legend !== undefined) clean.legend = answer.legend;
    } else return protocol();
    if (answer.confidence !== undefined) clean.confidence = answer.confidence;
    if (answer.probabilities !== undefined) clean.probabilities = answer.probabilities;
    entries.push([id, clean]);
  }

  const result: DecisionsResponse = {
    model: upstream.model,
    answers: Object.fromEntries(entries),
    usage: { input_tokens: upstream.usage.input_tokens, output_tokens: upstream.usage.output_tokens },
  };
  if (upstream.usage.cost !== undefined) result.usage.cost = upstream.usage.cost;
  if (upstream.id !== undefined) result.id = upstream.id;
  if (upstream.provider !== undefined) result.provider = upstream.provider;
  // Detach all maps/structured legends from the original mutable upstream object.
  return { success: true, data: {
    result: JSON.parse(JSON.stringify(result)) as DecisionsResponse,
    warnings: missingMetrics ? ["missing_optional_metrics"] : [],
  } };
}

function protocol(): ValidateResponseResult {
  return { success: false, error: { code: "UPSTREAM_PROTOCOL", message: "Invalid decision response." } };
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function sameKeys(value: object, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function distribution(value: Record<string, number>, expected: string[]): boolean {
  return sameKeys(value, expected) && Object.values(value).every(unit) &&
    within(Object.values(value).reduce((sum, p) => sum + p, 0), 1, 0.02);
}

function within(value: number, expected: number, tolerance: number): boolean {
  // Only absorb binary floating-point arithmetic error at an inclusive endpoint.
  return Math.abs(value - expected) <= tolerance + Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(expected)) * 4;
}

/** JSON structural equality: object key order and plain/null prototypes are immaterial. */
function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  return sameKeys(a, Object.keys(b)) && Object.keys(a).every((key) => jsonEqual(a[key], b[key]));
}
