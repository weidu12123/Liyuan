/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */
import { EventStream } from "@liyuan/ai/compat";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "./types.ts";
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;
/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export declare function agentLoop(prompts: AgentMessage[], context: AgentContext, config: AgentLoopConfig, signal?: AbortSignal, streamFn?: StreamFn): EventStream<AgentEvent, AgentMessage[]>;
/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export declare function agentLoopContinue(context: AgentContext, config: AgentLoopConfig, signal?: AbortSignal, streamFn?: StreamFn): EventStream<AgentEvent, AgentMessage[]>;
export declare function runAgentLoop(prompts: AgentMessage[], context: AgentContext, config: AgentLoopConfig, emit: AgentEventSink, signal?: AbortSignal, streamFn?: StreamFn): Promise<AgentMessage[]>;
export declare function runAgentLoopContinue(context: AgentContext, config: AgentLoopConfig, emit: AgentEventSink, signal?: AbortSignal, streamFn?: StreamFn): Promise<AgentMessage[]>;
//# sourceMappingURL=agent-loop.d.ts.map