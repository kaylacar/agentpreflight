import type { Rule } from "../types.js";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

const vagueWords = /\b(quick|soon|fast|a bit|some time|few hours|maybe)\b/i;

const timeEstimateSchema: Rule = {
  name: "time-estimation-schema",
  matches(call) {
    const tool = call.tool.toLowerCase();
    if (tool.includes("estimate") || tool.includes("plan")) return true;
    return "best_case_minutes" in call.params || "p90_minutes" in call.params || "estimate_text" in call.params;
  },
  async validate(call) {
    const scope = asString(call.params.scope);
    const assumptions = asString(call.params.assumptions);
    const best = asNumber(call.params.best_case_minutes);
    const p90 = asNumber(call.params.p90_minutes);
    const confidence = asNumber(call.params.confidence);
    if (!scope || !assumptions || Number.isNaN(best) || Number.isNaN(p90) || Number.isNaN(confidence)) {
      return {
        status: "fail",
        rule: "time-estimation-schema",
        message: "Time estimate missing required fields (scope, assumptions, best_case_minutes, p90_minutes, confidence)",
        suggestion: "Provide full estimate payload with numeric minute ranges",
      };
    }
    if (confidence < 0 || confidence > 1) {
      return {
        status: "fail",
        rule: "time-estimation-schema",
        message: "Confidence must be between 0 and 1",
        suggestion: "Use confidence as a decimal probability (for example 0.65)",
      };
    }
    if (best <= 0 || p90 <= 0 || p90 < best) {
      return {
        status: "fail",
        rule: "time-estimation-schema",
        message: "Invalid estimate range",
        suggestion: "Use positive minutes and ensure p90 >= best_case",
      };
    }
    return { status: "pass", rule: "time-estimation-schema", message: "Estimate schema valid" };
  },
};

const timeEstimateVagueness: Rule = {
  name: "time-estimation-vagueness",
  matches(call) {
    return "estimate_text" in call.params || call.tool.toLowerCase().includes("estimate");
  },
  async validate(call) {
    const text = asString(call.params.estimate_text);
    if (text && vagueWords.test(text)) {
      return {
        status: "warn",
        rule: "time-estimation-vagueness",
        message: "Estimate text is vague",
        suggestion: "Replace vague wording with best_case_minutes and p90_minutes",
      };
    }
    return { status: "pass", rule: "time-estimation-vagueness", message: "Estimate wording is concrete enough" };
  },
};

const timeEstimateCalibrationDrift: Rule = {
  name: "time-estimation-calibration-drift",
  matches(call) {
    return "recent_p90_miss_rate" in call.params || "recent_avg_error_pct" in call.params;
  },
  async validate(call) {
    const missRate = asNumber(call.params.recent_p90_miss_rate);
    const avgErr = asNumber(call.params.recent_avg_error_pct);
    const p90 = asNumber(call.params.p90_minutes);
    const best = asNumber(call.params.best_case_minutes);
    if (Number.isNaN(missRate) || Number.isNaN(avgErr) || Number.isNaN(p90) || Number.isNaN(best)) {
      return { status: "pass", rule: "time-estimation-calibration-drift", message: "Calibration stats not provided" };
    }
    if (missRate > 0.3 || avgErr > 0.4) {
      const suggestedP90 = Math.ceil(Math.max(p90, best * 1.8));
      return {
        status: "warn",
        rule: "time-estimation-calibration-drift",
        message: "Recent estimate drift is high; widen uncertainty band",
        suggestion: `Increase p90_minutes to at least ${suggestedP90} and lower confidence`,
      };
    }
    return { status: "pass", rule: "time-estimation-calibration-drift", message: "Calibration drift within range" };
  },
};

export const timeEstimationRules: Rule[] = [timeEstimateSchema, timeEstimateVagueness, timeEstimateCalibrationDrift];
