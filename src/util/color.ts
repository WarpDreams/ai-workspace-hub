/**
 * Minimal ANSI colouring for `doctor`.
 *
 * Off by default: colour is only emitted when the manifest sets
 * `"color_output": true` AND stdout is a TTY AND $NO_COLOR is unset
 * (https://no-color.org). Every helper is the identity function while
 * disabled, so call sites need no conditionals.
 */

const ESC = "";

let enabled = false;

/** Turn colouring on/off. `want` comes from the manifest's `color_output`. */
export function setColorEnabled(want: boolean): void {
  const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
  enabled = want && !noColor && Boolean(process.stdout.isTTY);
}

export function colorEnabled(): boolean {
  return enabled;
}

const wrap = (open: string) => (s: string) => (enabled ? `${ESC}[${open}m${s}${ESC}[0m` : s);

export const bold = wrap("1");
export const dim = wrap("2");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const blue = wrap("34");
export const magenta = wrap("35");
export const cyan = wrap("36");

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Visible length, ignoring ANSI escapes. */
export function visibleLength(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

/**
 * Pad to `width` using the string's visible length, so ANSI escapes don't
 * eat into the column. Colour first, then pad with this.
 */
export function padVisible(s: string, width: number): string {
  const visible = visibleLength(s);
  return visible >= width ? s : s + " ".repeat(width - visible);
}
