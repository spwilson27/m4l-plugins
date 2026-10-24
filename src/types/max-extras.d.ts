// Additions to @types/maxmsp (DefinitelyTyped) for what it lacks: v8 / v8ui extras and Max 9 behaviour.
// Type-check only. Prefer fixing gaps here over `any` in source files.

/** Present when a script is also required by the Node tests. */
declare var module: { exports: any } | undefined;

// @types/maxmsp declares select_font_face(fontname) only; Max's mgraphics also takes slant and weight.
interface MGraphics {
    select_font_face(fontname: string, slant?: string, weight?: string): void;
}

// Injected by scripts/theme_common.py into v8ui scripts for suite-wide theming.
declare var M4L_DEVICE_SLUG: string | undefined;
declare var M4L_PATCHER_THEME_MAP: { [varname: string]: { cls: string; role?: string; attrs: { [attr: string]: number[] } } } | undefined;
declare var __M4L_THEME_STATE__: any;


// Not fixable here: @types/maxmsp declares LiveAPI.call(func, args): void, and a merged overload never
// wins for a 1–2 argument call. Where a script uses call()'s result, type the api as a subtype
// with `call(func: string, ...args: any[]): any` (see LomApi in src/types/mcp.d.ts).
