// Explicit, opt-in paid smoke check. Sends only synthetic text, never business data.
// node --env-file=.env.local --import ./scripts/test-register.mjs scripts/check-ai-openai.mjs
import OpenAI from "openai";
import { toolsForRole } from "../src/features/ai-assistant/service.ts";
import { actionRegistry, actionTools } from "../src/features/ai-assistant/action-registry.ts";
const client = new OpenAI({ timeout: 20000, maxRetries: 0 });
const actions = process.argv.includes("--actions");
const name = actions ? "propose_remove_assignment" : "operations";
try {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini", store: false, max_output_tokens: 100,
    input: actions ? "Synthetic schema test only; no application data and no execution. Call propose_remove_assignment with assignmentId 11111111-1111-4111-8111-111111111111." : "Synthetic integration test. Call operations with start 2026-11-08, end 2026-11-14, venueId null.",
    tools: actions ? actionTools("owner") : toolsForRole("manager"), tool_choice: { type: "function", name },
  });
  const call = response.output.find(item => item.type === "function_call" && item.name === name);
  if (!call || response.status !== "completed") throw new Error("MissingFunctionCall");
  if (actions) actionRegistry.propose_remove_assignment.schema.parse(JSON.parse(call.arguments));
  console.log(JSON.stringify({ status: response.status, functionCalling: true, actions }));
} catch (error) {
  console.log(JSON.stringify({ status: error.status ?? null, error: error.name }));
  process.exitCode = 1;
}
