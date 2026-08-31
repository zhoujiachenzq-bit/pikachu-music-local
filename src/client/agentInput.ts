export function shouldSubmitAgentInput(event: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }, composing: boolean) {
  return event.key === 'Enter' && !event.shiftKey && !composing && !event.isComposing && event.keyCode !== 229;
}
