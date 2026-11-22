export function evalBudget(raw = "15000") {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 6000 || value > 200000)
    throw Error("AI_EVAL_TOKEN_BUDGET must be an integer from 6000 to 200000");
  return value;
}
/** Leave room for another bounded request, including unknown failed usage. */
export function canRunEval(tokens: number[], budget: number) {
  return tokens.reduce((sum, value) => sum + value, 0) + 6000 <= budget;
}
