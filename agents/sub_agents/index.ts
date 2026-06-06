// Barrel for the sub-agents service. Import the class/types for in-process
// reuse, or the server factory to embed the HTTP/SSE front door elsewhere.
export {
  SubAgentService,
  type AgentStreamEvent,
  type AgentSummary,
  type CreateAgentInput,
  type LoadSkillResult,
  type RunCommandOptions,
  type TerminalResult,
} from "./service.js";
export { createSubAgentsServer } from "./server.js";
