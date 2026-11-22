import { it, expect } from "vitest";
import {
  isFreeDecisionModel,
  decisionRequest,
  parseDecision,
  decisionBatchRequest,
  parseDecisionBatch,
} from "./decision-router.mjs";
it("keeps batch questions separate and rejects missing answers", () => {
  const request = decisionBatchRequest("test:free", [
    { id: "a", message: "Tôi đi" },
    { id: "b", message: "Ai nợ tôi?" },
  ]);
  expect(Object.keys(request.questions)).toEqual(["a", "b"]);
  expect(() =>
    decisionBatchRequest("test:free", [
      { id: "a", message: "Tôi đi" },
      { id: "a", message: "Ai nợ tôi?" },
    ]),
  ).toThrow();
  expect(() =>
    parseDecisionBatch(
      { answers: { a: { type: "choice", choice: "rsvp", confidence: 1 } } },
      ["a", "b"],
    ),
  ).toThrow();
});
it("requires a decision modality and zero prices including per-request fees", () => {
  const model = {
    architecture: { output_modalities: ["decisions"] },
    pricing: { prompt: "0", completion: "0" },
  };
  expect(isFreeDecisionModel(model)).toBe(true);
  expect(
    isFreeDecisionModel({
      ...model,
      pricing: { ...model.pricing, request: "0.001" },
    }),
  ).toBe(false);
  expect(
    isFreeDecisionModel({
      ...model,
      pricing: { prompt: "-1", completion: "-1" },
    }),
  ).toBe(false);
  expect(
    isFreeDecisionModel({
      ...model,
      architecture: { output_modalities: ["text"] },
    }),
  ).toBe(false);
});
it("uses the Decisions contract without chat messages or business permissions", () => {
  const request = decisionRequest("test:free", "Tôi đã chuyển An 85k rồi.");
  expect(request.questions.intent.type).toBe("choice");
  expect(request.state.message).toContain("85k");
  expect(request).not.toHaveProperty("messages");
  expect(request).not.toHaveProperty("tools");
});
it("accepts only declared choices and bounded confidence", () => {
  expect(
    parseDecision({
      answers: {
        intent: { type: "choice", choice: "mark_paid", confidence: 0.99 },
      },
    }),
  ).toEqual({ intent: "mark_paid", confidence: 0.99 });
  expect(() =>
    parseDecision({
      answers: {
        intent: { type: "choice", choice: "auto_approve", confidence: 1 },
      },
    }),
  ).toThrow();
  expect(() =>
    parseDecision({
      answers: {
        intent: { type: "choice", choice: "mark_paid", confidence: 2 },
      },
    }),
  ).toThrow();
});
