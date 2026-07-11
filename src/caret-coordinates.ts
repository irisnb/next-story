export interface CaretCoordinates {
  top: number;
  left: number;
  height: number;
}

// 需要在镜像 div 上复刻的 textarea 计算样式属性。
export const mirroredCaretStyleProperties = [
  "box-sizing",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-family",
  "line-height",
  "text-align",
  "text-transform",
  "text-indent",
  "letter-spacing",
  "word-spacing",
  "tab-size",
] as const;

/**
 * 计算 textarea 中某个字符偏移处的光标像素坐标（相对 textarea 内容盒，已扣除滚动）。
 * 用镜像 div 复刻排版几何，避免在 Node 里用假布局冒充真实像素几何。
 */
export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoordinates {
  const computed = getComputedStyle(textarea);
  const div = document.createElement("div");
  const style = div.style;

  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.top = "0";
  style.left = "0";
  style.overflow = "hidden";

  for (const prop of mirroredCaretStyleProperties) {
    style.setProperty(prop, computed.getPropertyValue(prop));
  }

  div.textContent = textarea.value.substring(0, position);

  const span = document.createElement("span");
  span.textContent = textarea.value.substring(position) || ".";
  div.appendChild(span);

  document.body.appendChild(div);

  const height = parseInt(computed.getPropertyValue("line-height"), 10);
  const fontSize = parseInt(computed.getPropertyValue("font-size"), 10);
  const lineHeight = Number.isFinite(height) && height > 0 ? height : fontSize;

  const coordinates: CaretCoordinates = {
    top: span.offsetTop + parseInt(computed.getPropertyValue("border-top-width"), 10) - textarea.scrollTop,
    left: span.offsetLeft + parseInt(computed.getPropertyValue("border-left-width"), 10) - textarea.scrollLeft,
    height: lineHeight,
  };

  document.body.removeChild(div);
  return coordinates;
}
