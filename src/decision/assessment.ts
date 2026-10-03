import type { DecisionAssessment, DecisionPolicy, DecisionsResponse } from "./schemas.js";

export type DecisionAssessments = Record<string, DecisionAssessment>;

/** S4. Consume S3 policy and the validated S4 result; never execute actions. */
export function assess(result: DecisionsResponse, localPolicy?: DecisionPolicy): DecisionAssessments {
  return Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => {
    const rule = localPolicy !== undefined && Object.hasOwn(localPolicy, id) ? localPolicy[id] : undefined;
    const original = answer.type === "choice" ? answer.choice : answer.type === "noul" ? answer.noul : answer.score;
    if (rule === undefined) return [id, { status: "unassessed", value: original, reasons: [] }];

    const reasons: string[] = [];
    let value: DecisionAssessment["value"] = original;
    if (rule.type === "choice" && answer.type === "choice") {
      const ranked = answer.probabilities === undefined ? [] : Object.values(answer.probabilities).sort((a, b) => b - a);
      if (ranked.length >= 2 && ranked[0] === ranked[1]) reasons.push("tie");
      const margin = ranked.length >= 2 ? ranked[0] - ranked[1] : undefined;
      const conditions: [number | undefined, number | undefined, string][] = [
        [rule.min_confidence, answer.confidence, "below_confidence"],
        [rule.min_probability, answer.probabilities?.[answer.choice], "below_probability"],
        [rule.min_margin, margin, "below_margin"],
      ];
      for (const [threshold, metric, reason] of conditions) {
        if (threshold === undefined) continue;
        if (metric === undefined) {
          if (!reasons.includes("missing_metric")) reasons.push("missing_metric");
        } else if (metric < threshold && (reason !== "below_margin" ||
                   threshold - metric > Number.EPSILON * Math.max(1, Math.abs(metric), Math.abs(threshold)) * 4)) {
          // Margin is computed from two floats; absorb only subtraction error
          // at an inclusive endpoint. Direct confidence/probability comparisons
          // remain exact and no probability is rounded or normalized.
          reasons.push(reason);
        }
      }
    } else if (rule.type === "noul" && answer.type === "noul") {
      value = answer.noul <= rule.false_max ? false : answer.noul >= rule.true_min ? true : null;
      if (value === null) reasons.push("ambiguous_probability");
    } else if (rule.type === "score" && answer.type === "score") {
      if (answer.confidence === undefined) reasons.push("missing_metric");
      else if (answer.confidence < rule.min_confidence) reasons.push("below_confidence");
    } else {
      // Outside the S3/S4 preconditions: fail closed, never accept a mismatched rule.
      reasons.push("missing_metric");
    }
    return [id, { status: reasons.length === 0 ? "accepted" : "uncertain", value, reasons }];
  }));
}
