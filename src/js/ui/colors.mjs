// campuser · colors
import { currentSettings, COURSE_COLORS, M, $, session } from "./context.mjs";

// 自动配色随机池（12 色均匀分布色环）：单一事实源在 core/model.js，UI 与导入去重共用
const RANDOM_COLORS = M.RANDOM_COLORS;

// 课程最终生效颜色（支持自定义 hex / 库色 / 自动随机池）
function courseHex(c) {
  if (typeof c.color === "string" && /^#[0-9a-f]{6}$/.test(c.color))
    return c.color;
  if (typeof c.color === "number" && c.color >= 0)
    return COURSE_COLORS[c.color];
  const code = c.name ? c.name.charCodeAt(0) : NaN;
  return isNaN(code)
    ? RANDOM_COLORS[0]
    : RANDOM_COLORS[code % RANDOM_COLORS.length];
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// 课程块样式：颜色按透明度叠在页面底色上，按混合亮度自动取黑/白文字
function courseBlockStyle(c) {
  let [r, g, b] = hexToRgb(courseHex(c));
  // 饱和度滑块：在原色基础上按比例降低 HSV 饱和度（0=全灰，100=原色）
  const sat = currentSettings().saturation / 100;
  if (sat < 1) {
    const { h, s, v } = hexToHsv(rgbToHex(r, g, b));
    [r, g, b] = hexToRgb(hsvToHex(h, s * sat, v));
  }
  const card = session.state.prefs.theme === "dark" ? [42, 46, 55] : [250, 250, 253];
  const a = currentSettings().alpha / 100;
  const blend = [r, g, b].map((ch, i) =>
    Math.round(ch * a + card[i] * (1 - a)),
  );
  const lum = 0.299 * blend[0] + 0.587 * blend[1] + 0.114 * blend[2];
  return {
    bg: `rgba(${r}, ${g}, ${b}, ${a})`,
    text: lum > 165 ? "#20242a" : "#ffffff",
  };
}

export { courseHex, hexToRgb, rgbToHex, hexToHsv, hsvToHex, courseBlockStyle, RANDOM_COLORS };
