/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */
import { EventStream, streamSimple, validateToolArguments, } from "@liyuan/ai/compat";
/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(prompts, context, config, signal, streamFn) {
    const stream = createAgentStream();
    void runAgentLoop(prompts, context, config, async (event) => {
        stream.push(event);
    }, signal, streamFn).then((messages) => {
        stream.end(messages);
    });
    return stream;
}
/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(context, config, signal, streamFn) {
    if (context.messages.length === 0) {
        throw new Error("Cannot continue: no messages in context");
    }
    if (context.messages[context.messages.length - 1].role === "assistant") {
        throw new Error("Cannot continue from message role: assistant");
    }
    const stream = createAgentStream();
    void runAgentLoopContinue(context, config, async (event) => {
        stream.push(event);
    }, signal, streamFn).then((messages) => {
        stream.end(messages);
    });
    return stream;
}
export async function runAgentLoop(prompts, context, config, emit, signal, streamFn) {
    const newMessages = [...prompts];
    const currentContext = {
        ...context,
        messages: [...context.messages, ...prompts],
    };
    await emit({ type: "agent_start" });
    await emit({ type: "turn_start" });
    for (const prompt of prompts) {
        await emit({ type: "message_start", message: prompt });
        await emit({ type: "message_end", message: prompt });
    }
    await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
    return newMessages;
}
export async function runAgentLoopContinue(context, config, emit, signal, streamFn) {
    if (context.messages.length === 0) {
        throw new Error("Cannot continue: no messages in context");
    }
    if (context.messages[context.messages.length - 1].role === "assistant") {
        throw new Error("Cannot continue from message role: assistant");
    }
    const newMessages = [];
    const currentContext = { ...context };
    await emit({ type: "agent_start" });
    await emit({ type: "turn_start" });
    await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
    return newMessages;
}
function createAgentStream() {
    return new EventStream((event) => event.type === "agent_end", (event) => (event.type === "agent_end" ? event.messages : []));
}
/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(initialContext, newMessages, initialConfig, signal, emit, streamFn) {
    let currentContext = initialContext;
    let config = initialConfig;
    let firstTurn = true;
    // Check for steering messages at start (user may have typed while waiting)
    let pendingMessages = (await config.getSteeringMessages?.()) || [];
    // Outer loop: continues when queued follow-up messages arrive after agent would stop
    while (true) {
        let hasMoreToolCalls = true;
        // Inner loop: process tool calls and steering messages
        while (hasMoreToolCalls || pendingMessages.length > 0) {
            if (!firstTurn) {
                await emit({ type: "turn_start" });
            }
            else {
                firstTurn = false;
            }
            // Process pending messages (inject before next assistant response)
            if (pendingMessages.length > 0) {
                for (const message of pendingMessages) {
                    await emit({ type: "message_start", message });
                    await emit({ type: "message_end", message });
                    currentContext.messages.push(message);
                    newMessages.push(message);
                }
                pendingMessages = [];
            }
            // Stream assistant response
            const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
            newMessages.push(message);
            if (message.stopReason === "error" || message.stopReason === "aborted") {
                await emit({ type: "turn_end", message, toolResults: [] });
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            // Check for tool calls
            const toolCalls = message.content.filter((c) => c.type === "toolCall");
            const toolResults = [];
            hasMoreToolCalls = false;
            if (toolCalls.length > 0) {
                const executedToolBatch = await executeToolCalls(currentContext, message, config, signal, emit);
                toolResults.push(...executedToolBatch.messages);
                hasMoreToolCalls = !executedToolBatch.terminate;
                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }
            await emit({ type: "turn_end", message, toolResults });
            const nextTurnContext = {
                message,
                toolResults,
                context: currentContext,
                newMessages,
            };
            const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
            if (nextTurnSnapshot) {
                currentContext = nextTurnSnapshot.context ?? currentContext;
                config = {
                    ...config,
                    model: nextTurnSnapshot.model ?? config.model,
                    reasoning: nextTurnSnapshot.thinkingLevel === undefined
                        ? config.reasoning
                        : nextTurnSnapshot.thinkingLevel === "off"
                            ? undefined
                            : nextTurnSnapshot.thinkingLevel,
                };
            }
            if (await config.shouldStopAfterTurn?.({
                message,
                toolResults,
                context: currentContext,
                newMessages,
            })) {
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            pendingMessages = (await config.getSteeringMessages?.()) || [];
        }
        // Agent would stop here. Check for follow-up messages.
        const followUpMessages = (await config.getFollowUpMessages?.()) || [];
        if (followUpMessages.length > 0) {
            // Set as pending so inner loop processes them
            pendingMessages = followUpMessages;
            continue;
        }
        // No more messages, exit
        break;
    }
    await emit({ type: "agent_end", messages: newMessages });
}
/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(context, config, signal, emit, streamFn) {
    // Apply context transform if configured (AgentMessage[] → AgentMessage[])
    let messages = context.messages;
    if (config.transformContext) {
        messages = await config.transformContext(messages, signal);
    }
    // Convert to LLM-compatible messages (AgentMessage[] → Message[])
    const llmMessages = await config.convertToLlm(messages);
    // Build LLM context
    const llmContext = {
        systemPrompt: context.systemPrompt,
        messages: llmMessages,
        tools: context.tools,
    };
    const streamFunction = streamFn || streamSimple;
    // Resolve API key (important for expiring tokens)
    const resolvedApiKey = (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;
    const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal,
    });
    let partialMessage = null;
    let addedPartial = false;
    for await (const event of response) {
        switch (event.type) {
            case "start":
                partialMessage = event.partial;
                context.messages.push(partialMessage);
                addedPartial = true;
                await emit({ type: "message_start", message: { ...partialMessage } });
                break;
            case "text_start":
            case "text_delta":
            case "text_end":
            case "thinking_start":
            case "thinking_delta":
            case "thinking_end":
            case "toolcall_start":
            case "toolcall_delta":
            case "toolcall_end":
                if (partialMessage) {
                    partialMessage = event.partial;
                    context.messages[context.messages.length - 1] = partialMessage;
                    await emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: { ...partialMessage },
                    });
                }
                break;
            case "done":
            case "error": {
                const finalMessage = await response.result();
                if (addedPartial) {
                    context.messages[context.messages.length - 1] = finalMessage;
                }
                else {
                    context.messages.push(finalMessage);
                }
                if (!addedPartial) {
                    await emit({ type: "message_start", message: { ...finalMessage } });
                }
                await emit({ type: "message_end", message: finalMessage });
                return finalMessage;
            }
        }
    }
    const finalMessage = await response.result();
    if (addedPartial) {
        context.messages[context.messages.length - 1] = finalMessage;
    }
    else {
        context.messages.push(finalMessage);
        await emit({ type: "message_start", message: { ...finalMessage } });
    }
    await emit({ type: "message_end", message: finalMessage });
    return finalMessage;
}
/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(currentContext, assistantMessage, config, signal, emit) {
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
    const hasSequentialToolCall = toolCalls.some((tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential");
    if (config.toolExecution === "sequential" || hasSequentialToolCall) {
        return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
    }
    return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}
async function executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit) {
    const finalizedCalls = [];
    const messages = [];
    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
        let finalized;
        if (preparation.kind === "immediate") {
            finalized = {
                toolCall,
                result: preparation.result,
                isError: preparation.isError,
            };
        }
        else {
            const executed = await executePreparedToolCall(preparation, signal, emit);
            finalized = await finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);
        }
        await emitToolExecutionEnd(finalized, emit);
        const toolResultMessage = createToolResultMessage(finalized);
        await emitToolResultMessage(toolResultMessage, emit);
        finalizedCalls.push(finalized);
        messages.push(toolResultMessage);
        if (signal?.aborted) {
            break;
        }
    }
    return {
        messages,
        terminate: shouldTerminateToolBatch(finalizedCalls),
    };
}
async function executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit) {
    const finalizedCalls = [];
    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
        if (preparation.kind === "immediate") {
            const finalized = {
                toolCall,
                result: preparation.result,
                isError: preparation.isError,
            };
            await emitToolExecutionEnd(finalized, emit);
            finalizedCalls.push(finalized);
            if (signal?.aborted) {
                break;
            }
            continue;
        }
        finalizedCalls.push(async () => {
            const executed = await executePreparedToolCall(preparation, signal, emit);
            const finalized = await finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);
            await emitToolExecutionEnd(finalized, emit);
            return finalized;
        });
        if (signal?.aborted) {
            break;
        }
    }
    const orderedFinalizedCalls = await Promise.all(finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))));
    const messages = [];
    for (const finalized of orderedFinalizedCalls) {
        const toolResultMessage = createToolResultMessage(finalized);
        await emitToolResultMessage(toolResultMessage, emit);
        messages.push(toolResultMessage);
    }
    return {
        messages,
        terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
    };
}
function shouldTerminateToolBatch(finalizedCalls) {
    return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}
function prepareToolCallArguments(tool, toolCall) {
    if (!tool.prepareArguments) {
        return toolCall;
    }
    const preparedArguments = tool.prepareArguments(toolCall.arguments);
    if (preparedArguments === toolCall.arguments) {
        return toolCall;
    }
    return {
        ...toolCall,
        arguments: preparedArguments,
    };
}
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {
    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(`Tool ${toolCall.name} not found`),
            isError: true,
        };
    }
    try {
        const preparedToolCall = prepareToolCallArguments(tool, toolCall);
        const validatedArgs = validateToolArguments(tool, preparedToolCall);
        if (config.beforeToolCall) {
            const beforeResult = await config.beforeToolCall({
                assistantMessage,
                toolCall,
                args: validatedArgs,
                context: currentContext,
            }, signal);
            if (signal?.aborted) {
                return {
                    kind: "immediate",
                    result: createErrorToolResult("Operation aborted"),
                    isError: true,
                };
            }
            if (beforeResult?.block) {
                return {
                    kind: "immediate",
                    result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
                    isError: true,
                };
            }
        }
        if (signal?.aborted) {
            return {
                kind: "immediate",
                result: createErrorToolResult("Operation aborted"),
                isError: true,
            };
        }
        return {
            kind: "prepared",
            toolCall,
            tool,
            args: validatedArgs,
        };
    }
    catch (error) {
        return {
            kind: "immediate",
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        };
    }
}
async function executePreparedToolCall(prepared, signal, emit) {
    const updateEvents = [];
    let acceptingUpdates = true;
    try {
        const result = await prepared.tool.execute(prepared.toolCall.id, prepared.args, signal, (partialResult) => {
            if (!acceptingUpdates)
                return;
            updateEvents.push(Promise.resolve(emit({
                type: "tool_execution_update",
                toolCallId: prepared.toolCall.id,
                toolName: prepared.toolCall.name,
                args: prepared.toolCall.arguments,
                partialResult,
            })));
        });
        acceptingUpdates = false;
        await Promise.all(updateEvents);
        return { result, isError: false };
    }
    catch (error) {
        acceptingUpdates = false;
        await Promise.all(updateEvents);
        return {
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        };
    }
    finally {
        acceptingUpdates = false;
    }
}
async function finalizeExecutedToolCall(currentContext, assistantMessage, prepared, executed, config, signal) {
    let result = executed.result;
    let isError = executed.isError;
    if (config.afterToolCall) {
        try {
            const afterResult = await config.afterToolCall({
                assistantMessage,
                toolCall: prepared.toolCall,
                args: prepared.args,
                result,
                isError,
                context: currentContext,
            }, signal);
            if (afterResult) {
                result = {
                    content: afterResult.content ?? result.content,
                    details: afterResult.details ?? result.details,
                    terminate: afterResult.terminate ?? result.terminate,
                };
                isError = afterResult.isError ?? isError;
            }
        }
        catch (error) {
            result = createErrorToolResult(error instanceof Error ? error.message : String(error));
            isError = true;
        }
    }
    return {
        toolCall: prepared.toolCall,
        result,
        isError,
    };
}
function createErrorToolResult(message) {
    return {
        content: [{ type: "text", text: message }],
        details: {},
    };
}
async function emitToolExecutionEnd(finalized, emit) {
    await emit({
        type: "tool_execution_end",
        toolCallId: finalized.toolCall.id,
        toolName: finalized.toolCall.name,
        result: finalized.result,
        isError: finalized.isError,
    });
}
function createToolResultMessage(finalized) {
    return {
        role: "toolResult",
        toolCallId: finalized.toolCall.id,
        toolName: finalized.toolCall.name,
        content: finalized.result.content,
        details: finalized.result.details,
        isError: finalized.isError,
        timestamp: Date.now(),
    };
}
async function emitToolResultMessage(toolResultMessage, emit) {
    await emit({ type: "message_start", message: toolResultMessage });
    await emit({ type: "message_end", message: toolResultMessage });
}
//# sourceMappingURL=agent-loop.js.map