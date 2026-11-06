export function shouldSubmitChatOnEnter(input: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
  touchInput: boolean;
}) {
  return input.key === "Enter" &&
    !input.shiftKey && !input.ctrlKey && !input.metaKey && !input.altKey &&
    !input.isComposing && input.keyCode !== 229 && !input.touchInput;
}
