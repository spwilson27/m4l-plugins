// Ambient declarations for the Max JS runtime (js / jsui / v8 / v8ui) used by src/*.js.
// Type-check only: nothing here is emitted or loaded by Max. Add members as scripts start using them.

type MaxAtom = number | string;

interface MGraphics {
    init(): void;
    redraw(): void;
    relative_coords: number;
    autofill: number;
    /** Canvas size in pixels: [width, height]. */
    readonly size: [number, number];

    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(radians: number): void;
    scale(x: number, y: number): void;

    set_source_rgba(r: number | number[], g?: number, b?: number, a?: number): void;
    set_source_rgb(r: number | number[], g?: number, b?: number): void;
    set_line_width(w: number): void;
    set_line_cap(cap: string): void;
    set_line_join(join: string): void;
    set_dash(dashes: number[], offset?: number): void;

    move_to(x: number, y: number): void;
    line_to(x: number, y: number): void;
    rel_line_to(dx: number, dy: number): void;
    curve_to(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
    arc(xc: number, yc: number, radius: number, angle1: number, angle2: number): void;
    arc_negative(xc: number, yc: number, radius: number, angle1: number, angle2: number): void;
    rectangle(x: number, y: number, w: number, h: number): void;
    rectangle_rounded(x: number, y: number, w: number, h: number, ovalW: number, ovalH: number): void;
    ellipse(x: number, y: number, w: number, h: number): void;
    close_path(): void;
    new_path(): void;

    fill(): void;
    fill_preserve(): void;
    stroke(): void;
    stroke_preserve(): void;

    select_font_face(name: string, slant?: string, weight?: string): void;
    set_font_size(size: number): void;
    show_text(text: string): void;
    /** [width, height] of the text in the current font. */
    text_measure(text: string): [number, number];
}

declare var mgraphics: MGraphics;

declare var inlets: number;
declare var outlets: number;
/** Index of the inlet the current message arrived on. */
declare var inlet: number;
/** Selector of the current message (inside anything() / msg_* handlers). */
declare var messagename: string;
declare var jsarguments: MaxAtom[];
declare var autowatch: number;

declare function outlet(index: number, ...values: any[]): void;
declare function post(...values: any[]): void;
declare function error(...values: any[]): void;
declare function notifyclients(): void;
declare function arrayfromargs(...args: any[]): any[];
declare function setinletassist(index: number, text: string | ((n: number) => void)): void;
declare function setoutletassist(index: number, text: string | ((n: number) => void)): void;

declare var max: {
    apply(...args: any[]): any;
    hidecursor(): void;
    showcursor(): void;
    [key: string]: any;
};

interface MaxObject {
    maxclass: string;
    varname: string;
    rect: number[];
    hidden: number;
    message(selector: string, ...values: any[]): void;
    setattr(name: string, ...values: any[]): void;
    getattr(name: string): any;
}

interface Patcher {
    getnamed(name: string): MaxObject | null;
    message(selector: string, ...values: any[]): void;
    setattr(name: string, ...values: any[]): void;
    getattr(name: string): any;
    [key: string]: any;
}

/** `this.patcher` at script top level resolves through globalThis. */
declare var patcher: Patcher;
declare var box: MaxObject;

declare class Buffer {
    constructor(name: string);
    framecount(): number;
    channelcount(): number;
    /** Channels are 1-based. Returns one value, or an array when count > 1. */
    peek(channel: number, frame: number, count?: number): any;
    poke(channel: number, frame: number, values: number | number[]): void;
    send(...values: any[]): void;
}

/** Named object shared by every script in the Max process; properties are free-form. */
declare class Global {
    constructor(name: string);
    [key: string]: any;
}

declare class LiveAPI {
    constructor(path?: string);
    constructor(callback: (args: any[]) => void, path?: string);
    path: string;
    unquotedpath: string;
    id: number | string;
    property: string;
    get(name: string): any[];
    set(name: string, ...values: any[]): void;
    call(name: string, ...values: any[]): any;
    getcount(child: string): number;
    goto(path: string): void;
}

declare class Task {
    constructor(fn: (...args: any[]) => void, thisArg?: any, args?: any[]);
    interval: number;
    readonly running: boolean;
    repeat(count?: number, initialDelay?: number): void;
    schedule(delayMs?: number): void;
    execute(): void;
    cancel(): void;
    freepeer(): void;
}

declare class Dict {
    constructor(name?: string);
    name: string;
    get(key: string): any;
    set(key: string, ...values: any[]): void;
    stringify(): string;
    parse(json: string): void;
}

/** Present when a script is also required by the Node tests. */
declare var module: { exports: any } | undefined;
